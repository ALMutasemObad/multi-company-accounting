import type { Prisma } from "@prisma/client";

// Reference readiness stays with the owning accounting and tax contexts.
export interface ServiceCatalogRevenueAccountQueryPort {
  readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>>;
}

export interface ServiceCatalogOutputTaxQueryPort {
  readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>>;
}
