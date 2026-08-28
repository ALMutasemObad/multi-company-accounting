import type { Prisma } from "@prisma/client";
import type { CompanyCurrencyUsageQueryPort } from "../companies/company-currency-usage-port.js";

export class PurchasesCompanyCurrencyUsageAdapter implements CompanyCurrencyUsageQueryPort {
  async isAnyCurrencyUsed(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyIds: readonly bigint[],
  ) {
    const row = await tx.purchaseInvoice.findFirst({
      where: { companyId, currencyId: { in: [...currencyIds] } },
      select: { id: true },
    });
    return Boolean(row);
  }
}
