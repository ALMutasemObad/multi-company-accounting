import type { Prisma } from "@prisma/client";
import type { TreasuryCashAccountQueryPort } from "../reports/cash-flow-types.js";

export class TreasuryCashFlowAccountAdapter implements TreasuryCashAccountQueryPort {
  async listLedgerAccountIds(tx: Prisma.TransactionClient, companyId: bigint): Promise<bigint[]> {
    const rows = await tx.cashBankAccount.findMany({
      where: { companyId },
      select: { ledgerAccountId: true },
      distinct: ["ledgerAccountId"],
      orderBy: { ledgerAccountId: "asc" },
    });
    return rows.map((row) => row.ledgerAccountId);
  }
}
