import type { Prisma } from "@prisma/client";
import type {
  InventoryFinancialCloseReadinessPort,
  InventoryFinancialCloseSummary,
} from "../fiscal/financial-close-types.js";

export class InventoryFinancialCloseReadinessAdapter implements InventoryFinancialCloseReadinessPort {
  async summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; dateFrom: Date; dateTo: Date },
  ): Promise<InventoryFinancialCloseSummary> {
    const [negativeBalances, unvaluedBalances, uncostedMovements] = await Promise.all([
      tx.inventoryBalance.count({ where: { companyId: input.companyId, onHand: { lt: 0 } } }),
      tx.inventoryBalance.count({
        where: { companyId: input.companyId, onHand: { not: 0 }, isValuationInitialized: false },
      }),
      tx.inventoryMovementLine.count({
        where: {
          companyId: input.companyId,
          isCostInitialized: false,
          movement: { movementDate: { gte: input.dateFrom, lte: input.dateTo }, status: "POSTED" },
        },
      }),
    ]);
    return { negativeBalances, unvaluedBalances, uncostedMovements };
  }
}
