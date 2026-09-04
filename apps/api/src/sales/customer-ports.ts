import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

export type CustomerErrorReason = "NOT_FOUND" | "CODE_EXISTS" | "INVALID_ACCOUNT";

export class CustomerError extends Error {
  constructor(public readonly reason: CustomerErrorReason) {
    super(reason);
  }
}

export type CustomerAddressInput = {
  addressType: "LEGAL" | "BILLING" | "OTHER";
  line1: string;
  line2?: string | null | undefined;
  city?: string | null | undefined;
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
  isPrimary?: boolean | undefined;
};

export type CustomerInput = {
  receivableAccountId: bigint;
  nameAr: string;
  nameEn?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxNumber?: string | null | undefined;
  addresses?: CustomerAddressInput[] | undefined;
};

export type CustomerImportReference = { id: bigint };

export interface CustomerImportPort {
  resolveImportedCustomer(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    row: Record<string, string>,
  ): Promise<CustomerInput>;
  createImportedCustomer(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: CustomerInput,
  ): Promise<CustomerImportReference>;
}

export type CrmCustomerReference = { customerId: bigint };

export type CrmCustomerOptionReference = CrmCustomerReference & {
  code: string;
  nameAr: string;
  nameEn: string | null;
};

export type CrmCustomerProvisioningInput = Omit<CustomerInput, "addresses">;

export interface CrmCustomerQueryPort {
  findActiveCustomer(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    customerId: bigint,
  ): Promise<CrmCustomerReference | null>;
  listActiveCustomers(
    companyId: bigint,
    input: { search?: string | undefined; limit: number },
  ): Promise<CrmCustomerOptionReference[]>;
}

export interface CrmCustomerProvisioningPort {
  provisionCustomer(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: CrmCustomerProvisioningInput,
  ): Promise<CrmCustomerReference>;
}
