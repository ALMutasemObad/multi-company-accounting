export type OrganizationDirectory = {
  id: bigint;
  code: string;
  name: string;
};

export type OrganizationCompanyDirectoryItem = {
  id: bigint;
  code: string;
  name: string;
  timezone: string;
  isActive: boolean;
  baseCurrencyCode: string;
};

export interface OrganizationTenantQueryPort {
  organizationsByIds(ids: readonly bigint[]): Promise<OrganizationDirectory[]>;
  organizationCompanyIds(organizationId: bigint): Promise<bigint[]>;
  companiesForOrganization(
    organizationId: bigint,
    allowedCompanyIds: readonly bigint[],
  ): Promise<OrganizationCompanyDirectoryItem[]>;
}

export type OrganizationCompanyActivityMetric = {
  companyId: bigint;
  postedDocuments: number;
};

export interface OrganizationAccountingMetricsQueryPort {
  postedActivity(
    companyIds: readonly bigint[],
    from: Date,
    toExclusive: Date,
  ): Promise<OrganizationCompanyActivityMetric[]>;
}

export type OrganizationCompanyMoneyMetric = {
  companyId: bigint;
  amountBase: string;
};

export interface OrganizationSalesMetricsQueryPort {
  postedSales(
    companyIds: readonly bigint[],
    from: Date,
    toExclusive: Date,
  ): Promise<OrganizationCompanyMoneyMetric[]>;
}

export interface OrganizationPurchaseMetricsQueryPort {
  postedPurchases(
    companyIds: readonly bigint[],
    from: Date,
    toExclusive: Date,
  ): Promise<OrganizationCompanyMoneyMetric[]>;
}

export type OrganizationCompanyMetricAccess = {
  companyId: bigint;
  activeUsers: boolean;
  postedDocuments: boolean;
  postedSales: boolean;
  postedPurchases: boolean;
};

/**
 * Resolves company RBAC and subscription entitlements together. Organization
 * membership never grants access to a company's operational or financial data.
 */
export interface OrganizationMetricAuthorizationQueryPort {
  metricAccess(
    userId: bigint,
    companyIds: readonly bigint[],
    effectiveAt: Date,
  ): Promise<OrganizationCompanyMetricAccess[]>;
}
