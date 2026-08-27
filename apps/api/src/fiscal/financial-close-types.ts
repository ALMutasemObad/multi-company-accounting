import type { Prisma } from "@prisma/client";

export type FinancialCloseChecklistStatus = "PASS" | "BLOCKED" | "WARNING";

export type FinancialCloseChecklistItem = {
  code:
    | "EARLIER_PERIODS_CLOSED"
    | "NO_DRAFT_DOCUMENTS"
    | "LEDGER_BALANCED"
    | "SUBLEDGERS_RECONCILED"
    | "BANK_RECONCILIATION_COMPLETE"
    | "INVENTORY_READY"
    | "EXCHANGE_RATES_AVAILABLE"
    | "RETAINED_EARNINGS_READY";
  status: FinancialCloseChecklistStatus;
  count: number;
  details: string[];
};

export type FinancialCloseReadiness = {
  periodId: string;
  periodVersion: number;
  isYearEnd: boolean;
  ready: boolean;
  checkedAt: string;
  items: FinancialCloseChecklistItem[];
};

export type TreasuryFinancialCloseSummary = {
  openSessions: number;
  closedSessions: number;
};

export type InventoryFinancialCloseSummary = {
  negativeBalances: number;
  unvaluedBalances: number;
  uncostedMovements: number;
};

export type CurrencyFinancialCloseSummary = {
  missingRateCurrencyCodes: string[];
};

export type SettlementFinancialCloseSummary = {
  invalidReceivables: number;
  invalidPayables: number;
};

export interface TreasuryFinancialCloseReadinessPort {
  summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; dateFrom: Date; dateTo: Date },
  ): Promise<TreasuryFinancialCloseSummary>;
}

export interface InventoryFinancialCloseReadinessPort {
  summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; dateFrom: Date; dateTo: Date },
  ): Promise<InventoryFinancialCloseSummary>;
}

export interface CurrencyFinancialCloseReadinessPort {
  summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; currencyIds: bigint[]; asOf: Date },
  ): Promise<CurrencyFinancialCloseSummary>;
}

export interface SettlementFinancialCloseReadinessPort {
  summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; asOf: Date },
  ): Promise<SettlementFinancialCloseSummary>;
}

export type FinancialCloseReadinessPorts = {
  treasury: TreasuryFinancialCloseReadinessPort;
  inventory: InventoryFinancialCloseReadinessPort;
  currencies: CurrencyFinancialCloseReadinessPort;
  settlements: SettlementFinancialCloseReadinessPort;
};
