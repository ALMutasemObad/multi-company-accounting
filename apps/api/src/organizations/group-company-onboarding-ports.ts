import type { Prisma } from "@prisma/client";

export type GroupCompanyInput = { companyName: string; timezone: string; baseCurrencyCode: string };
export type GroupCompanyResult = { organizationId: string; company: {
  id: string; code: string; name: string; timezone: string; baseCurrencyCode: string;
} };
export class GroupCompanyOnboardingError extends Error {
  constructor(public readonly reason: "INVALID_COMPANY_OPTION" | "COMPANY_SETUP_UNAVAILABLE") { super(reason); }
}
export interface GroupCompanyIdentityPort {
  authorizeOwner(tx: Prisma.TransactionClient, userId: bigint, organizationId: bigint): Promise<void>;
  grantNewCompanyAdministrator(tx: Prisma.TransactionClient, userId: bigint, companyId: bigint): Promise<void>;
}
export interface GroupCompanyTenantPort {
  createCompany(tx: Prisma.TransactionClient, organizationId: bigint, input: GroupCompanyInput): Promise<{
    id: bigint; code: string; name: string; timezone: string; baseCurrencyCode: string; createdAt: Date;
  }>;
  currencies(): Promise<Array<{ code: string; nameAr: string }>>;
}
