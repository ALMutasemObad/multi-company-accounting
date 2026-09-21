import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_USAGE_CATEGORIES_BY_OWNER,
  ACCOUNT_USAGE_OWNER_ORDER,
  type AccountUsageOwner,
  type AccountUsageQueryPort,
} from "../src/accounts/account-usage-query-port.js";
import { AccountUsageGuard, AccountUsageGuardError } from "../src/accounts/account-usage-guard.js";

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
    const guard = new AccountUsageGuard(ports);

    expect(guard.completeness()).toEqual({
      complete: true,
      missingOwners: [],
      duplicateOwners: [],
      enforcementEnabled: false,
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

  it("fails closed before querying when composition is incomplete or duplicated", async () => {
    const calls: AccountUsageOwner[] = [];
    const incomplete = new AccountUsageGuard([port("REPORTING", calls)]);
    expect(incomplete.completeness()).toEqual({
      complete: false,
      missingOwners: ["CORE_ACCOUNTING", "SALES", "PURCHASES", "TAX", "TREASURY", "INVENTORY"],
      duplicateOwners: [],
      enforcementEnabled: false,
    });
    await expect(incomplete.inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "INCOMPLETE_COMPOSITION" }));
    expect(calls).toEqual([]);

    const duplicate = new AccountUsageGuard([port("REPORTING", calls), port("REPORTING", calls)]);
    await expect(duplicate.inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "DUPLICATE_OWNER" }));
    expect(calls).toEqual([]);
  });

  it("does not convert an owner failure or incomplete owner result into no usage", async () => {
    const ports = ACCOUNT_USAGE_OWNER_ORDER.map((owner) => port(owner, []));
    ports[3] = {
      owner: "TAX",
      queryAccountUsage: vi.fn().mockRejectedValue(new Error("database unavailable")),
    };
    await expect(new AccountUsageGuard(ports).inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "OWNER_QUERY_FAILED", owner: "TAX" }));

    ports[3] = { owner: "TAX", queryAccountUsage: vi.fn().mockResolvedValue([]) };
    await expect(new AccountUsageGuard(ports).inspect({} as Prisma.TransactionClient, 7n, 11n))
      .rejects.toEqual(expect.objectContaining({ reason: "INVALID_OWNER_RESULT", owner: "TAX" }));
  });

  it("exports a dedicated fail-closed error type", () => {
    expect(new AccountUsageGuardError("INCOMPLETE_COMPOSITION")).toBeInstanceOf(Error);
  });
});
