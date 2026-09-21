import { describe, expect, it, vi } from "vitest";
import { CashFlowError, CashFlowService } from "../src/reports/cash-flow-service.js";

const account = {
  id: 11n,
  code: "1210",
  nameAr: "ذمم",
  nameEn: null,
  sourceTemplateKey: null,
  accountClass: "ASSET" as const,
  normalBalance: "DEBIT" as const,
};

function fixture(eligibility: { eligible: true; accountId: bigint; companyId: bigint } | { eligible: false; reason: "NOT_FOUND" | "INACTIVE" | "NON_POSTING" | "HAS_CHILDREN" }) {
  const tx = {
    cashFlowAccountMapping: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ accountId: 11n, classification: "INVESTING", version: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) };
  const ledger = { findPostingAccount: vi.fn().mockResolvedValue(account) };
  const treasury = { listLedgerAccountIds: vi.fn().mockResolvedValue([]) };
  const references = { lockPostingAccount: vi.fn().mockResolvedValue(eligibility) };
  const service = new CashFlowService(prisma as never, ledger as never, references, treasury);
  return { service, tx, ledger, treasury, references };
}

describe("CashFlowService account reference handshake", () => {
  it("locks the Account first and dispatches the mapping write exactly once", async () => {
    const { service, tx, ledger, references } = fixture({ eligible: true, accountId: 11n, companyId: 7n });
    await service.updateMapping({ companyId: 7n, userId: 3n }, 11n, { classification: "INVESTING", version: 0 });

    expect(references.lockPostingAccount).toHaveBeenCalledWith(expect.anything(), 7n, 11n);
    expect(references.lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(ledger.findPostingAccount.mock.invocationCallOrder[0]!);
    expect(references.lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.cashFlowAccountMapping.findUnique.mock.invocationCallOrder[0]!);
    expect(tx.cashFlowAccountMapping.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["INACTIVE", "INVALID_MAPPING"],
    ["NON_POSTING", "INVALID_MAPPING"],
    ["HAS_CHILDREN", "INVALID_MAPPING"],
  ] as const)("rejects %s before reading or writing a mapping", async (reason, cashFlowReason) => {
    const { service, tx, ledger } = fixture({ eligible: false, reason });
    await expect(service.updateMapping(
      { companyId: 7n, userId: 3n },
      11n,
      { classification: "INVESTING", version: 0 },
    )).rejects.toEqual(new CashFlowError(cashFlowReason));
    expect(ledger.findPostingAccount).not.toHaveBeenCalled();
    expect(tx.cashFlowAccountMapping.findUnique).not.toHaveBeenCalled();
    expect(tx.cashFlowAccountMapping.create).not.toHaveBeenCalled();
  });
});
