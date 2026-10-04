import type { Prisma } from "@prisma/client";
import { TaxService } from "./tax-service.js";
import type { ServiceCatalogOutputTaxQueryPort } from "../service-catalog/service-catalog-reference-ports.js";

const account = { select: { id: true, code: true, nameAr: true, isActive: true,
  allowsPosting: true, accountType: { select: { class: true } },
  _count: { select: { children: true } } } } as const;

export class ServiceCatalogOutputTaxAdapter implements ServiceCatalogOutputTaxQueryPort {
  async readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_TAX_QUERY");
    if (!ids.length) return new Set<string>();
    const rows = await tx.taxRate.findMany({ where: { companyId, id: { in: ids } },
      include: { outputTaxAccount: account, inputTaxAccount: account } });
    return new Set(rows.filter(rate => TaxService.json(rate, "OUTPUT").isReady).map(rate => String(rate.id)));
  }
}
