import type { Prisma } from "@prisma/client";
import type { SellingCatalogTaxPort } from "../sales/selling-profile-ports.js";
import { TaxService } from "./tax-service.js";

const account = { select: { id: true, code: true, nameAr: true, isActive: true, allowsPosting: true,
  accountType: { select: { class: true } }, _count: { select: { children: true } } } } as const;

export class SellingCatalogTaxAdapter implements SellingCatalogTaxPort {
  async readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]) {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_TAX_QUERY");
    if (!ids.length) return new Set<string>();
    const rates = await tx.taxRate.findMany({ where: { companyId, id: { in: ids } },
      include: { outputTaxAccount: account, inputTaxAccount: account }, orderBy: { id: "asc" } });
    // Use the owner's existing OUTPUT readiness policy, including zero-rate/no-account behavior.
    return new Set(rates.filter(rate => TaxService.json(rate, "OUTPUT").isReady).map(rate => String(rate.id)));
  }
}
