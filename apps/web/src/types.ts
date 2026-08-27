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
  status: "PREPARING" | "REVIEWED" | "CLOSED";
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
