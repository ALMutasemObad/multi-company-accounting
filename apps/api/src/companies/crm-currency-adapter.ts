import type { Prisma, PrismaClient } from "@prisma/client";
import type { CrmCurrencyQueryPort, CrmCurrencyReference } from "../crm/crm-reference-ports.js";

const select = { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } } as const;
const reference = (row: { currency: { id: bigint; code: string; nameAr: string; decimals: number } }): CrmCurrencyReference => ({
  currencyId: row.currency.id,
  code: row.currency.code,
  nameAr: row.currency.nameAr,
  decimals: row.currency.decimals,
});
const enabledCurrency = (companyId: bigint) => ({
  isActive: true,
  OR: [
    { scope: "GLOBAL" as const, ownerCompanyId: null },
    { scope: "COMPANY" as const, ownerCompanyId: companyId },
  ],
});

export class CrmCurrencyAdapter implements CrmCurrencyQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findEnabled(tx: Prisma.TransactionClient, companyId: bigint, currencyId: bigint) {
    const row = await tx.companyCurrency.findFirst({
      where: { companyId, currencyId, isActive: true, currency: enabledCurrency(companyId) },
      select,
    });
    return row ? reference(row) : null;
  }

  async listEnabled(companyId: bigint) {
    const rows = await this.prisma.companyCurrency.findMany({
      where: { companyId, isActive: true, currency: enabledCurrency(companyId) },
      select,
      orderBy: [{ currency: { code: "asc" } }],
    });
    return rows.map(reference);
  }
}
