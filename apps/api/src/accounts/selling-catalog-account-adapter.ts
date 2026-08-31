import type { Prisma } from "@prisma/client";
import type { SellingCatalogAccountPort } from "../sales/selling-profile-ports.js";
import type { PostingAccountReference } from "./account-query-port.js";

export class SellingCatalogAccountAdapter implements SellingCatalogAccountPort {
  async findMany(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Map<string, PostingAccountReference>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_ACCOUNT_QUERY");
    if (!ids.length) return new Map<string, PostingAccountReference>();
    const rows = await tx.account.findMany({ where: { companyId, id: { in: ids } },
      orderBy: { id: "asc" }, select: { id: true, companyId: true, code: true, isActive: true,
        allowsPosting: true, accountType: { select: { class: true } }, _count: { select: { children: true } } } });
    return new Map(rows.map(row => [String(row.id), { id: row.id, companyId: row.companyId, code: row.code,
      isActive: row.isActive, allowsPosting: row.allowsPosting, accountClass: row.accountType.class,
      childCount: row._count.children }]));
  }
}
