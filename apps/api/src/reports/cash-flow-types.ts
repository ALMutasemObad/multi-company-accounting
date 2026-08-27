import type { CashFlowMappingClassification, Prisma } from "@prisma/client";

export type EffectiveCashFlowClassification = CashFlowMappingClassification | "CASH_AND_CASH_EQUIVALENTS";
export type CashFlowMappingSource = "TREASURY" | "EXPLICIT" | "TEMPLATE" | "SYSTEM" | "UNMAPPED";

export interface TreasuryCashAccountQueryPort {
  listLedgerAccountIds(tx: Prisma.TransactionClient, companyId: bigint): Promise<bigint[]>;
}

export type CashFlowLedgerAccount = {
  id: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  sourceTemplateKey: string | null;
  accountClass: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
};

export type CashFlowBalanceRow = {
  accountId: bigint;
  debit: Prisma.Decimal | null;
  credit: Prisma.Decimal | null;
};

export interface CashFlowLedgerQueryPort {
  companyHeader(tx: Prisma.TransactionClient, companyId: bigint): Promise<{
    name: string;
    baseCurrency: { id: bigint; code: string; nameAr: string; decimals: number };
  } | null>;
  listPostingAccounts(tx: Prisma.TransactionClient, companyId: bigint): Promise<CashFlowLedgerAccount[]>;
  findPostingAccount(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint): Promise<CashFlowLedgerAccount | null>;
  balances(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    entryDate: Prisma.DateTimeFilter,
  ): Promise<CashFlowBalanceRow[]>;
}

export type CashFlowAccountInput = {
  accountId: bigint;
  code: string;
  nameAr: string;
  nameEn: string | null;
  accountClass: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
  classification: EffectiveCashFlowClassification | null;
  mappingSource: CashFlowMappingSource;
  openingSigned: Prisma.Decimal;
  closingSigned: Prisma.Decimal;
  periodSigned: Prisma.Decimal;
};

export type CashFlowLine = {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  amount: string;
};
