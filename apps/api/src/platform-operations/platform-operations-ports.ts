export type PlatformModuleActivity = {
  code: "SALES" | "PURCHASES" | "TREASURY" | "POS" | "INVENTORY" | "PROJECTS" | "HR" | "APPROVALS" | "IMPORTS";
  total: number;
  recent: number;
};

export type PlatformOverview = {
  generatedAt: string;
  window: { days: 7 | 30 | 90; startsAt: string; endsAt: string };
  metrics: {
    totalCompanies: number;
    activeCompanies: number;
    newCompanies: number;
    totalEmployees: number;
    activeEmployees: number;
    linkedEmployees: number;
    totalUsers: number;
    activeUsers: number;
    activeSessions: number;
    systemOperations: number;
    financialDocuments: number;
    postedDocuments: number;
    securityAlerts: number;
  };
  health: {
    pendingOutbox: number;
    failedOutbox: number;
    unacknowledgedSecurityAlerts: number;
    activeCompaniesInWindow: number;
    employeeAccountCoverage: number;
    companyAdoptionRate: number;
  };
  trends: Array<{ month: string; newCompanies: number; operations: number }>;
  modules: PlatformModuleActivity[];
  topCompanies: Array<{ id: string; name: string; operations: number; lastActivityAt: string }>;
};

export type PlatformCompanyUsage = {
  users: number;
  employees: number;
  postedDocuments: number;
  operations: number;
};

export type PlatformCompanyUsageInput = {
  companyId: bigint;
  periodStart: Date;
  periodEndExclusive: Date;
};

export type PlatformCompanyQuotaUsage = Pick<PlatformCompanyUsage, "users" | "employees" | "postedDocuments">;

/** Read only the quota counters; billing retains its separate four-counter contract. */
export interface PlatformCompanyQuotaUsageQueryPort {
  companyQuotaUsage(input: PlatformCompanyUsageInput): Promise<PlatformCompanyQuotaUsage | null>;
}

export type PlatformAnalyticsComparison = "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "NONE";

export type PlatformAnalyticsDashboard = {
  generatedAt: string;
  scope: {
    company: PlatformCompanyReference | null;
  };
  period: {
    from: string;
    to: string;
    days: number;
    comparison: PlatformAnalyticsComparison;
    comparisonFrom: string | null;
    comparisonTo: string | null;
  };
  companyOptions: PlatformCompanyReference[];
  metrics: {
    operations: PlatformComparedNumber;
    postedDocuments: PlatformComparedNumber;
    activeCompanies: PlatformComparedNumber;
    newCompanies: PlatformComparedNumber;
    securityAlerts: PlatformComparedNumber;
  };
  activityTimeline: Array<{
    key: string;
    from: string;
    to: string;
    operations: number;
    previousOperations: number | null;
    postedDocuments: number;
    previousPostedDocuments: number | null;
    securityAlerts: number;
    newCompanies: number;
  }>;
  financials: Array<{
    currencyCode: string;
    recurringMonthly: string;
    billed: PlatformComparedMoney;
    collected: PlatformComparedMoney;
    collectionRate: PlatformComparedNumber;
    outstanding: string;
    overdue: string;
    invoiceCount: PlatformComparedNumber;
    timeline: Array<{
      key: string;
      from: string;
      to: string;
      billed: string;
      previousBilled: string | null;
      collected: string;
      previousCollected: string | null;
    }>;
    aging: {
      notDue: string;
      days1To30: string;
      days31To60: string;
      days61Plus: string;
    };
  }>;
  modules: Array<{
    code: PlatformModuleActivity["code"];
    current: number;
    previous: number | null;
    changePercent: number | null;
  }>;
  companies: Array<{
    id: string;
    name: string;
    currencyCode: string;
    operations: number;
    postedDocuments: number;
    billed: string;
    collected: string;
    outstanding: string;
    overdue: string;
    lastActivityAt: string | null;
  }>;
  alerts: {
    overdueInvoices: number;
    dueSoonInvoices: number;
    unacknowledgedSecurity: number;
    pendingOutbox: number;
    failedOutbox: number;
    staleCompanies: number;
  };
};

export type PlatformComparedNumber = {
  current: number;
  previous: number | null;
  changePercent: number | null;
};

export type PlatformComparedMoney = {
  current: string;
  previous: string | null;
  changePercent: number | null;
};

export type PlatformCompanySummary = {
  id: string;
  code: string;
  name: string;
  organizationName: string;
  baseCurrencyCode: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  activeUsers: number;
  activeEmployees: number;
  operations: number;
  postedDocuments: number;
  lastActivityAt: string | null;
};

export type PlatformCompanyReference = {
  id: string;
  name: string;
  isActive: boolean;
  baseCurrencyCode: string;
};

export type PlatformCompanyDetails = PlatformCompanySummary & {
  metrics: {
    totalUsers: number;
    activeUsers: number;
    totalEmployees: number;
    activeEmployees: number;
    linkedEmployees: number;
    activeSessions: number;
    totalDocuments: number;
    financialDocuments: number;
    postedDocuments: number;
    operations: number;
    securityAlerts: number;
  };
  trends: Array<{ month: string; operations: number; postedDocuments: number }>;
  modules: PlatformModuleActivity[];
  documentsByType: Array<{ type: string; total: number; posted: number }>;
};

export interface PlatformOperatorIdentityQueryPort {
  existingUserIds(userIds: readonly bigint[]): Promise<bigint[]>;
  usersByNormalizedEmails(emails: readonly string[]): Promise<Array<{
    id: bigint;
    emailNormalized: string;
  }>>;
  isActiveUser(userId: bigint): Promise<boolean>;
}

export interface PlatformOperatorAuthorizationPort {
  isActiveOperator(userId: bigint): Promise<boolean>;
}

export interface PlatformAnalyticsQueryPort {
  analytics(input: {
    now: Date;
    from: Date;
    toExclusive: Date;
    comparison: PlatformAnalyticsComparison;
    comparisonFrom: Date | null;
    comparisonToExclusive: Date | null;
    companyId?: bigint | undefined;
  }): Promise<PlatformAnalyticsDashboard | null>;
  overview(input: { now: Date; days: 7 | 30 | 90 }): Promise<PlatformOverview>;
  listCompanies(input: {
    now: Date;
    days: 7 | 30 | 90;
    search?: string | undefined;
    status?: "ALL" | "ACTIVE" | "INACTIVE" | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ data: PlatformCompanySummary[]; total: number; page: number; pageSize: number }>;
  companyDetails(input: {
    companyId: bigint;
    now: Date;
    days: 7 | 30 | 90;
  }): Promise<PlatformCompanyDetails | null>;
  companyUsage(input: PlatformCompanyUsageInput): Promise<PlatformCompanyUsage | null>;
  companyCount(): Promise<number>;
  companyReferences(companyIds?: bigint[]): Promise<PlatformCompanyReference[]>;
}
