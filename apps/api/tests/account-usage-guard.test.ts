import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_USAGE_CATEGORIES_BY_OWNER,
  ACCOUNT_USAGE_OWNER_ORDER,
  type AccountUsageOwner,
  type AccountUsageQueryPort,
} from "../src/accounts/account-usage-query-port.js";
import { AccountUsageGuard, AccountUsageGuardError } from "../src/accounts/account-usage-guard.js";
import { AccountError, AccountService } from "../src/accounts/account-service.js";
import { createApp } from "../src/app.js";

function port(owner: AccountUsageOwner, calls: AccountUsageOwner[]): AccountUsageQueryPort {
  return {
    owner,
    queryAccountUsage: vi.fn(async () => {
      calls.push(owner);
      return ACCOUNT_USAGE_CATEGORIES_BY_OWNER[owner].map((category) => ({
        category,
        count: 1,
        hasImmutableHistory: owner === "CORE_ACCOUNTING",
      }));
    }),
  };
}

describe("AccountUsageGuard", () => {
  it("queries every complete owner in deterministic order and returns bounded facts", async () => {
    const calls: AccountUsageOwner[] = [];
    const ports = [...ACCOUNT_USAGE_OWNER_ORDER].reverse().map((owner) => port(owner, calls));
    const guard = new AccountUsageGuard(ports).activate();

    expect(guard.completeness()).toEqual({
      complete: true,
      missingOwners: [],
      duplicateOwners: [],
      enforcementEnabled: true,
    });
    const result = await guard.inspect({} as Prisma.TransactionClient, 7n, 11n);

    expect(calls).toEqual(ACCOUNT_USAGE_OWNER_ORDER);
    expect(result).toEqual({
      inUse: true,
      facts: ACCOUNT_USAGE_OWNER_ORDER.flatMap((owner) => ACCOUNT_USAGE_CATEGORIES_BY_OWNER[owner].map((category) => ({
        category,
        count: 1,
        hasImmutableHistory: owner === "CORE_ACCOUNTING",
      }))),
    });
    expect(JSON.stringify(result)).not.toMatch(/accountId|companyId|documentId/u);
  });

  it("keeps composition completeness separate from explicit lifecycle activation", () => {
    const guard = new AccountUsageGuard(ACCOUNT_USAGE_OWNER_ORDER.map((owner) => port(owner, [])));
    expect(guard.completeness()).toMatchObject({ complete: true, enforcementEnabled: false });
    expect(guard.activate().completeness()).toMatchObject({ complete: true, enforcementEnabled: true });
  });

  it("fails closed before querying when composition is incomplete or duplicated", async () => {
    const calls: AccountUsageOwner[] = [];
    expect(() => new AccountUsageGuard([port("REPORTING", calls)]))
      .toThrow(expect.objectContaining({ reason: "INCOMPLETE_COMPOSITION", owner: "CORE_ACCOUNTING" }));
    expect(calls).toEqual([]);

    const complete = ACCOUNT_USAGE_OWNER_ORDER.map((owner) => port(owner, calls));
    expect(() => new AccountUsageGuard([...complete, port("REPORTING", calls)]))
      .toThrow(expect.objectContaining({ reason: "DUPLICATE_OWNER", owner: "REPORTING" }));
    expect(calls).toEqual([]);
  });

  it("does not convert an owner failure or incomplete owner result into no usage", async () => {
    const ports = ACCOUNT_USAGE_OWNER_ORDER.map((owner) => port(owner, []));
    ports[3] = {
      owner: "TAX",
      queryAccountUsage: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };
    await expect(new AccountUsageGuard(ports).activate().inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "OWNER_QUERY_FAILED", owner: "TAX" }));

    ports[3] = { owner: "TAX", queryAccountUsage: vi.fn().mockResolvedValue([]) };
    await expect(new AccountUsageGuard(ports).activate().inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "INVALID_OWNER_RESULT", owner: "TAX" }));
  });

  it("exports a dedicated fail-closed error type", () => {
    expect(new AccountUsageGuardError("INCOMPLETE_COMPOSITION")).toBeInstanceOf(Error);
  });

  it("maps guard infrastructure failures to a non-enumerating 503 response", async () => {
    const router = await readFile(new URL("../src/accounts/account-router.ts", import.meta.url), "utf8");
    expect(router).toContain("error instanceof AccountUsageGuardError");
    expect(router).toContain("res.status(503)");
    expect(router).toContain("code: 'ACCOUNT_USAGE_UNAVAILABLE'");
    expect(router).not.toContain("owner: error.owner");

    const failure = new AccountUsageGuardError("OWNER_QUERY_FAILED", "SALES", { cause: new Error("internal owner detail") });
    const app = createApp({
      NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    }, {
      auth: { authorize: vi.fn().mockResolvedValue({ companyId: 7n, userId: 5n, role: "ADMIN" }) } as never,
      accounts: { deactivateAccount: vi.fn().mockRejectedValue(failure) } as never,
    });
    const response = await request(app)
      .post("/api/v1/accounts/11/deactivate")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "test-csrf")
      .send({ expectedVersion: 3, reason: "تعطيل اختباري" })
      .expect(503);
    expect(response.body).toEqual({ status: 503, code: "ACCOUNT_USAGE_UNAVAILABLE" });
    expect(JSON.stringify(response.body)).not.toContain("SALES");
    expect(JSON.stringify(response.body)).not.toContain("internal owner detail");
  });
});

describe("AccountService usage enforcement", () => {
  const context = { companyId: 7n, userId: 5n, role: "ADMIN" as const };

  function serviceWith(tx: Record<string, unknown>, inspect: ReturnType<typeof vi.fn>) {
    return new AccountService({
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
    } as never, { inspect } as never);
  }

  it("locks and re-reads before guard inspection and blocks deactivate before CAS", async () => {
    const events: string[] = [];
    const usageFact = { category: "TREASURY_CASH_BANK_ACCOUNT", count: 1, hasImmutableHistory: false } as const;
    const inspect = vi.fn(async () => { events.push("inspect"); return { inUse: true, facts: [usageFact] }; });
    const tx = {
      $queryRaw: vi.fn(async () => { events.push("lock"); return [{ id: 11n }]; }),
      account: {
        findFirst: vi.fn(async () => { events.push("reread"); return { id: 11n, version: 3 }; }),
        count: vi.fn(async () => { events.push("active-children"); return 0; }),
        updateMany: vi.fn(),
      },
    };

    await expect(serviceWith(tx, inspect).deactivateAccount(context, 11n, "unused", 3))
      .rejects.toMatchObject({ reason: "ACCOUNT_IN_USE", details: { usageFacts: [usageFact] } } satisfies Partial<AccountError>);
    expect(events).toEqual(["lock", "reread", "active-children", "inspect"]);
    expect(inspect).toHaveBeenCalledWith(tx, 7n, 11n);
    expect(tx.account.updateMany).not.toHaveBeenCalled();
  });

  it("preserves active-child compatibility before the general usage result", async () => {
    const inspect = vi.fn().mockResolvedValue({ inUse: true, facts: [] });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue({ id: 11n, version: 3 }),
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn(),
      },
    };
    await expect(serviceWith(tx, inspect).deactivateAccount(context, 11n, "child", 3))
      .rejects.toMatchObject({ reason: "HAS_ACTIVE_CHILDREN" } satisfies Partial<AccountError>);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("propagates owner failures instead of treating them as no usage", async () => {
    const failure = new AccountUsageGuardError("OWNER_QUERY_FAILED", "SALES", { cause: new Error("db down") });
    const inspect = vi.fn().mockRejectedValue(failure);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue({ id: 11n, version: 3 }),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn(),
      },
    };
    await expect(serviceWith(tx, inspect).deactivateAccount(context, 11n, "failure", 3)).rejects.toBe(failure);
    expect(tx.account.updateMany).not.toHaveBeenCalled();
  });

  it("uses the guard as the sole non-child usage source for delete", async () => {
    const inspect = vi.fn().mockResolvedValue({ inUse: false, facts: [] });
    const account = { id: 11n, version: 3, code: "1000", nameAr: "حساب", sourceTemplateCode: null, sourceTemplateKey: null, _count: { children: 0 } };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue(account),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await expect(serviceWith(tx, inspect).deleteAccount(context, 11n, "delete", 3))
      .resolves.toEqual({ id: "11", deleted: true });
    expect(tx.account.findFirst).toHaveBeenCalledWith({
      where: { id: 11n, companyId: 7n },
      include: { _count: { select: { children: true } } },
    });
    expect(inspect.mock.invocationCallOrder[0]).toBeLessThan(tx.account.deleteMany.mock.invocationCallOrder[0]!);
  });

  it("inspects actual eligibility transitions but not metadata-only updates", async () => {
    const inspect = vi.fn().mockResolvedValue({ inUse: true, facts: [] });
    const current = { id: 11n, parentAccountId: null, level: 1, version: 3, isActive: true, allowsPosting: true, accountTypeId: 2n, isControlAccount: true };
    const transaction = (tx: Record<string, unknown>) => ({
      $transaction: vi.fn(async (callback: (transactionClient: unknown) => unknown) => callback(tx)),
    });
    const transitionTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
    };
    await expect(new AccountService(transaction(transitionTx) as never, { inspect } as never).updateAccount(
      context,
      11n,
      { expectedVersion: 3, allowsPosting: false },
    )).rejects.toMatchObject({ reason: "ACCOUNT_IN_USE" } satisfies Partial<AccountError>);
    expect(transitionTx.account.updateMany).not.toHaveBeenCalled();

    inspect.mockClear();
    const metadataTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...current, nameAr: "محدث" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await new AccountService(transaction(metadataTx) as never, { inspect } as never).updateAccount(
      context,
      11n,
      { expectedVersion: 3, nameAr: "محدث" },
    );
    expect(inspect).not.toHaveBeenCalled();

    inspect.mockClear();
    const accountTypeTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
      accountType: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 4n }) },
      account: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
    };
    await expect(new AccountService(transaction(accountTypeTx) as never, { inspect } as never).updateAccount(
      context,
      11n,
      { expectedVersion: 3, accountTypeId: 4n },
    )).rejects.toMatchObject({ reason: "ACCOUNT_IN_USE" } satisfies Partial<AccountError>);
    expect(inspect).toHaveBeenCalledWith(accountTypeTx, 7n, 11n);
  });
});
