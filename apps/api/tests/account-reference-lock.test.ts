import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
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
