import type { Prisma } from "@prisma/client";

export type ServiceCatalogReferenceQuery = { page: number; pageSize: number; search?: string | undefined };
export type ServiceCatalogReferencePage<T> = { data: T[]; meta: {
  page: number; pageSize: number; total: number; totalPages: number;
} };
export type ServiceCatalogRevenueAccountOption = { id: string; code: string; nameAr: string; nameEn: string | null };
export type ServiceCatalogOutputTaxOption = { id: string; code: string; nameAr: string; rate: string };

// Reference readiness stays with the owning accounting and tax contexts.
export interface ServiceCatalogRevenueAccountQueryPort {
  readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>>;
  listOptions(companyId: bigint, query: ServiceCatalogReferenceQuery): Promise<ServiceCatalogReferencePage<ServiceCatalogRevenueAccountOption>>;
}

export interface ServiceCatalogOutputTaxQueryPort {
  readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>>;
  listOptions(companyId: bigint, query: ServiceCatalogReferenceQuery): Promise<ServiceCatalogReferencePage<ServiceCatalogOutputTaxOption>>;
}
