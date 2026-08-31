import type { Prisma } from "@prisma/client";
import type { SellingCatalogCurrencyPort } from "../sales/selling-profile-ports.js";

export class SellingCatalogCurrencyAdapter implements SellingCatalogCurrencyPort {
  async enabled(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Map<string, { id: bigint; code: string }>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_CURRENCY_QUERY");
    if (!ids.length) return new Map<string, { id: bigint; code: string }>();
    const rows = await tx.companyCurrency.findMany({ where: { companyId, currencyId: { in: ids }, isActive: true,
      currency: { isActive: true, OR: [{ scope: "GLOBAL", ownerCompanyId: null },
        { scope: "COMPANY", ownerCompanyId: companyId }] } },
      select: { currency: { select: { id: true, code: true } } }, orderBy: { currencyId: "asc" } });
    return new Map(rows.map(row => [String(row.currency.id), row.currency]));
  }
}
