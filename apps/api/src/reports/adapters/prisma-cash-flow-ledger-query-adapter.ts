import type { Prisma } from "@prisma/client";
import type {
  CashFlowBalanceRow,
  CashFlowLedgerAccount,
  CashFlowLedgerQueryPort,
} from "../cash-flow-types.js";

const accountSelection = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  sourceTemplateKey: true,
  accountType: { select: { class: true, normalBalance: true } },
} as const;

const accountJson = (account: Prisma.AccountGetPayload<{ select: typeof accountSelection }>): CashFlowLedgerAccount => ({
  id: account.id,
  code: account.code,
  nameAr: account.nameAr,
  nameEn: account.nameEn,
  sourceTemplateKey: account.sourceTemplateKey,
  accountClass: account.accountType.class,
  normalBalance: account.accountType.normalBalance,
});

export class PrismaCashFlowLedgerQueryAdapter implements CashFlowLedgerQueryPort {
  companyHeader(tx: Prisma.TransactionClient, companyId: bigint) {
    return tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
    });
  }

  async listPostingAccounts(tx: Prisma.TransactionClient, companyId: bigint) {
    const accounts = await tx.account.findMany({
      where: { companyId, allowsPosting: true },
      select: accountSelection,
      orderBy: { code: "asc" },
    });
    return accounts.map(accountJson);
  }

  async findPostingAccount(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint) {
    const account = await tx.account.findFirst({
      where: { id: accountId, companyId, allowsPosting: true },
      select: accountSelection,
    });
    return account ? accountJson(account) : null;
  }

  async balances(tx: Prisma.TransactionClient, companyId: bigint, entryDate: Prisma.DateTimeFilter): Promise<CashFlowBalanceRow[]> {
    const rows = await tx.journalLine.groupBy({
      by: ["accountId"],
      where: {
        companyId,
        journalEntry: {
          entryDate,
          accountingDocument: {
            status: { in: ["POSTED", "REVERSED"] },
            documentType: { not: "PERIOD_CLOSE" },
          },
        },
      },
      _sum: { baseDebitAmount: true, baseCreditAmount: true },
    });
    return rows.map((row) => ({
      accountId: row.accountId,
      debit: row._sum.baseDebitAmount,
      credit: row._sum.baseCreditAmount,
    }));
  }
}
