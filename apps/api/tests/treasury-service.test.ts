import { describe, expect, it, vi } from "vitest";
import {
  TreasuryError,
  TreasuryService,
} from "../src/treasury/treasury-service.js";

const postingAccount = (companyId: bigint, id = 91n) => ({
  id,
  companyId,
  code: "110100",
  isActive: true,
  allowsPosting: true,
  accountType: { class: "ASSET" },
  _count: { children: 0 },
});
const accountReferences = () => ({
  lockPostingAccount: vi.fn().mockResolvedValue({ eligible: true, companyId: 77n, accountId: 91n }),
});

describe("TreasuryService ownership and instrument policy", () => {
  it("resolves an active company-scoped cash account and visible payment method", async () => {
    const cashBankFind = vi.fn().mockResolvedValue({
      id: 8n,
      companyId: 77n,
      ledgerAccountId: 91n,
      ledgerAccount: postingAccount(77n),
    });
    const paymentMethodFind = vi.fn().mockResolvedValue({
      id: 4n,
      requiresReference: true,
    });
    const service = new TreasuryService({} as never, accountReferences());
    const quote = await service.resolveInstrument(
      {
        cashBankAccount: { findFirst: cashBankFind },
        paymentMethod: { findFirst: paymentMethodFind },
      } as never,
      77n,
      {
        cashBankAccountId: 8n,
        paymentMethodId: 4n,
        referenceNumber: "BANK-42",
      },
    );

    expect(cashBankFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8n, companyId: 77n, isActive: true },
    }));
    expect(paymentMethodFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 4n,
        isActive: true,
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId: 77n },
        ],
      }),
    }));
    expect(quote).toEqual({
      cashBankAccountId: 8n,
      cashBankLedgerAccountId: 91n,
      paymentMethodId: 4n,
      requiresReference: true,
    });
  });

  it("rejects a cross-company ledger relation as an invalid treasury instrument", async () => {
    const service = new TreasuryService({} as never, accountReferences());
    const tx = {
      cashBankAccount: {
        findFirst: vi.fn().mockResolvedValue({
          id: 8n,
          companyId: 77n,
          ledgerAccountId: 91n,
          ledgerAccount: postingAccount(88n),
        }),
      },
    };

    await expect(service.resolveInstrument(tx as never, 77n, {
      cashBankAccountId: 8n,
      paymentMethodId: 4n,
    })).rejects.toEqual(new TreasuryError("INVALID_CASH_BANK_ACCOUNT"));
  });

  it("requires company and expected version in every cash-account mutation", async () => {
    const tx = {
      cashBankAccount: {
        findFirst: vi.fn().mockResolvedValue({
          id: 8n,
          companyId: 12n,
          ledgerAccountId: 81n,
          accountType: "CASH",
          bankName: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      account: { findFirst: vi.fn().mockResolvedValue(postingAccount(12n, 81n)) },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const service = new TreasuryService(prisma as never, accountReferences());

    await expect(service.updateCashBankAccount(
      { companyId: 12n, userId: 2n },
      8n,
      { version: 3, nameAr: "صندوق متزامن" },
    )).rejects.toEqual(new TreasuryError("VERSION_CONFLICT"));
    expect(tx.cashBankAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 8n, companyId: 12n },
    });
    expect(tx.cashBankAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8n, companyId: 12n, version: 3 },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
  });

  it("locks a supplied ledger account even when it matches the snapshot and before the CAS write", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      cashBankAccount: {
        findFirst: vi.fn().mockResolvedValue({
          id: 8n,
          companyId: 12n,
          ledgerAccountId: 81n,
          accountType: "CASH",
          bankName: null,
        }),
        updateMany,
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: 8n, version: 4 }),
      },
      account: { findFirst: vi.fn().mockResolvedValue(postingAccount(12n, 81n)) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 12n, accountId: 81n });
    const service = new TreasuryService(prisma as never, { lockPostingAccount });

    await service.updateCashBankAccount(
      { companyId: 12n, userId: 2n },
      8n,
      { version: 3, ledgerAccountId: 81n },
    );

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 12n, 81n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8n, companyId: 12n, version: 3 },
      data: expect.objectContaining({ ledgerAccountId: 81n, version: { increment: 1 } }),
    }));
  });

  it("reserves the master-data sequence before the account lock and locks before create", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue([{ prefix: "CB-", padding: 6, nextNumber: 2n }]);
    const create = vi.fn().mockResolvedValue({ id: 8n });
    const tx = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      account: { findFirst: vi.fn().mockResolvedValue(postingAccount(12n, 81n)) },
      cashBankAccount: { create },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 12n, accountId: 81n });
    const service = new TreasuryService(prisma as never, { lockPostingAccount });

    await service.createCashBankAccount(
      { companyId: 12n, userId: 2n },
      { ledgerAccountId: 81n, accountType: "CASH", nameAr: "الصندوق" },
    );

    expect(executeRaw.mock.invocationCallOrder.at(-1)!).toBeLessThan(lockPostingAccount.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 12n, 81n);
  });

  it("deduplicates and locks ledger accounts numerically on the supplied transaction", async () => {
    const tx = { marker: "same-transaction" };
    const lockPostingAccount = vi.fn().mockImplementation(async (_tx, companyId, accountId) => ({
      eligible: true as const,
      companyId,
      accountId,
    }));
    const service = new TreasuryService({} as never, { lockPostingAccount });
    const writer = service as unknown as {
      lockLedgerAccounts(client: unknown, companyId: bigint, accountIds: readonly bigint[]): Promise<void>;
    };

    await writer.lockLedgerAccounts(tx, 12n, [9n, 3n, 9n, 5n]);

    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 12n, 3n],
      [tx, 12n, 5n],
      [tx, 12n, 9n],
    ]);
  });

  it("does not reveal another company's payment method and keeps global methods read-only", async () => {
    const tx = {
      paymentMethod: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ scope: "GLOBAL" }) },
    };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)),
    };
    const service = new TreasuryService(prisma as never, accountReferences());

    await expect(service.updatePaymentMethod(
      { companyId: 12n, userId: 2n },
      8n,
      { version: 0, nameAr: "محاولة عابرة" },
    )).rejects.toEqual(new TreasuryError("NOT_FOUND"));
    await expect(service.updatePaymentMethod(
      { companyId: 12n, userId: 2n },
      1n,
      { version: 0, nameAr: "تعديل عالمي" },
    )).rejects.toEqual(new TreasuryError("READ_ONLY_REFERENCE"));
  });
});
