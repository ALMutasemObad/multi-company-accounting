import type { Prisma } from "@prisma/client";
import type {
  TreasuryFinancialCloseReadinessPort,
  TreasuryFinancialCloseSummary,
} from "../fiscal/financial-close-types.js";

export class TreasuryFinancialCloseReadinessAdapter implements TreasuryFinancialCloseReadinessPort {
  async summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; dateFrom: Date; dateTo: Date },
  ): Promise<TreasuryFinancialCloseSummary> {
    const overlap = { dateFrom: { lte: input.dateTo }, dateTo: { gte: input.dateFrom } };
    const [openSessions, closedSessions] = await Promise.all([
      tx.bankReconciliationSession.count({
        where: { companyId: input.companyId, status: "OPEN", ...overlap },
      }),
      tx.bankReconciliationSession.count({
        where: { companyId: input.companyId, status: "CLOSED", ...overlap },
      }),
    ]);
    return { openSessions, closedSessions };
  }
}
