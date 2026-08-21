export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Company = { id: string; name: string };
export type User = { id: string; displayName: string };
export type AdminUser = { id: string; email: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "LOCKED" | "DISABLED"; lastLoginAt: string | null; createdAt: string; updatedAt: string };
export type Permission = { id: string; code: string; module: string; descriptionAr: string };
export type Role = { id: string; code: string; nameAr: string; nameEn: string | null; isSystemRole: boolean; isActive: boolean; assignedUsers: number; permissionIds: string[]; permissions: string[] };
export type UserRole = { roleId: string; roleCode: string; isActive: boolean; assignedAt: string };
export type UserSession = { id: string; createdAt: string; lastActivityAt: string; expiresAt: string; current: boolean; revoked: boolean };
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
};

export type PaymentMethod = {
  id: string;
  code: string;
  nameAr: string;
  requiresReference: boolean;
  isActive: boolean;
  scope: "GLOBAL" | "COMPANY";
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

export type Allocation = {
  id?: string;
  targetJournalLineId: string;
  allocatedAmount: string;
};

export type DocumentHeader = {
  id: string;
  documentType: "PAYMENT" | "RECEIPT" | "MANUAL_JOURNAL" | "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
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
  referenceNumber: string | null;
  counterpartyNameSnapshot: string;
  counterpartyTaxMasked: string | null;
  counterpartyAddressSnapshot: string | null;
  notes: string | null;
  allocations: Allocation[];
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
  referenceNumber: string | null;
  counterpartyNameSnapshot: string;
  counterpartyTaxMasked: string | null;
  counterpartyAddressSnapshot: string | null;
  notes: string | null;
  allocations: Allocation[];
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
};

export type SalesInvoiceLine = {
  id: string;
  lineNumber: number;
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
  sourceInvoiceId: string | null;
  sourceInvoiceNumber: string | null;
  arJournalLineId: string | null;
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
  supplierInvoiceNumber: string | null;
  sourceInvoiceId: string | null; sourceInvoiceNumber: string | null;
  apJournalLineId: string | null; currencyId: string;
  currency?: { id: string; code: string; nameAr: string };
  exchangeRate: string; dueDate: string; subtotal: string; discountTotal: string;
  taxableTotal: string; taxTotal: string; total: string; baseTotal: string;
  paidAmount: string; debitedAmount: string; outstandingAmount: string;
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
  documentType: "MANUAL_JOURNAL" | "RECEIPT" | "PAYMENT" | "PERIOD_CLOSE" | "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
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
  subject: { id: string; code: string; nameAr: string; type: "ACCOUNT" | "CUSTOMER" | "SUPPLIER" };
  range: { dateFrom: string; dateTo: string };
  openingDebit: string;
  openingCredit: string;
  data: Array<{ id: string; date: string; documentId: string; documentNumber: string; documentType: string; status: string; description: string; debit: string; credit: string; runningDebit: string; runningCredit: string }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  closingDebit: string;
  closingCredit: string;
};
