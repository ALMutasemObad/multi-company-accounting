import type { Prisma } from "@prisma/client";

export type ReconciliationDateRange = {
  dateFrom: string;
  dateTo: string;
};

export type ReconciliationStatementFact = {
  id: bigint;
  bookingDate: string;
  amount: string;
  currency: string;
  reference?: string;
};

export type TreasuryMovementFact = {
  key: string;
  occurredOn: string;
  amount: string;
  currency: string;
  reference?: string;
  documentType: string;
  documentNumber: string;
};

export type ReconciliationLedgerSnapshot = {
  openingBalance: string;
  closingBalance: string;
  netMovement: string;
  movements: TreasuryMovementFact[];
};

export interface ReconciliationLedgerQueryPort {
  snapshot(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      ledgerAccountId: bigint;
      currencyCode: string;
      range: ReconciliationDateRange;
      lockMovements: boolean;
    },
  ): Promise<ReconciliationLedgerSnapshot>;
}

export type ReconciliationProposal = {
  bankStatementLineId: bigint;
  bookMovement: TreasuryMovementFact;
  rule: "EXACT_REFERENCE_AMOUNT_CURRENCY" | "EXACT_AMOUNT_CURRENCY_DATE";
  score: 100 | 70;
};

export interface ReconciliationMatcherPort {
  propose(
    statementLines: readonly ReconciliationStatementFact[],
    bookMovements: readonly TreasuryMovementFact[],
    options?: { dateWindowDays?: number },
  ): ReconciliationProposal[];
}
