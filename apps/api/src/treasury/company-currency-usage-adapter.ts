import type { Prisma } from "@prisma/client";
import type { CompanyCurrencyUsageQueryPort } from "../companies/company-currency-usage-port.js";

export class TreasuryCompanyCurrencyUsageAdapter implements CompanyCurrencyUsageQueryPort {
  async isAnyCurrencyUsed(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyIds: readonly bigint[],
  ) {
    const where = { companyId, currencyId: { in: [...currencyIds] } };
    const [receipt, payment] = await Promise.all([
      tx.receipt.findFirst({ where, select: { id: true } }),
      tx.payment.findFirst({ where, select: { id: true } }),
    ]);
    return Boolean(receipt || payment);
  }
}
