import type { Prisma } from "@prisma/client";

export type RegistrationCurrencyOption = {
  code: string;
  nameAr: string;
  decimals: number;
};

export type RegistrationCountryOption = { code: string; nameAr: string; nameEn: string };
export type RegistrationBusinessActivityOption = { code: string; nameAr: string; nameEn: string };

export type RegistrationChartTemplateOption = {
  code: string;
  nameAr: string;
  nameEn: string;
};

export interface RegistrationTenantPort {
  listGlobalCurrencies(): Promise<RegistrationCurrencyOption[]>;
  listCompanyCountries(): readonly RegistrationCountryOption[];
  listBusinessActivities(): Promise<RegistrationBusinessActivityOption[]>;
  isActiveGlobalCurrency(tx: Prisma.TransactionClient, code: string): Promise<boolean>;
  isSupportedCompanyCountry(code: string): boolean;
  isActiveBusinessActivity(tx: Prisma.TransactionClient, code: string): Promise<boolean>;
}

export interface RegistrationIdentityPort {
  identityExists(tx: Prisma.TransactionClient, emailNormalized: string): Promise<boolean>;
}

export interface RegistrationAccountingPort {
  listChartTemplates(): readonly RegistrationChartTemplateOption[];
  isSupportedChartTemplate(code: string): boolean;
}

export type RegistrationSecurityCompletionInput = {
  companyId: bigint;
  userId: bigint;
  emailNormalized: string;
  registrationPublicId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export interface RegistrationSecurityPort {
  recordCompletion(
    tx: Prisma.TransactionClient,
    input: RegistrationSecurityCompletionInput,
  ): Promise<void>;
}

export type RegistrationOwnerPorts = {
  tenant: RegistrationTenantPort;
  identity: RegistrationIdentityPort;
  accounting: RegistrationAccountingPort;
  security: RegistrationSecurityPort;
};
