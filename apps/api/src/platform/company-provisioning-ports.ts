import type { Prisma } from "@prisma/client";

export type CompanyProvisioningErrorReason =
  | "CURRENCY_NOT_FOUND"
  | "COMPANY_CURRENCY_MISMATCH"
  | "ADMIN_USER_DISABLED"
  | "ADMIN_USER_EXISTS"
  | "EXTERNAL_IDENTITY_EXISTS";

export class CompanyProvisioningError extends Error {
  constructor(public readonly reason: CompanyProvisioningErrorReason) {
    super(reason);
  }
}

export type TenantProvisioningInput = {
  organizationCode: string;
  organizationName: string;
  companyCode: string;
  companyName: string;
  timezone: string;
  baseCurrencyCode: string;
};

export type TenantProvisioningResult = {
  organization: { id: bigint; code: string; name: string };
  company: { id: bigint; code: string; name: string; timezone: string; createdAt: Date };
  baseCurrency: { id: bigint; code: string };
  created: boolean;
};

export interface TenantCompanyProvisioningPort {
  provisionTenant(
    tx: Prisma.TransactionClient,
    input: TenantProvisioningInput,
  ): Promise<TenantProvisioningResult>;
}

export type AdministratorProvisioningInput = {
  organizationId: bigint;
  companyId: bigint;
  email: string;
  displayName: string;
  passwordHash: string | null;
  externalIdentity?: {
    provider: "GOOGLE" | "APPLE";
    issuer: string;
    subject: string;
    emailSnapshot: string | null;
    privateRelay: boolean;
  } | undefined;
  requireNewIdentity: boolean;
};

export type AdministratorProvisioningResult = {
  administrator: { id: bigint; email: string };
  organizationRole: "OWNER" | "ADMIN" | "VIEWER";
  reusedIdentity: boolean;
  permissionsGranted: number;
};

export interface IdentityCompanyProvisioningPort {
  provisionAdministrator(
    tx: Prisma.TransactionClient,
    input: AdministratorProvisioningInput,
  ): Promise<AdministratorProvisioningResult>;
}

export type DefaultChartProvisioningResult = {
  templateCode: string;
  version: number;
  accountsCreated: number;
};

export interface AccountingCompanyProvisioningPort {
  provisionAccounting(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    initializeDefaultChart: boolean,
  ): Promise<DefaultChartProvisioningResult | null>;
}

export interface TreasuryCompanyProvisioningPort {
  provisionTreasury(tx: Prisma.TransactionClient): Promise<void>;
}

export type CompanyProvisioningCommand = TenantProvisioningInput & {
  adminEmail: string;
  adminDisplayName: string;
};

export type CompanyProvisioningResult = {
  organization: { id: string; code: string; name: string };
  company: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    baseCurrencyCode: string;
  };
  administrator: { id: string; email: string; reusedIdentity: boolean };
  permissionsGranted: number;
  defaultChart: DefaultChartProvisioningResult | null;
};

export interface CompanyProvisioningPort {
  provisionPreparedInTransaction(
    tx: Prisma.TransactionClient,
    input: CompanyProvisioningCommand,
    passwordHash: string | null,
    options?: {
      requireNewAdminIdentity?: boolean;
      externalIdentity?: AdministratorProvisioningInput["externalIdentity"];
    },
  ): Promise<CompanyProvisioningResult>;
}
