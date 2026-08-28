import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

export type SupplierErrorReason = "NOT_FOUND" | "CODE_EXISTS" | "INVALID_ACCOUNT";

export class SupplierError extends Error {
  constructor(public readonly reason: SupplierErrorReason) {
    super(reason);
  }
}

export type SupplierAddressInput = {
  addressType: "LEGAL" | "PAYMENT" | "OTHER";
  line1: string;
  line2?: string | null | undefined;
  city?: string | null | undefined;
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
  isPrimary?: boolean | undefined;
};

export type SupplierInput = {
  payableAccountId: bigint;
  nameAr: string;
  nameEn?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxNumber?: string | null | undefined;
  addresses?: SupplierAddressInput[] | undefined;
};

export type SupplierImportReference = { id: bigint };

export interface SupplierImportPort {
  resolveImportedSupplier(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    row: Record<string, string>,
  ): Promise<SupplierInput>;
  createImportedSupplier(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: SupplierInput,
  ): Promise<SupplierImportReference>;
}
