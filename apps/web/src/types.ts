export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Company = { id: string; name: string };
export type User = { id: string; displayName: string };
export type PlatformModuleCode =
  | "CORE_ACCOUNTING"
  | "SALES"
  | "PURCHASES"
  | "TREASURY"
  | "INVENTORY"
  | "POS"
  | "REPORTING"
  | "DATA_IMPORT"
  | "APPROVALS"
  | "PROFESSIONAL_PROJECTS"
  | "HUMAN_RESOURCES"
  | "TAX"
  | "CRM"
  | "SERVICE_CATALOG";
export type CurrentAuthorization = {
  user: User;
  selectedCompany: (Company & { timezone: string }) | null;
  modules: PlatformModuleCode[];
  permissions: string[];
};
export type OrganizationMembershipRole = "OWNER" | "ADMIN" | "VIEWER";
export type OrganizationWorkspaceReference = {
  id: string;
  code: string;
  name: string;
  role: OrganizationMembershipRole;
};
export type OrganizationDashboardCompany = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  isActive: boolean;
  canSwitch: boolean;
  baseCurrencyCode: string;
  metricAccess: {
    activeUsers: boolean;
    postedDocuments: boolean;
    postedSales: boolean;
    postedPurchases: boolean;
  };
  activeUsers: number | null;
  postedDocuments: number | null;
  postedSalesBase: string | null;
  postedPurchasesBase: string | null;
};
export type OrganizationDashboard = {
  generatedAt: string;
  period: { days: 30 | 90 | 365; from: string; to: string };
  organization: OrganizationWorkspaceReference & {
    memberCount: number;
    canManageMembers: boolean;
    canManageOwners: boolean;
  };
  companies: OrganizationDashboardCompany[];
  boundaries: {
    companyAccessRequired: true;
    companyPermissionsRequired: true;
    consolidatedStatements: false;
    intercompanyEliminations: false;
    crossCurrencyAggregation: false;
  };
};
export type OrganizationMember = {
  user: { id: string; displayName: string; email: string; isActive: boolean };
  role: OrganizationMembershipRole;
  isActive: boolean;
  version: number;
  activeCompanyAccess: number;
  createdAt: string;
  updatedAt: string;
};
export type EmployeeAccountOption = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "ON_LEAVE" | "TERMINATED" };
export type AdminUser = { id: string; email: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "LOCKED" | "DISABLED"; lastLoginAt: string | null; createdAt: string; updatedAt: string; employee: EmployeeAccountOption | null };
export type Permission = { id: string; code: string; module: string; descriptionAr: string };
export type Role = { id: string; code: string; nameAr: string; nameEn: string | null; isSystemRole: boolean; isActive: boolean; assignedUsers: number; permissionIds: string[]; permissions: string[] };
export type UserRole = { roleId: string; roleCode: string; isActive: boolean; assignedAt: string };
export type UserSession = { id: string; createdAt: string; lastActivityAt: string; expiresAt: string; current: boolean; revoked: boolean };

export type PlatformOverview = {
  generatedAt: string;
  window: { days: 7 | 30 | 90; startsAt: string; endsAt: string };
  metrics: {
    totalCompanies: number; activeCompanies: number; newCompanies: number;
    totalEmployees: number; activeEmployees: number; linkedEmployees: number;
    totalUsers: number; activeUsers: number; activeSessions: number;
    systemOperations: number; financialDocuments: number; postedDocuments: number; securityAlerts: number;
  };
  health: {
    pendingOutbox: number; failedOutbox: number; unacknowledgedSecurityAlerts: number;
    activeCompaniesInWindow: number; employeeAccountCoverage: number; companyAdoptionRate: number;
  };
  trends: Array<{ month: string; newCompanies: number; operations: number }>;
  modules: Array<{ code: "SALES" | "PURCHASES" | "TREASURY" | "POS" | "INVENTORY" | "PROJECTS" | "HR" | "APPROVALS" | "IMPORTS"; total: number; recent: number }>;
  topCompanies: Array<{ id: string; name: string; operations: number; lastActivityAt: string }>;
};
export type PlatformCompanyReference = { id: string; name: string; isActive: boolean; baseCurrencyCode: string };
export type PlatformAnalyticsComparison = "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "NONE";
export type PlatformComparedNumber = { current: number; previous: number | null; changePercent: number | null };
export type PlatformComparedMoney = { current: string; previous: string | null; changePercent: number | null };
export type PlatformAnalyticsDashboard = {
  generatedAt: string;
  scope: { company: PlatformCompanyReference | null };
  period: {
    from: string; to: string; days: number; comparison: PlatformAnalyticsComparison;
    comparisonFrom: string | null; comparisonTo: string | null;
  };
  companyOptions: PlatformCompanyReference[];
  metrics: {
    operations: PlatformComparedNumber; postedDocuments: PlatformComparedNumber;
    activeCompanies: PlatformComparedNumber; newCompanies: PlatformComparedNumber;
    securityAlerts: PlatformComparedNumber;
  };
  activityTimeline: Array<{
    key: string; from: string; to: string; operations: number; previousOperations: number | null;
    postedDocuments: number; previousPostedDocuments: number | null; securityAlerts: number; newCompanies: number;
  }>;
  financials: Array<{
    currencyCode: string; recurringMonthly: string; billed: PlatformComparedMoney; collected: PlatformComparedMoney;
    collectionRate: PlatformComparedNumber; outstanding: string; overdue: string; invoiceCount: PlatformComparedNumber;
    timeline: Array<{
      key: string; from: string; to: string; billed: string; previousBilled: string | null;
      collected: string; previousCollected: string | null;
    }>;
    aging: { notDue: string; days1To30: string; days31To60: string; days61Plus: string };
  }>;
  modules: Array<{
    code: PlatformOverview["modules"][number]["code"];
    current: number; previous: number | null; changePercent: number | null;
  }>;
  companies: Array<{
    id: string; name: string; currencyCode: string; operations: number; postedDocuments: number;
    billed: string; collected: string; outstanding: string; overdue: string; lastActivityAt: string | null;
  }>;
  alerts: {
    overdueInvoices: number; dueSoonInvoices: number; unacknowledgedSecurity: number;
    pendingOutbox: number; failedOutbox: number; staleCompanies: number;
  };
};
export type PlatformCompanySummary = {
  id: string; code: string; name: string; organizationName: string; baseCurrencyCode: string;
  timezone: string; isActive: boolean; createdAt: string; activeUsers: number; activeEmployees: number;
  operations: number; postedDocuments: number; lastActivityAt: string | null;
};
export type PlatformCompanyList = { data: PlatformCompanySummary[]; total: number; page: number; pageSize: number };
export type PlatformCompanyDetails = PlatformCompanySummary & {
  metrics: {
    totalUsers: number; activeUsers: number; totalEmployees: number; activeEmployees: number;
    linkedEmployees: number; activeSessions: number; totalDocuments: number; financialDocuments: number;
    postedDocuments: number; operations: number; securityAlerts: number;
  };
  trends: Array<{ month: string; operations: number; postedDocuments: number }>;
  modules: PlatformOverview["modules"];
  documentsByType: Array<{ type: string; total: number; posted: number }>;
};
export type PlatformBillingAccount = {
  id: string; companyId: string; status: "TRIAL" | "ACTIVE" | "PAUSED" | "CLOSED";
  planName: string; billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL"; currencyCode: string;
  recurringFee: string; includedUsers: number; pricePerAdditionalUser: string;
  includedEmployees: number; pricePerAdditionalEmployee: string;
  includedPostedDocuments: number; pricePerAdditionalPostedDocument: string;
  taxRate: string; paymentTermsDays: number; nextBillingDate: string | null; notes: string | null;
  version: number; createdAt: string; updatedAt: string;
};
export type PlatformBillingInvoice = {
  id: string; companyId: string; billingAccountId: string; invoiceNumber: string;
  subscriptionId: string | null; planVersionId: string | null; subscriptionChangeId: string | null; planDisplayNameSnapshot: string | null;
  state: "ISSUED" | "VOID"; status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID";
  periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currencyCode: string;
  usage: { users: number; employees: number; postedDocuments: number; operations: number };
  subtotal: string; taxRate: string; taxAmount: string; totalAmount: string; paidAmount: string; balance: string;
  notes: string | null; version: number; voidedAt: string | null; voidReason: string | null; createdAt: string;
  lines: Array<{ id: string; lineNumber: number; lineType: "RECURRING_FEE" | "ADDITIONAL_USERS" | "ADDITIONAL_EMPLOYEES" | "ADDITIONAL_POSTED_DOCUMENTS" | "ADJUSTMENT"; description: string; quantity: number; unitPrice: string; amount: string }>;
  paymentCount: number;
  payments: Array<{ id: string; paymentDate: string; amount: string; method: "BANK_TRANSFER" | "CARD" | "CASH" | "OTHER"; reference: string | null; notes: string | null; createdAt: string }>;
};
export type PlatformCompanyBilling = {
  company: { id: string; name: string; isActive: boolean; baseCurrencyCode: string };
  account: PlatformBillingAccount | null;
  totals: { billed: string; paid: string; balance: string; overdue: string };
  invoices: PlatformBillingInvoice[];
  meta: PageMeta;
};
export type PlatformBillingSummary = {
  generatedAt: string;
  metrics: { totalCompanies: number; configuredCompanies: number; unconfiguredCompanies: number; activeAccounts: number; overdueInvoices: number };
  currencies: Array<{ currencyCode: string; recurringMonthly: string; billed: string; paid: string; balance: string; overdue: string; collectionRate: string }>;
  accounts: Array<{ companyId: string; companyName: string; companyActive: boolean; account: PlatformBillingAccount; billed: string; paid: string; balance: string; overdue: string }>;
  meta: PageMeta;
};
export type SubscriptionPlanModule = {
  id: string; code: string; displayName: string; active: boolean;
  selectionMode: "INCLUDED" | "OPTIONAL"; additionalRecurringFee: string | null;
  dependencyIds: string[];
};
export type SubscriptionPlanVersion = {
  id: string; planId: string; planCode: string; versionNumber: number; displayName: string;
  description: string | null; billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  currencyCode: string; recurringFee: string | null;
  includedUsers: number | null; pricePerAdditionalUser: string | null;
  includedEmployees: number | null; pricePerAdditionalEmployee: string | null;
  includedPostedDocuments: number | null; pricePerAdditionalPostedDocument: string | null;
  taxRate: string; paymentTermsDays: number; trialDays: number; effectiveFrom: string;
  selfServicePolicy: "DISABLED" | "REQUEST_ONLY" | "IMMEDIATE_FREE";
  publicationStatus: "DRAFT" | "PUBLISHED"; publishedAt: string | null; retiredAt: string | null;
  publiclyListed?: boolean;
  version: number; modules: SubscriptionPlanModule[];
};
export type SubscriptionChange = {
  id: string | null; state: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED";
  source: "COMPANY_OWNER" | "PLATFORM_OPERATOR" | "MIGRATION";
  requestedAt: string; effectiveAt: string | null; decidedAt: string | null; decisionReason: string | null;
  quote: { currencyCode: string; baseRecurringFee: string; optionalRecurringFee: string; totalRecurringFee: string };
  plan: SubscriptionPlanVersion;
  modules: Array<{ id: string; code: string; displayName: string; selectionMode: "INCLUDED" | "OPTIONAL" }>;
};
export type SubscriptionSnapshot = {
  company: { id: string; code: string; name: string; active: boolean };
  subscription: {
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
    version: number; startsAt: string; trialEndsAt: string | null;
    currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  };
  current: SubscriptionChange;
  effectiveModules: Array<{ id: string; code: string; displayName: string; source: "PLAN" | "ADD_ON" | "GRANDFATHERED" }>;
  scheduled: SubscriptionChange | null; pending: SubscriptionChange | null;
  history: SubscriptionChange[]; meta: PageMeta; generatedAt: string;
};
export type SubscriptionCatalog = { plans: SubscriptionPlanVersion[]; meta: PageMeta };
export type CompanyDetails = { id: string; name: string; baseCurrencyId: string; baseCurrency: { code: string; nameAr: string }; timezone: string; isActive: boolean; manualJournalMakerCheckerEnabled: boolean; updatedAt: string };
export type AuditLog = { id: string; actor: { id: string; name: string; email: string }; action: string; entityType: string; entityId: string; details: Record<string, unknown> | null; createdAt: string };
export type AuditOptions = { actions: string[]; entityTypes: string[]; users: Array<{ id: string; name: string; email: string }> };
export type SecuritySeverity = "INFO" | "WARNING" | "HIGH" | "CRITICAL";
export type SecurityEvent = { id: string; eventType: string; severity: SecuritySeverity; user: { id: string; name: string; email: string } | null; email: string | null; ipAddress: string | null; userAgent: string | null; details: Record<string, unknown> | null; sessionId: string | null; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: { id: string; name: string } | null };
export type SecurityEventSummary = { last24Hours: { info: number; warning: number; high: number; critical: number }; unacknowledgedAlerts: number; latestCriticalAt: string | null };
export type SecurityEventOptions = { eventTypes: string[]; users: Array<{ id: string; name: string; email: string }> };

export type Account = {
  id: string;
  accountTypeId: string;
  parentAccountId: string | null;
  code: string;
  nameAr: string;
  nameEn: string | null;
  level: number;
  allowsPosting: boolean;
  isControlAccount: boolean;
  isActive: boolean;
  sourceTemplateCode: string | null;
  sourceTemplateKey: string | null;
};

export type DefaultChartTemplateStatus = {
  templateCode: string;
  version: number;
  nameAr: string;
  total: number;
  matched: number;
  missing: number;
  inactive: number;
  conflicts: number;
  canApply: boolean;
};

export type DefaultChartTemplateApplyResult = DefaultChartTemplateStatus & {
  created: number;
  linked: number;
  existing: number;
};

export type AccountType = {
  id: string;
  code: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  nameAr: string;
  class: string;
  normalBalance: "DEBIT" | "CREDIT";
  statementSection: string;
};

export type FiscalPeriod = {
  id: string;
  fiscalYearId: string;
  periodNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED" | "REOPENED";
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  version: number;
};

export type FiscalYear = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  periods: FiscalPeriod[];
};

export type FinancialCloseChecklistCode =
  | "EARLIER_PERIODS_CLOSED"
  | "NO_DRAFT_DOCUMENTS"
  | "LEDGER_BALANCED"
  | "SUBLEDGERS_RECONCILED"
  | "BANK_RECONCILIATION_COMPLETE"
  | "INVENTORY_READY"
  | "EXCHANGE_RATES_AVAILABLE"
  | "RETAINED_EARNINGS_READY";

export type FinancialCloseReadiness = {
  periodId: string;
  periodVersion: number;
  isYearEnd: boolean;
  ready: boolean;
  checkedAt: string;
  items: Array<{
    code: FinancialCloseChecklistCode;
    status: "PASS" | "BLOCKED" | "WARNING";
    count: number;
    details: string[];
  }>;
};

export type FinancialCloseRun = {
  id: string;
  periodId: string;
  cycle: number;
  status: "PREPARING" | "AWAITING_APPROVAL" | "REVIEWED" | "CLOSED";
  checklist: FinancialCloseReadiness;
  checklistHashSha256: string;
  closePack: Record<string, unknown> | null;
  closePackHashSha256: string | null;
  closeDocumentId: string | null;
  returnReason: string | null;
  reviewedAt: string | null;
  closedAt: string | null;
  version: number;
  updatedAt: string;
};

export type ApprovalRequest = {
  id: string;
  subjectType: "FINANCIAL_CLOSE_RUN" | "PROFESSIONAL_TIMESHEET";
  subjectId: string;
  subjectVersion: number;
  subjectSnapshotHashSha256: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  makerCheckerRequired: true;
  requestedBy: { id: string; displayName: string };
  decision: {
    type: "APPROVE" | "REJECT";
    actor: { id: string; displayName: string };
    reason: string | null;
    decidedAt: string;
  } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CostCenter = { id: string; parentId: string | null; code: string; nameAr: string; nameEn: string | null; isActive: boolean };

export type CashBankAccount = {
  id: string;
  ledgerAccountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  accountType: "CASH" | "BANK";
  bankName: string | null;
  accountNumberMasked: string | null;
  ibanMasked: string | null;
  isActive: boolean;
  version: number;
};

export type BankReconciliationRolloutStage = "OFF" | "SHADOW" | "REVIEW" | "CLOSE";
export type BankReconciliationCapabilities = {
  enabled: boolean;
  stage: BankReconciliationRolloutStage;
  canImport: boolean;
  canSuggest: boolean;
  canReview: boolean;
  canClose: boolean;
};
export type BankStatementFormat = "CSV" | "CAMT053";
export type BankStatementDirection = "CREDIT" | "DEBIT";
export type BankStatementCsvProfile = {
  delimiter: "," | ";" | "\t";
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  decimalSeparator: "." | ",";
  thousandsSeparator?: "," | "." | " ";
  defaultCurrency: string;
  accountIdentifier?: string;
  positiveAmountDirection?: BankStatementDirection;
  columns: {
    bookingDate: string;
    valueDate?: string;
    amount?: string;
    debit?: string;
    credit?: string;
    currency?: string;
    externalId?: string;
    reference?: string;
    description?: string;
  };
};
export type BankStatementFileRequest = {
  cashBankAccountId: string;
  format: BankStatementFormat;
  contentBase64: string;
  fileName?: string;
  csvProfile?: BankStatementCsvProfile;
  expectedAccountIdentifier?: string;
  expectedCurrency?: string;
};
export type BankStatementPreviewLine = {
  sourceRowNumber: number;
  bookingDate: string;
  valueDate: string | null;
  amount: string;
  direction: BankStatementDirection;
  currency: string;
  fingerprintSha256: string;
  externalId: string | null;
  reference: string | null;
  description: string | null;
};
export type NormalizedBankStatementPreview = {
  format: BankStatementFormat;
  sourceHashSha256: string;
  statementId: string | null;
  accountIdentifierMasked: string | null;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  netMovement: string;
  ignoredEntryCount: number;
  sourceTimeZoneOffsets: string[];
  lines: BankStatementPreviewLine[];
};
export type BankReconciliationCashAccountReference = { id: string; code: string; nameAr: string };
export type BankStatementImport = {
  id: string;
  cashBankAccount: BankReconciliationCashAccountReference;
  format: BankStatementFormat;
  sourceHashSha256: string;
  statementId: string | null;
  accountIdentifierMasked: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string | null;
  closingBalance: string | null;
  netMovement: string;
  lineCount: number;
  ignoredEntryCount: number;
  status: "COMMITTED" | "CANCELLED";
  version: number;
  committedAt: string;
  cancelledAt: string | null;
  createdAt: string;
};
export type BankStatementLineClassification = "PENDING_TRANSACTION" | "BANK_FEE" | "BANK_INTEREST" | "BANK_ERROR" | "NEEDS_ACCOUNTING_DOCUMENT";
export type BankStatementLine = BankStatementPreviewLine & {
  id: string;
  classification: BankStatementLineClassification | null;
  classificationNote: string | null;
  classifiedAt: string | null;
  version: number;
};
export type BankReconciliationBookMovement = {
  key: string;
  occurredOn: string;
  amount: string;
  currency: string;
  reference: string | null;
  documentType: string;
  documentNumber: string;
  matched?: boolean;
};
export type BankReconciliationMatch = {
  id: string;
  bankStatementLineId: string;
  bookMovement: BankReconciliationBookMovement;
  status: "PROPOSED" | "APPROVED" | "RELEASED";
  source: "SUGGESTED" | "MANUAL";
  rule: "EXACT_REFERENCE_AMOUNT_CURRENCY" | "EXACT_AMOUNT_CURRENCY_DATE" | "MANUAL";
  score: number;
  version: number;
  approvedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  createdAt: string;
};
export type BankReconciliationSession = {
  id: string;
  statementImportId: string;
  cashBankAccount: BankReconciliationCashAccountReference;
  dateFrom: string;
  dateTo: string;
  currency: string;
  bankOpeningBalance: string | null;
  bankClosingBalance: string | null;
  bankNetMovement: string;
  bookOpeningBalance: string;
  bookClosingBalance: string;
  bookNetMovement: string;
  difference: string;
  status: "OPEN" | "CLOSED";
  version: number;
  closedAt: string | null;
  closingExplanation: string | null;
  createdAt: string;
};
export type BankReconciliationSessionDetail = BankReconciliationSession & {
  lines: BankStatementLine[];
  matches: BankReconciliationMatch[];
};

export type Warehouse = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  address: string | null;
  isActive: boolean;
  version: number;
};

export type UnitOfMeasure = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  decimalPlaces: number;
  isActive: boolean;
  version: number;
};

export type InventoryItem = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  unitOfMeasure: UnitOfMeasure;
};

export type InventoryBarcodeSymbology =
  | "EAN_13"
  | "EAN_8"
  | "UPC_A"
  | "CODE_128"
  | "QR";

export type InventoryItemBarcode = {
  id: string;
  inventoryItemId: string;
  symbology: InventoryBarcodeSymbology;
  value: string;
  isPrimary: boolean;
  isActive: boolean;
  version: number;
};

export type ResolvedInventoryBarcode = {
  barcode: {
    id: string;
    symbology: InventoryBarcodeSymbology;
    isPrimary: boolean;
  };
  inventoryItem: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string | null;
    description: string | null;
    unitOfMeasure: {
      id: string;
      code: string;
      nameAr: string;
      decimalPlaces: number;
    };
  };
};

export type InventoryMovementType =
  | "OPENING_BALANCE"
  | "RECEIPT"
  | "ISSUE"
  | "TRANSFER"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT";

export type InventoryBalance = {
  id: string;
  warehouse: Pick<Warehouse, "id" | "code" | "nameAr" | "nameEn">;
  inventoryItem: Pick<InventoryItem, "id" | "code" | "nameAr" | "nameEn"> & {
    unitOfMeasure: Pick<UnitOfMeasure, "id" | "code" | "nameAr" | "nameEn" | "decimalPlaces">;
  };
  onHand: string;
  inventoryValueBase: string;
  averageUnitCostBase: string;
  isValuationInitialized: boolean;
  version: number;
  movementCount: number;
  updatedAt: string;
};

export type InventoryMovementLine = {
  id: string;
  lineNumber: number;
  inventoryItemId: string;
  inventoryItemCode: string;
  inventoryItemName: string;
  unitOfMeasureCode: string;
  fromWarehouseId: string | null;
  fromWarehouseCode: string | null;
  fromWarehouseName: string | null;
  toWarehouseId: string | null;
  toWarehouseCode: string | null;
  toWarehouseName: string | null;
  quantity: string;
  unitCostBase: string;
  totalCostBase: string;
  isCostInitialized: boolean;
};

export type InventoryMovement = {
  id: string;
  movementNumber: string;
  movementType: InventoryMovementType;
  movementDate: string;
  description: string;
  externalReference: string | null;
  status: "POSTED" | "REVERSED";
  version: number;
  source: {
    type: "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
    id: string;
    event: "POST" | "REVERSE";
    documentNumber: string;
  } | null;
  accounting: {
    documentNumber: string;
    status: "DRAFT" | "POSTED" | "REVERSED" | "CANCELLED";
    version: number;
    offsetAccount: { id: string; code: string; nameAr: string } | null;
  } | null;
  reversalOf: { id: string; movementNumber: string } | null;
  reversedBy: { id: string; movementNumber: string } | null;
  createdByName: string;
  createdAt: string;
  lineCount: number;
  lines?: InventoryMovementLine[];
};

export type PaymentMethod = {
  id: string;
  code: string;
  nameAr: string;
  requiresReference: boolean;
  isActive: boolean;
  scope: "GLOBAL" | "COMPANY";
  version: number;
};

export type Currency = {
  id: string;
  code: string;
  nameAr: string;
  decimals: number;
  isBase?: boolean;
  latestExchangeRate?: string | null;
  latestExchangeRateDate?: string | null;
};

export type CompanyCurrencySetting = Currency & {
  isBase: boolean;
  isCustom: boolean;
  isEnabled: boolean;
  latestExchangeRate: string | null;
  latestExchangeRateDate: string | null;
};

export type CompanyExchangeRate = {
  id: string;
  currency: Pick<Currency, "id" | "code" | "nameAr">;
  rateDate: string;
  rate: string;
  source: string | null;
  updatedAt: string;
  updatedBy: { id: string; displayName: string };
};

export type Address = {
  id: string;
  addressType: "LEGAL" | "BILLING" | "PAYMENT" | "OTHER";
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isPrimary: boolean;
};

export type Supplier = {
  id: string;
  payableAccountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  taxNumberMasked: string | null;
  isActive: boolean;
  addresses: Address[];
};

export type Customer = {
  id: string;
  receivableAccountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  taxNumberMasked: string | null;
  isActive: boolean;
  addresses: Address[];
};

export type ReceiptAllocation = {
  id?: string;
  receivableItemId: string;
  allocatedAmount: string;
  carryingBaseAmount?: string | null;
  settlementBaseAmount?: string | null;
  realizedFxBaseAmount?: string | null;
  invoiceNumber?: string;
  customerName?: string;
  dueDate?: string;
};

export type PaymentAllocation = {
  id?: string;
  payableItemId: string;
  allocatedAmount: string;
  carryingBaseAmount?: string | null;
  settlementBaseAmount?: string | null;
  realizedFxBaseAmount?: string | null;
};

export type DocumentHeader = {
  id: string;
  documentType: "PAYMENT" | "RECEIPT" | "MANUAL_JOURNAL" | "INVENTORY_ADJUSTMENT" | "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
  documentNumber: string;
  documentDate: string;
  description: string;
  status: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
  fiscalPeriodId: string;
  version: number;
  createdAt: string;
  postedAt: string | null;
};

export type JournalLine = {
  id?: string;
  lineNumber: number;
  accountId: string;
  costCenterId: string | null;
  customerId: string | null;
  supplierId: string | null;
  description: string | null;
  currencyId: string;
  exchangeRate: string;
  debitAmount: string;
  creditAmount: string;
  baseDebitAmount?: string;
  baseCreditAmount?: string;
};

export type JournalEntry = {
  id?: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  reversalOfJournalEntryId?: string | null;
  lines: JournalLine[];
};

export type ManualJournal = { document: DocumentHeader; entries: JournalEntry[] };

export type Payment = {
  id: string;
  document: DocumentHeader;
  supplierId: string | null;
  counterAccountId: string | null;
  cashBankAccountId: string;
  paymentMethodId: string;
  currencyId: string;
  exchangeRate: string;
  amount: string;
  baseAmount: string;
  realizedFxBaseAmount: string;
  referenceNumber: string | null;
  counterpartyNameSnapshot: string;
  counterpartyTaxMasked: string | null;
  counterpartyAddressSnapshot: string | null;
  notes: string | null;
  allocations: PaymentAllocation[];
};

export type Receipt = {
  id: string;
  document: DocumentHeader;
  customerId: string | null;
  counterAccountId: string | null;
  cashBankAccountId: string;
  paymentMethodId: string;
  currencyId: string;
  exchangeRate: string;
  amount: string;
  baseAmount: string;
  realizedFxBaseAmount: string;
  referenceNumber: string | null;
  counterpartyNameSnapshot: string;
  counterpartyTaxMasked: string | null;
  counterpartyAddressSnapshot: string | null;
  notes: string | null;
  allocations: ReceiptAllocation[];
};

export type TaxRate = {
  id: string;
  code: string;
  nameAr: string;
  rate: string;
  outputTaxAccountId: string | null;
  outputTaxAccount: { id: string; code: string; nameAr: string } | null;
  inputTaxAccountId?: string | null;
  inputTaxAccount?: { id: string; code: string; nameAr: string } | null;
  isActive: boolean;
  isReady: boolean;
  readinessReason: "TAX_RATE_INACTIVE" | "TAX_ACCOUNT_MISSING" | "TAX_ACCOUNT_INACTIVE" | "TAX_ACCOUNT_INVALID" | null;
  version: number;
};

export type SalesInvoiceLine = {
  id: string;
  lineNumber: number;
  inventoryItemId: string | null;
  inventoryItemCodeSnapshot: string | null;
  inventoryItemNameSnapshot: string | null;
  unitOfMeasureCodeSnapshot: string | null;
  description: string;
  revenueAccountId: string;
  revenueAccount?: { id: string; code: string; nameAr: string };
  costCenterId: string | null;
  costCenter?: { id: string; code: string; nameAr: string } | null;
  taxRateId: string | null;
  taxRate?: TaxRate | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  taxRateSnapshot: string;
  taxAmount: string;
  totalAmount: string;
};

export type SalesInvoice = {
  id: string;
  document: DocumentHeader;
  customerId: string;
  customer?: { id: string; code: string; nameAr: string };
  warehouseId: string | null;
  warehouseCodeSnapshot: string | null;
  warehouseNameSnapshot: string | null;
  sourceInvoiceId: string | null;
  sourceInvoiceNumber: string | null;
  receivableItemId: string | null;
  settlementVersion: number | null;
  currencyId: string;
  currency?: { id: string; code: string; nameAr: string };
  exchangeRate: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  taxTotal: string;
  total: string;
  baseTotal: string;
  paidAmount: string;
  creditedAmount: string;
  outstandingAmount: string;
  outstandingBaseAmount: string;
  settlementStatus: "OPEN" | "PARTIAL" | "PAID";
  customerNameSnapshot: string;
  customerTaxMasked: string | null;
  customerAddressSnapshot: string | null;
  notes: string | null;
  lines: SalesInvoiceLine[];
};

export type ReceivablesAgingCustomer = {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: string;
  days1To30: string;
  days31To60: string;
  days61To90: string;
  daysOver90: string;
  total: string;
  invoices: Array<{ id: string; documentNumber: string; documentDate: string; dueDate: string; total: string; outstanding: string; ageDays: number }>;
};

export type ReceivablesAgingReport = {
  asOf: string;
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  data: ReceivablesAgingCustomer[];
  totals: { current: string; days1To30: string; days31To60: string; days61To90: string; daysOver90: string; total: string };
};

export type PurchaseInvoiceLine = {
  id: string; lineNumber: number; description: string;
  inventoryItemId: string | null;
  inventoryItemCodeSnapshot: string | null;
  inventoryItemNameSnapshot: string | null;
  unitOfMeasureCodeSnapshot: string | null;
  debitAccountId: string;
  debitAccount?: { id: string; code: string; nameAr: string };
  costCenterId: string | null;
  costCenter?: { id: string; code: string; nameAr: string } | null;
  taxRateId: string | null; taxRate?: TaxRate | null;
  quantity: string; unitPrice: string; discountAmount: string;
  netAmount: string; taxRateSnapshot: string; taxAmount: string; totalAmount: string;
};

export type PurchaseInvoice = {
  id: string; document: DocumentHeader; supplierId: string;
  supplier?: { id: string; code: string; nameAr: string };
  warehouseId: string | null;
  warehouseCodeSnapshot: string | null;
  warehouseNameSnapshot: string | null;
  supplierInvoiceNumber: string | null;
  sourceInvoiceId: string | null; sourceInvoiceNumber: string | null;
  payableItemId: string | null; settlementVersion: number | null; currencyId: string;
  currency?: { id: string; code: string; nameAr: string };
  exchangeRate: string; dueDate: string; subtotal: string; discountTotal: string;
  taxableTotal: string; taxTotal: string; total: string; baseTotal: string;
  paidAmount: string; debitedAmount: string; outstandingAmount: string; outstandingBaseAmount: string;
  settlementStatus: "OPEN" | "PARTIAL" | "PAID";
  supplierNameSnapshot: string; supplierTaxMasked: string | null;
  supplierAddressSnapshot: string | null; notes: string | null;
  lines: PurchaseInvoiceLine[];
};

export type PayablesAgingReport = {
  asOf: string;
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  data: Array<{ supplierId: string; supplierCode: string; supplierName: string; current: string; days1To30: string; days31To60: string; days61To90: string; daysOver90: string; total: string; invoices: Array<{ id: string; documentNumber: string; documentDate: string; dueDate: string; total: string; outstanding: string; ageDays: number }> }>;
  totals: { current: string; days1To30: string; days31To60: string; days61To90: string; daysOver90: string; total: string };
};

export type ListResponse<T> = { data: T[]; meta: PageMeta };

export type CashFlowMonth = {
  month: string;
  receipts: string;
  payments: string;
  net: string;
};

export type RecentActivity = {
  id: string;
  type: "RECEIPT" | "PAYMENT";
  documentNumber: string;
  documentDate: string;
  status: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
  description: string;
  counterpartyName: string;
  amount: string;
};

export type DashboardReport = {
  range: { dateFrom: string; dateTo: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  metrics: {
    receipts: string;
    payments: string;
    netCashFlow: string;
    activeSuppliers: number;
    activeCustomers: number;
    draftDocuments: number;
  };
  cashFlow: CashFlowMonth[];
  recentActivity: RecentActivity[];
};

export type PosSale = {
  id: string;
  completedAt: string;
  completedBy: { id: string; displayName: string };
  invoice: {
    id: string;
    documentNumber: string;
    documentDate: string;
    status: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
    customerName: string;
    total: string;
    baseTotal: string;
  };
  receipt: {
    id: string;
    documentNumber: string;
    status: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
  };
};

export type PosCheckoutResult = {
  id: string;
  completedAt: string;
  invoice: {
    id: string;
    documentNumber: string;
    status: "POSTED";
    customerName: string;
    total: string;
    baseTotal: string;
    generatedJournalEntryIds: string[];
  };
  receipt: {
    id: string;
    documentNumber: string;
    status: "POSTED";
    generatedJournalEntryIds: string[];
  };
};

export type CashFlowMappingClassification = "NET_INCOME" | "OPERATING_ADJUSTMENT" | "OPERATING_WORKING_CAPITAL" | "INVESTING" | "FINANCING" | "EXCLUDED";
export type EffectiveCashFlowClassification = CashFlowMappingClassification | "CASH_AND_CASH_EQUIVALENTS";
export type CashFlowMapping = {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  accountClass: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
  classification: EffectiveCashFlowClassification | null;
  source: "TREASURY" | "EXPLICIT" | "TEMPLATE" | "SYSTEM" | "UNMAPPED";
  version: number;
  editable: boolean;
};
export type CashFlowReportLine = { accountId: string; code: string; nameAr: string; nameEn: string | null; amount: string };
export type IndirectCashFlowReport = {
  range: { dateFrom: string; dateTo: string };
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  sections: {
    operating: { netIncome: string; adjustments: CashFlowReportLine[]; adjustmentsTotal: string; workingCapital: CashFlowReportLine[]; workingCapitalTotal: string; total: string };
    investing: { rows: CashFlowReportLine[]; total: string };
    financing: { rows: CashFlowReportLine[]; total: string };
  };
  cash: { opening: string; netChange: string; closing: string; calculatedNetChange: string; calculatedClosing: string; difference: string; reconciled: boolean };
  mapping: { complete: boolean; cashAccountCount: number; unmappedAccounts: Array<{ accountId: string; code: string; nameAr: string; nameEn: string | null; change: string }> };
};

export type TaxSummaryStatus = "POSTED" | "REVERSED" | "DRAFT" | "CANCELLED";
export type TaxSummaryDocumentType = "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
export type TaxSummaryReport = {
  range: { dateFrom: string; dateTo: string };
  filter: { status: TaxSummaryStatus | null; basis: "LEDGER" | "STATUS_FILTER" };
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  totals: { outputTaxable: string; outputTax: string; inputTaxable: string; inputTax: string; netTaxDue: string; documentCount: number };
  rows: Array<{
    usage: "OUTPUT" | "INPUT";
    documentType: TaxSummaryDocumentType;
    status: TaxSummaryStatus;
    taxRateId: string | null;
    taxCode: string | null;
    taxNameAr: string | null;
    rate: string;
    documentCount: number;
    taxableBase: string;
    taxBase: string;
  }>;
};

export type CostCenterActivityReport = {
  range: { dateFrom: string; dateTo: string };
  filter: { costCenterId: string | null; basis: "POSTED_LEDGER" };
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  data: Array<{
    costCenter: { id: string; parentId: string | null; code: string; nameAr: string; nameEn: string | null };
    accounts: Array<{
      accountId: string;
      code: string;
      nameAr: string;
      nameEn: string | null;
      movementLineCount: number;
      debit: string;
      credit: string;
      net: string;
    }>;
    totals: { movementLineCount: number; debit: string; credit: string; net: string };
  }>;
  totals: { costCenterCount: number; accountCount: number; movementLineCount: number; debit: string; credit: string; net: string };
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  nameAr: string;
  accountClass: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  debit: string;
  credit: string;
  balance: string;
};

export type TrialBalanceReport = {
  range: { dateFrom: string; dateTo: string };
  data: TrialBalanceRow[];
  totals: { debit: string; credit: string };
};

export type JournalReportRow = {
  journalEntryId: string;
  documentId: string;
  documentNumber: string;
  documentType: "MANUAL_JOURNAL" | "INVENTORY_ADJUSTMENT" | "RECEIPT" | "PAYMENT" | "PERIOD_CLOSE" | "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
  documentDate: string;
  status: "POSTED" | "REVERSED";
  entryNumber: number;
  entryDate: string;
  description: string;
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
};

export type JournalReport = {
  range: { dateFrom: string; dateTo: string };
  data: JournalReportRow[];
  meta: PageMeta;
  totals: { debit: string; credit: string };
};

export type StatementRow = {
  accountId: string | null;
  code: string;
  nameAr: string;
  level: number;
  amount: string;
  comparisonAmount: string | null;
  variance: string | null;
  variancePercent: string | null;
  children: StatementRow[];
};

export type StatementSection = {
  rows: StatementRow[];
  total: string;
  comparisonTotal: string | null;
  variance: string | null;
  variancePercent: string | null;
};

export type FinancialPositionReport = {
  asOf: string;
  comparisonAsOf: string | null;
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  sections: { assets: StatementSection; liabilities: StatementSection; equity: StatementSection };
  currentEarnings: string;
  totals: { assets: string; liabilities: string; equity: string };
  reconciliation: { leftSide: string; rightSide: string; difference: string; balanced: boolean };
};

export type IncomeStatementReport = {
  range: { dateFrom: string; dateTo: string };
  comparisonRange: { dateFrom: string; dateTo: string } | null;
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  sections: { revenues: StatementSection; expenses: StatementSection };
  totals: { revenues: string; expenses: string; netIncome: string; comparisonNetIncome: string | null };
};

export type LedgerReport = {
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  subject: { id: string; code: string; nameAr: string; nameEn: string | null; type: "ACCOUNT" | "CUSTOMER" | "SUPPLIER" };
  costCenter: { id: string; code: string; nameAr: string; nameEn: string | null } | null;
  range: { dateFrom: string; dateTo: string };
  openingDebit: string;
  openingCredit: string;
  data: Array<{ id: string; date: string; documentId: string; documentNumber: string; documentType: string; status: string; description: string; debit: string; credit: string; runningDebit: string; runningCredit: string }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  closingDebit: string;
  closingCredit: string;
};

export type DataImportType = "CUSTOMERS" | "SUPPLIERS" | "SALES_INVOICES" | "PURCHASE_INVOICES";
export type DataImportFormat = "CSV" | "XLSX";
export type DataImportBatch = { id: string; importType: DataImportType; sourceFormat: DataImportFormat; rowCount: number; validRowCount: number; errorRowCount: number; status: "PREVIEWED" | "COMMITTED" | "EXPIRED"; expiresAt: string; committedAt: string | null; createdAt: string };
export type DataImportPreview = { batch: DataImportBatch; errors: Array<{ row: number; column: string; code: string }> };

export type ProfessionalProjectKind = "LEGAL_MATTER" | "CONSULTING_ENGAGEMENT" | "PROFESSIONAL_PROJECT";
export type ProfessionalProjectBillingModel = "TIME_AND_MATERIALS" | "FIXED_FEE" | "NON_BILLABLE";
export type ProfessionalProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type ProfessionalProjectAccessMode = "COMPANY" | "RESTRICTED";
export type ProfessionalProjectMemberRole = "MANAGER" | "PROFESSIONAL" | "REVIEWER";
export type ProfessionalCustomerOption = { id: string; code: string; nameAr: string; nameEn: string | null };
export type ProfessionalPerson = { id: string; displayName: string; nameEn: string | null };
export type ProfessionalProject = {
  id: string;
  code: string;
  customer: ProfessionalCustomerOption;
  nameAr: string;
  nameEn: string | null;
  kind: ProfessionalProjectKind;
  billingModel: ProfessionalProjectBillingModel;
  status: ProfessionalProjectStatus;
  startDate: string;
  targetEndDate: string | null;
  description: string | null;
  memberCount: number;
  trackedMinutes: number;
  billableMinutes: number;
  accessMode: ProfessionalProjectAccessMode;
  accessVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfessionalProjectMember = {
  user: ProfessionalPerson;
  role: ProfessionalProjectMemberRole;
  isActive: boolean;
  version: number;
  assignedAt: string;
  unassignedAt: string | null;
};
export type ProfessionalProjectAccessGrant = {
  id: string;
  user: ProfessionalPerson;
  isActive: boolean;
  version: number;
  grantReason: string;
  grantedAt: string;
  revocationReason: string | null;
  revokedAt: string | null;
};
export type ProfessionalProjectAccess = {
  projectId: string;
  accessMode: ProfessionalProjectAccessMode;
  accessVersion: number;
  grants: ProfessionalProjectAccessGrant[];
};
export type ProfessionalProjectStageStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type ProfessionalProjectTaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type ProfessionalProjectTaskCounts = Record<ProfessionalProjectTaskStatus, number>;
export type ProfessionalProjectPlanSummary = {
  timeBudgetMinutes: number | null;
  estimatedMinutes: number;
  actualMinutes: number;
  approvedMinutes: number;
  allocatedActualMinutes: number;
  unallocatedActualMinutes: number;
  remainingBudgetMinutes: number | null;
  overBudgetMinutes: number;
  taskCounts: ProfessionalProjectTaskCounts;
};
export type ProfessionalProjectTask = {
  id: string;
  stageId: string;
  sequence: number;
  titleAr: string;
  titleEn: string | null;
  description: string | null;
  status: ProfessionalProjectTaskStatus;
  assigneeUserId: string;
  estimatedMinutes: number;
  plannedStartDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  version: number;
  actualMinutes: number;
  approvedMinutes: number;
};
export type ProfessionalProjectStage = {
  id: string;
  sequence: number;
  nameAr: string;
  nameEn: string | null;
  description: string | null;
  status: ProfessionalProjectStageStatus;
  plannedStartDate: string | null;
  targetEndDate: string | null;
  version: number;
  summary: {
    estimatedMinutes: number;
    actualMinutes: number;
    approvedMinutes: number;
    taskCounts: ProfessionalProjectTaskCounts;
  };
  tasks: ProfessionalProjectTask[];
};
export type ProfessionalProjectTaskDependency = {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  isActive: boolean;
  version: number;
};
export type ProfessionalProjectPlan = {
  projectId: string;
  planningVersion: number;
  summary: ProfessionalProjectPlanSummary;
  stages: ProfessionalProjectStage[];
  dependencies: ProfessionalProjectTaskDependency[];
};
export type ProfessionalTimeEntry = {
  id: string;
  project: { id: string; code: string; nameAr: string; nameEn: string | null };
  task: { id: string; titleAr: string; titleEn: string | null; status: ProfessionalProjectTaskStatus } | null;
  user: ProfessionalPerson;
  workDate: string;
  minutes: number;
  isBillable: boolean;
  description: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfessionalTimeEntryList = ListResponse<ProfessionalTimeEntry> & {
  summary: { trackedMinutes: number; billableMinutes: number; nonBillableMinutes: number };
};
export type ProfessionalTimesheetStatus = "OPEN" | "AWAITING_APPROVAL" | "APPROVED";
export type ProfessionalTimesheet = {
  id: string;
  employee: {
    id: string;
    employeeNumber: string;
    nameAr: string;
    nameEn: string | null;
    status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
  };
  periodStart: string;
  periodEnd: string;
  status: ProfessionalTimesheetStatus;
  entryCount: number;
  trackedMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  activeSubmissionNumber: number | null;
  activeSnapshotHashSha256: string | null;
  submittedAt: string | null;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfessionalBillingCurrency = { id: string; code: string; nameAr: string; decimals: number };
export type ProfessionalCommercialTermStatus = "ACTIVE" | "ENDED";
export type ProfessionalServiceContract = {
  id: string;
  projectId: string;
  currency: ProfessionalBillingCurrency;
  contractReference: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  paymentTermsDays: number;
  status: ProfessionalCommercialTermStatus;
  endReason: string | null;
  endedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfessionalServiceRate = {
  id: string;
  contractId: string;
  userId: string;
  hourlyRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: ProfessionalCommercialTermStatus;
  endReason: string | null;
  endedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ProfessionalBillingRun = {
  id: string;
  project: { id: string; code: string; nameAr: string; nameEn: string | null };
  contract: { id: string; contractReference: string | null };
  contractVersion: number;
  sourceDateFrom: string;
  sourceDateTo: string;
  sourceEntryCount: number;
  sourceMinutes: number;
  invoice: {
    id: string;
    documentId: string;
    documentNumber: string;
    status: "POSTED" | "REVERSED";
    currency: { id: string; code: string; nameAr: string };
    total: string;
    baseTotal: string;
  };
  createdAt: string;
};

export type HrEmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN";
export type HrEmploymentStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";
export type HrContractType = "PERMANENT" | "FIXED_TERM" | "CONSULTANT" | "INTERNSHIP";
export type HrContractStatus = "ACTIVE" | "ENDED";
export type HrStructureReference = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type HrIdentityReference = { id: string; displayName: string; nameEn: string | null };
export type EmployeeReference = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null };
export type Employee = EmployeeReference & {
  employmentType: HrEmploymentType;
  status: HrEmploymentStatus;
  hireDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  workLocation: string | null;
  department: HrStructureReference | null;
  position: HrStructureReference | null;
  manager: EmployeeReference | null;
  linkedUser: HrIdentityReference | null;
  hasActiveContract: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type EmploymentContract = {
  id: string;
  contractType: HrContractType;
  titleAr: string;
  titleEn: string | null;
  startDate: string;
  endDate: string | null;
  status: HrContractStatus;
  notes: string | null;
  endReason: string | null;
  endedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeExpenseClaimStatus = "DRAFT" | "AWAITING_APPROVAL" | "READY_FOR_PAYMENT";
export type EmployeeExpenseCostCenter = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
};
export type EmployeeExpenseLine = {
  id: string;
  lineNumber: number;
  incurredOn: string;
  merchant: string;
  description: string;
  receiptReference: string | null;
  costCenter: EmployeeExpenseCostCenter;
  amount: string;
};
export type EmployeeExpenseClaim = {
  id: string;
  employee: { employeeNumber: string; nameAr: string; nameEn: string | null };
  currency: { code: string; decimals: number };
  purpose: string;
  status: EmployeeExpenseClaimStatus;
  totalAmount: string;
  activeSnapshotHashSha256: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  ownedByCurrentUser: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lines: EmployeeExpenseLine[];
};
