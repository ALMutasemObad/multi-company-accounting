import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  ReconciliationLedgerQueryPort,
  ReconciliationLedgerSnapshot,
  TreasuryMovementFact,
} from "../reconciliation-types.js";

type LedgerMovementRow = {
  id: bigint;
  entryDate: Date;
  amount: Prisma.Decimal;
  currencyCode: string;
  reference: string | null;
  documentType: string;
  documentNumber: string;
};

type LedgerBalanceRow = { amount: Prisma.Decimal | null };

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const movementKey = (companyId: bigint, row: LedgerMovementRow) =>
  createHash("sha256")
    .update(`${companyId}:${row.id}:${row.documentType}:${row.documentNumber}`)
    .digest("hex");

const movementQuery = (
  input: {
    companyId: bigint;
    ledgerAccountId: bigint;
    currencyCode: string;
    dateFrom: Date;
    dateToExclusive: Date;
  },
  lockMovements: boolean,
) => Prisma.sql`
  SELECT
    jl.id AS id,
    je.entry_date AS entryDate,
    (jl.debit_amount - jl.credit_amount) AS amount,
    c.code AS currencyCode,
    COALESCE(r.reference_number, p.reference_number, ad.document_number) AS reference,
    CAST(ad.document_type AS CHAR) AS documentType,
    ad.document_number AS documentNumber
  FROM journal_lines jl
  JOIN journal_entries je
    ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN accounting_documents ad
    ON ad.id = je.accounting_document_id AND ad.company_id = je.company_id
  JOIN currencies c ON c.id = jl.currency_id
  LEFT JOIN receipts r
    ON r.accounting_document_id = ad.id AND r.company_id = ad.company_id
  LEFT JOIN payments p
    ON p.accounting_document_id = ad.id AND p.company_id = ad.company_id
  WHERE jl.company_id = ${input.companyId}
    AND jl.account_id = ${input.ledgerAccountId}
    AND c.code = ${input.currencyCode}
    AND ad.status = 'POSTED'
    AND je.entry_date >= ${input.dateFrom}
    AND je.entry_date < ${input.dateToExclusive}
  ORDER BY jl.id
  ${lockMovements ? Prisma.sql`FOR UPDATE` : Prisma.empty}
`;

export class PrismaReconciliationLedgerQueryAdapter implements ReconciliationLedgerQueryPort {
  async snapshot(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      ledgerAccountId: bigint;
      currencyCode: string;
      range: { dateFrom: string; dateTo: string };
      lockMovements: boolean;
    },
  ): Promise<ReconciliationLedgerSnapshot> {
    const dateFrom = new Date(`${input.range.dateFrom}T00:00:00.000Z`);
    const dateToExclusive = new Date(Date.parse(`${input.range.dateTo}T00:00:00.000Z`) + 86_400_000);
    const rows = await tx.$queryRaw<LedgerMovementRow[]>(movementQuery({ ...input, dateFrom, dateToExclusive }, input.lockMovements));
    const openingRows = await tx.$queryRaw<LedgerBalanceRow[]>`
      SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS amount
      FROM journal_lines jl
      JOIN journal_entries je
        ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
      JOIN accounting_documents ad
        ON ad.id = je.accounting_document_id AND ad.company_id = je.company_id
      JOIN currencies c ON c.id = jl.currency_id
      WHERE jl.company_id = ${input.companyId}
        AND jl.account_id = ${input.ledgerAccountId}
        AND c.code = ${input.currencyCode}
        AND ad.status = 'POSTED'
        AND je.entry_date < ${dateFrom}
    `;
    const opening = new Prisma.Decimal(openingRows[0]?.amount ?? 0);
    const net = rows.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
    const movements: TreasuryMovementFact[] = rows.map((row) => ({
      key: movementKey(input.companyId, row),
      occurredOn: isoDate(row.entryDate),
      amount: new Prisma.Decimal(row.amount).toFixed(4),
      currency: row.currencyCode,
      ...(row.reference ? { reference: row.reference } : {}),
      documentType: row.documentType,
      documentNumber: row.documentNumber,
    }));
    return {
      openingBalance: opening.toFixed(4),
      netMovement: net.toFixed(4),
      closingBalance: opening.plus(net).toFixed(4),
      movements,
    };
  }
}
