import type { PlatformSubscriptionStatus } from "@prisma/client";

export const PLATFORM_MODULE_CODES = [
  "CORE_ACCOUNTING",
  "SALES",
  "PURCHASES",
  "TREASURY",
  "INVENTORY",
  "POS",
  "REPORTING",
  "DATA_IMPORT",
  "APPROVALS",
  "PROFESSIONAL_PROJECTS",
  "HUMAN_RESOURCES",
  "TAX",
  "CRM",
  "SERVICE_CATALOG",
] as const;

export type PlatformModuleCode = (typeof PLATFORM_MODULE_CODES)[number];

export type CompanyEntitlementSnapshot = {
  subscriptionId: bigint;
  companyId: bigint;
  status: PlatformSubscriptionStatus;
  version: number;
  plan: {
    code: string;
    versionNumber: number;
    displayName: string;
  };
  moduleCodes: PlatformModuleCode[];
};

export interface CompanyEntitlementQueryPort {
  findCompanyEntitlements(
    companyId: bigint,
    effectiveAt?: Date,
  ): Promise<CompanyEntitlementSnapshot | null>;
}

export function isPlatformModuleCode(value: string): value is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(value);
}
