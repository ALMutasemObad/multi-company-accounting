import type { Prisma } from "@prisma/client";
import { validRevenueAccount } from "../sales/selling-profile-policy.js";
import type { ServiceCatalogRevenueAccountQueryPort } from "../service-catalog/service-catalog-reference-ports.js";

export class ServiceCatalogRevenueAccountAdapter implements ServiceCatalogRevenueAccountQueryPort {
  async readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_ACCOUNT_QUERY");
    if (!ids.length) return new Set<string>();
    const rows = await tx.account.findMany({ where: { companyId, id: { in: ids } },
      select: { id: true, isActive: true, allowsPosting: true,
        accountType: { select: { class: true } }, _count: { select: { children: true } } } });
    return new Set(rows.filter(row => validRevenueAccount({ isActive: row.isActive,
      allowsPosting: row.allowsPosting, accountClass: row.accountType.class,
      childCount: row._count.children })).map(row => String(row.id)));
  }
}
