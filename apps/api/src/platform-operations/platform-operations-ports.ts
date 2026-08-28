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

export interface PlatformIdentityQueryPort {
  activeEmailForUser(userId: bigint): Promise<string | null>;
}

export interface PlatformAnalyticsQueryPort {
  overview(input: { now: Date; days: 7 | 30 | 90 }): Promise<PlatformOverview>;
}
