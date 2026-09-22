import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AccountError, AccountService } from "../src/accounts/account-service.js";
import { lockAccountRows } from "../src/accounts/account-row-lock.js";
import { PrismaAccountReferenceLockAdapter } from "../src/accounts/prisma-account-reference-lock-adapter.js";

const eligibleAccount = {
  id: 11n,
  companyId: 7n,
  isActive: true,
  allowsPosting: true,
  _count: { children: 0 },
};

function transaction(
  lockRows: Array<{ id: bigint }>,
  account: typeof eligibleAccount | null = eligibleAccount,
) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(lockRows),
    account: { findFirst: vi.fn().mockResolvedValue(account) },
  };
}

describe("PrismaAccountReferenceLockAdapter", () => {
  it("locks by company and account before confirming posting eligibility", async () => {
    const tx = transaction([{ id: 11n }]);
    await expect(new PrismaAccountReferenceLockAdapter().lockPostingAccount(
      tx as unknown as Prisma.TransactionClient,
      7n,
      11n,
    )).resolves.toEqual({ eligible: true, accountId: 11n, companyId: 7n });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.account.findFirst).toHaveBeenCalledWith({
      where: { id: 11n, companyId: 7n },
      select: { id: true, companyId: true, isActive: true, allowsPosting: true, _count: { select: { children: true } } },
    });
  });

  it.each([
    ["cross-company or missing", [], null, "NOT_FOUND"],
    ["inactive", [{ id: 11n }], { ...eligibleAccount, isActive: false }, "INACTIVE"],
    ["non-posting", [{ id: 11n }], { ...eligibleAccount, allowsPosting: false }, "NON_POSTING"],
    ["parent", [{ id: 11n }], { ...eligibleAccount, _count: { children: 1 } }, "HAS_CHILDREN"],
  ])("rejects %s accounts", async (_label, locked, account, reason) => {
    const tx = transaction(locked as Array<{ id: bigint }>, account as typeof eligibleAccount | null);
    await expect(new PrismaAccountReferenceLockAdapter().lockPostingAccount(
      tx as unknown as Prisma.TransactionClient,
      7n,
      11n,
    )).resolves.toEqual({ eligible: false, reason });
  });
});

describe("Account row lock", () => {
  it("scopes, deduplicates, and numerically orders account locks", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 2n }, { id: 9n }, { id: 11n }]);
    await expect(lockAccountRows(
      { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
      7n,
      [11n, 2n, 9n, 2n],
    )).resolves.toEqual([2n, 9n, 11n]);

    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[]; values: readonly unknown[] };
    expect(query.strings.join(" ")).toContain("WHERE company_id =");
    expect(query.strings.join(" ")).toContain("id IN");
    expect(query.strings.join(" ")).toContain("ORDER BY id");
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(query.values).toEqual([7n, 2n, 9n, 11n]);
  });
});

describe("AccountService hierarchy writer protocol", () => {
  const context = { companyId: 7n, userId: 5n, role: "ADMIN" as const };
  const unusedGuard = { inspect: vi.fn().mockResolvedValue({ inUse: false, facts: [] }) };

  function serviceWith(tx: Record<string, unknown>) {
    return new AccountService({
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
    } as never, unusedGuard as never);
  }

  it("locks and re-reads the parent before creating a child", async () => {
    const events: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => { events.push("lock-parent"); return [{ id: 9n }]; }),
      accountType: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 1n }) },
      account: {
        findFirst: vi.fn(async () => { events.push("reread-parent"); return { id: 9n, level: 2, isActive: true, allowsPosting: false }; }),
        create: vi.fn(async () => { events.push("create-child"); return { id: 12n }; }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await serviceWith(tx).createAccount(context, {
      accountTypeId: 1n,
      parentAccountId: 9n,
      code: "1200",
      nameAr: "طفل",
      allowsPosting: true,
    });
    expect(events).toEqual(["lock-parent", "reread-parent", "create-child"]);
    expect(tx.account.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parentAccountId: 9n, level: 3 }),
    }));
  });

  it("rejects create when the locked parent became posting", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 9n }]),
      accountType: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 1n }) },
      account: {
        findFirst: vi.fn().mockResolvedValue({ id: 9n, level: 2, isActive: true, allowsPosting: true }),
        create: vi.fn(),
      },
    };
    await expect(serviceWith(tx).createAccount(context, {
      accountTypeId: 1n,
      parentAccountId: 9n,
      code: "1200",
      nameAr: "طفل",
      allowsPosting: true,
    })).rejects.toMatchObject({ reason: "INVALID_PARENT" } satisfies Partial<AccountError>);
    expect(tx.account.create).not.toHaveBeenCalled();
  });

  it("locks the discovered hierarchy in numeric order and rejects a cycle after re-read", async () => {
    const root = { id: 7n, parentAccountId: null, level: 1, version: 4, isActive: true, allowsPosting: false };
    const child = { id: 3n, parentAccountId: 7n, level: 2, version: 2, isActive: true, allowsPosting: false };
    let findManyCall = 0;
    let findFirstCall = 0;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 3n }, { id: 7n }]),
      account: {
        findFirst: vi.fn(async () => {
          findFirstCall += 1;
          return [root, child, root, root, child, root][findFirstCall - 1] ?? null;
        }),
        findMany: vi.fn(async () => {
          findManyCall += 1;
          return findManyCall % 2 === 1 ? [child] : [];
        }),
        updateMany: vi.fn(),
      },
    };

    await expect(serviceWith(tx).updateAccount(context, 7n, {
      expectedVersion: 4,
      parentAccountId: 3n,
    })).rejects.toMatchObject({ reason: "CYCLE_DETECTED" } satisfies Partial<AccountError>);
    expect(tx.account.updateMany).not.toHaveBeenCalled();
    const query = tx.$queryRaw.mock.calls[0]![0] as { values: readonly unknown[] };
    expect(query.values).toEqual([7n, 3n, 7n]);
  });

  it("fails closed when the locked hierarchy no longer covers the re-read graph", async () => {
    const root = { id: 7n, parentAccountId: null, level: 1, version: 4, isActive: true, allowsPosting: false };
    const staleChild = { id: 3n, parentAccountId: 7n, level: 2, version: 1, isActive: true, allowsPosting: true };
    const newChild = { id: 4n, parentAccountId: 7n, level: 2, version: 0, isActive: true, allowsPosting: true };
    let findManyCall = 0;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 3n }, { id: 7n }]),
      accountType: { findUniqueOrThrow: vi.fn() },
      account: {
        findFirst: vi.fn().mockResolvedValue(root),
        findMany: vi.fn(async () => {
          findManyCall += 1;
          if (findManyCall === 1) return [staleChild];
          if (findManyCall === 2) return [];
          if (findManyCall === 3) return [staleChild, newChild];
          return [];
        }),
        updateMany: vi.fn(),
      },
    };

    await expect(serviceWith(tx).updateAccount(context, 7n, {
      expectedVersion: 4,
      allowsPosting: true,
    })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" } satisfies Partial<AccountError>);
    expect(tx.account.updateMany).not.toHaveBeenCalled();
  });

  it("locks only the target for metadata-only updates and uses explicit-lock isolation", async () => {
    const root = { id: 7n, parentAccountId: 2n, level: 3, version: 4, isActive: true, allowsPosting: false };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 7n }]),
      account: {
        findFirst: vi.fn().mockResolvedValue(root),
        findMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ ...root, nameAr: "محدث" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const transaction = vi.fn(async (callback: (transactionClient: unknown) => unknown) => callback(tx));
    const service = new AccountService({ $transaction: transaction } as never, unusedGuard as never);

    await service.updateAccount(context, 7n, { expectedVersion: 4, nameAr: "محدث" });
    expect(tx.account.findMany).not.toHaveBeenCalled();
    const query = tx.$queryRaw.mock.calls[0]![0] as { values: readonly unknown[] };
    expect(query.values).toEqual([7n, 7n]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
  });

  it("checks the expected version again after locking the target", async () => {
    const beforeLock = { id: 7n, parentAccountId: null, level: 1, version: 4, isActive: true, allowsPosting: true };
    const afterLock = { ...beforeLock, version: 5 };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 7n }]),
      account: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(beforeLock)
          .mockResolvedValueOnce(afterLock),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    await expect(serviceWith(tx).updateAccount(context, 7n, {
      expectedVersion: 4,
      nameAr: "قديم",
    })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" } satisfies Partial<AccountError>);
    expect(tx.account.updateMany).not.toHaveBeenCalled();
  });

  it("locks and re-reads lifecycle state before checking children or deleting", async () => {
    const events: string[] = [];
    const current = { id: 7n, version: 4, code: "1000", nameAr: "أصل", sourceTemplateCode: null, sourceTemplateKey: null };
    const tx = {
      $queryRaw: vi.fn(async () => { events.push("lock"); return [{ id: 7n }]; }),
      account: {
        findFirst: vi.fn(async ({ include }: { include?: unknown }) => {
          events.push("reread");
          return include ? { ...current, _count: { children: 0, journalLines: 0, customers: 0, cashBankAccounts: 0, receiptCounterAccounts: 0, suppliers: 0, paymentCounterAccounts: 0, outputTaxRates: 0, inputTaxRates: 0, salesInvoiceLines: 0, purchaseInvoiceLines: 0 } } : current;
        }),
        count: vi.fn(async () => { events.push("children"); return 0; }),
        updateMany: vi.fn(async () => { events.push("cas"); return { count: 1 }; }),
        findFirstOrThrow: vi.fn().mockResolvedValue(current),
        deleteMany: vi.fn(async () => { events.push("delete-cas"); return { count: 1 }; }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = serviceWith(tx);
    await service.deactivateAccount(context, 7n, "test", 4);
    expect(events.slice(0, 4)).toEqual(["lock", "reread", "children", "cas"]);

    events.length = 0;
    await service.deleteAccount(context, 7n, "test", 4);
    expect(events).toEqual(["lock", "reread", "delete-cas"]);
  });
});
