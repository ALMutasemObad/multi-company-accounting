import type { Prisma } from "@prisma/client";
import type {
  CurrencyFinancialCloseReadinessPort,
  CurrencyFinancialCloseSummary,
} from "../fiscal/financial-close-types.js";

export class CompanyCurrencyFinancialCloseReadinessAdapter implements CurrencyFinancialCloseReadinessPort {
  async summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; currencyIds: bigint[]; asOf: Date },
  ): Promise<CurrencyFinancialCloseSummary> {
    const company = await tx.company.findUniqueOrThrow({
      where: { id: input.companyId },
      select: { baseCurrencyId: true },
    });
    const foreignIds = [...new Set(input.currencyIds.map(String))]
      .map(BigInt)
      .filter((currencyId) => currencyId !== company.baseCurrencyId)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (foreignIds.length === 0) return { missingRateCurrencyCodes: [] };

    const currencies = await tx.currency.findMany({
      where: { id: { in: foreignIds } },
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    });
    const missingRateCurrencyCodes: string[] = [];
    for (const currency of currencies) {
      const rate = await tx.companyExchangeRate.findFirst({
        where: {
          companyId: input.companyId,
          currencyId: currency.id,
          rateDate: { lte: input.asOf },
        },
        select: { id: true },
        orderBy: [{ rateDate: "desc" }, { id: "desc" }],
      });
      if (!rate) missingRateCurrencyCodes.push(currency.code);
    }
    return { missingRateCurrencyCodes };
  }
}
