import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { PostingAccountReference } from "../accounts/account-query-port.js";
import type { SellingProfileReadinessReason } from "./selling-profile-policy.js";

export type SellingCatalogItemReference = {
  id: bigint; code: string; nameAr: string; nameEn: string | null;
  description: string | null; isActive: boolean;
  unitOfMeasure: {
    id: bigint; code: string; nameAr: string; nameEn: string | null;
    decimalPlaces: number; isActive: boolean;
  };
};
export type SellingCatalogQuery = { page: number; pageSize: number; search?: string | undefined };

// Reference adapters live with their data owner. No barcode lookup or parsing belongs here.
export interface SellingCatalogInventoryPort {
  list(tx: Prisma.TransactionClient, companyId: bigint, query: SellingCatalogQuery):
    Promise<{ data: SellingCatalogItemReference[]; total: number }>;
  find(tx: Prisma.TransactionClient, companyId: bigint, itemId: bigint): Promise<SellingCatalogItemReference | null>;
}
export interface SellingCatalogAccountPort {
  findMany(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Map<string, PostingAccountReference>>;
}
export interface SellingCatalogTaxPort {
  // The Tax owner decides OUTPUT readiness; this is not a local tax calculator.
  readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>>;
}
export interface SellingCatalogCurrencyPort {
  enabled(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Map<string, { id: bigint; code: string }>>;
}

export type SellingProfileValues = {
  unitPrice: string; currencyId: bigint; revenueAccountId: bigint; taxRateId: bigint | null; isActive: boolean;
};
export type SellingProfileRecord = SellingProfileValues & {
  id: bigint; companyId: bigint; inventoryItemId: bigint; version: number;
};
export type SellingProfileCreate = Omit<SellingProfileValues, "isActive">;
export type SellingProfileUpdate = Partial<SellingProfileValues> & { version: number };

export interface SellingProfileRepository {
  findMany(tx: Prisma.TransactionClient, companyId: bigint, itemIds: bigint[]): Promise<SellingProfileRecord[]>;
  create(tx: Prisma.TransactionClient, companyId: bigint, itemId: bigint, values: SellingProfileValues): Promise<SellingProfileRecord>;
  update(tx: Prisma.TransactionClient, companyId: bigint, itemId: bigint, version: number, values: SellingProfileValues): Promise<SellingProfileRecord>;
}
export interface SellingProfileAuditPort {
  append(tx: Prisma.TransactionClient, context: ActorContext, input: {
    action: "SELLING_PROFILE_CREATED" | "SELLING_PROFILE_UPDATED";
    profileId: bigint; inventoryItemId: bigint; fromVersion: number | null; toVersion: number;
  }): Promise<void>;
}
export type SellingProfileJson = {
  id: string; unitPrice: string; currencyId: string; currencyCode: string | null;
  revenueAccountId: string; taxRateId: string | null; isActive: boolean; version: number;
};
export type SellingCatalogItemJson = {
  inventoryItemId: string; code: string; nameAr: string; nameEn: string | null;
  description: string | null; isActive: boolean;
  unitOfMeasure: { id: string; code: string; nameAr: string; nameEn: string | null; decimalPlaces: number; isActive: boolean };
  sellingProfile: SellingProfileJson | null;
  isReady: boolean; readinessReason: SellingProfileReadinessReason | null;
};
export interface SellingCatalogQueryPort {
  list(context: ActorContext, query: SellingCatalogQuery): Promise<{
    data: SellingCatalogItemJson[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  get(context: ActorContext, itemId: bigint): Promise<{ data: SellingCatalogItemJson }>;
}
