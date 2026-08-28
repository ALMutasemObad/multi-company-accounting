import { createServer } from "node:http";

const port = Number(process.env.VISUAL_QA_PORT ?? 3000);
const meta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const currency = { id: "currency-sar", code: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi Riyal", decimals: 2 };
const company = {
  id: "company-qa",
  code: "JWR-QA",
  name: "شركة جوار التجريبية",
  nameAr: "شركة جوار التجريبية",
  nameEn: "Jowar Demo Company",
  baseCurrencyId: currency.id,
  baseCurrency: currency,
  timezone: "Asia/Riyadh",
  isActive: true,
  manualJournalMakerCheckerEnabled: true,
  updatedAt: "2026-08-21T12:00:00.000Z",
};
const zeroSection = { rows: [], total: "0.00", comparisonTotal: null, variance: null, variancePercent: null };
const fiscalPeriod = { id: "1001", fiscalYearId: "1001", periodNumber: 12, name: "ديسمبر 2026", startDate: "2026-12-01", endDate: "2026-12-31", status: "OPEN", closedAt: null, reopenedAt: null, reopenReason: null, version: 0 };
const closeReadiness = {
  periodId: fiscalPeriod.id,
  periodVersion: 0,
  isYearEnd: true,
  ready: true,
  checkedAt: "2026-12-31T18:00:00.000Z",
  items: [
    "EARLIER_PERIODS_CLOSED",
    "NO_DRAFT_DOCUMENTS",
    "LEDGER_BALANCED",
    "SUBLEDGERS_RECONCILED",
    "BANK_RECONCILIATION_COMPLETE",
    "INVENTORY_READY",
    "EXCHANGE_RATES_AVAILABLE",
    "RETAINED_EARNINGS_READY",
  ].map((code) => ({ code, status: "PASS", count: 0, details: [] })),
};
const platformOverview = {
  generatedAt: "2026-08-28T09:00:00.000Z",
  window: { days: 30, startsAt: "2026-07-30T09:00:00.000Z", endsAt: "2026-08-28T09:00:00.000Z" },
  metrics: {
    totalCompanies: 18, activeCompanies: 16, newCompanies: 3,
    totalEmployees: 247, activeEmployees: 231, linkedEmployees: 208,
    totalUsers: 214, activeUsers: 203, activeSessions: 37,
    systemOperations: 12840, financialDocuments: 3190, postedDocuments: 2871, securityAlerts: 2,
  },
  health: {
    pendingOutbox: 4, failedOutbox: 0, unacknowledgedSecurityAlerts: 2,
    activeCompaniesInWindow: 15, employeeAccountCoverage: 84, companyAdoptionRate: 83,
  },
  trends: [
    { month: "2026-03", newCompanies: 1, operations: 5200 },
    { month: "2026-04", newCompanies: 2, operations: 6400 },
    { month: "2026-05", newCompanies: 2, operations: 7100 },
    { month: "2026-06", newCompanies: 3, operations: 8500 },
    { month: "2026-07", newCompanies: 4, operations: 10600 },
    { month: "2026-08", newCompanies: 3, operations: 12840 },
  ],
  modules: [
    { code: "SALES", total: 4700, recent: 540 },
    { code: "PURCHASES", total: 2100, recent: 240 },
    { code: "TREASURY", total: 1800, recent: 211 },
    { code: "POS", total: 1340, recent: 190 },
    { code: "INVENTORY", total: 950, recent: 80 },
    { code: "PROJECTS", total: 810, recent: 102 },
    { code: "HR", total: 480, recent: 36 },
    { code: "APPROVALS", total: 390, recent: 52 },
    { code: "IMPORTS", total: 270, recent: 18 },
  ],
  topCompanies: [
    { id: "company-qa", name: "شركة جوار التجريبية", operations: 1640, lastActivityAt: "2026-08-28T08:57:00.000Z" },
    { id: "company-legal", name: "شركة الاستشارات القانونية", operations: 1180, lastActivityAt: "2026-08-28T08:44:00.000Z" },
  ],
};
const professionalProjectId = "b1af217e-7c7b-43bb-b15f-61184df1d6b9";
const professionalStageId = "44b23a51-b68c-4e35-a252-d577c3021c2a";
const professionalResearchTaskId = "49e2bc47-bf40-4bf7-a40a-3408b77cfba5";
const professionalDraftTaskId = "8ff14e20-5f22-4e6e-909b-bc0385144d49";
const professionalCustomer = { id: "41", code: "CUS-000041", nameAr: "شركة الريادة للاستشارات", nameEn: "Pioneer Consulting" };
const professionalManager = { id: "7", displayName: "سارة المستشار", nameEn: "Sarah Consultant" };
const professionalProject = {
  id: professionalProjectId,
  code: "PRJ-000041",
  customer: professionalCustomer,
  nameAr: "استشارة إعادة هيكلة الشركة",
  nameEn: "Corporate restructuring advisory",
  kind: "CONSULTING_ENGAGEMENT",
  billingModel: "TIME_AND_MATERIALS",
  status: "ACTIVE",
  accessMode: "RESTRICTED",
  accessVersion: 2,
  startDate: "2026-08-01",
  targetEndDate: "2026-10-31",
  description: "تحليل الهيكل الحالي وصياغة التوصيات وخطة التنفيذ.",
  memberCount: 1,
  trackedMinutes: 210,
  billableMinutes: 210,
  version: 0,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};
const professionalTasks = [
  {
    id: professionalResearchTaskId,
    stageId: professionalStageId,
    sequence: 1,
    titleAr: "تحليل الوضع الحالي",
    titleEn: "Current-state analysis",
    description: "مراجعة المستندات ومقابلة أصحاب المصلحة.",
    status: "IN_PROGRESS",
    assigneeUserId: professionalManager.id,
    estimatedMinutes: 360,
    plannedStartDate: "2026-08-03",
    dueDate: "2026-08-31",
    completedAt: null,
    version: 1,
    actualMinutes: 210,
    approvedMinutes: 150,
  },
  {
    id: professionalDraftTaskId,
    stageId: professionalStageId,
    sequence: 2,
    titleAr: "صياغة مذكرة التوصيات",
    titleEn: "Draft recommendations",
    description: "صياغة الخيارات والتوصيات التنفيذية.",
    status: "TODO",
    assigneeUserId: professionalManager.id,
    estimatedMinutes: 300,
    plannedStartDate: "2026-09-01",
    dueDate: "2026-09-20",
    completedAt: null,
    version: 0,
    actualMinutes: 0,
    approvedMinutes: 0,
  },
];
const professionalPlan = {
  projectId: professionalProjectId,
  planningVersion: 4,
  summary: {
    timeBudgetMinutes: 2400,
    estimatedMinutes: 660,
    actualMinutes: 210,
    approvedMinutes: 150,
    allocatedActualMinutes: 210,
    unallocatedActualMinutes: 0,
    remainingBudgetMinutes: 2190,
    overBudgetMinutes: 0,
    taskCounts: { TODO: 1, IN_PROGRESS: 1, COMPLETED: 0, CANCELLED: 0 },
  },
  stages: [{
    id: professionalStageId,
    sequence: 1,
    nameAr: "التحليل والتوصيات",
    nameEn: "Analysis and recommendations",
    description: "مرحلة إغلاق الفهم وتقديم الرأي المهني.",
    status: "IN_PROGRESS",
    plannedStartDate: "2026-08-03",
    targetEndDate: "2026-09-20",
    version: 1,
    summary: {
      estimatedMinutes: 660,
      actualMinutes: 210,
      approvedMinutes: 150,
      taskCounts: { TODO: 1, IN_PROGRESS: 1, COMPLETED: 0, CANCELLED: 0 },
    },
    tasks: professionalTasks,
  }],
  dependencies: [{
    id: "6c2d61ed-8e4e-4b0c-baa9-7997145394b1",
    predecessorTaskId: professionalResearchTaskId,
    successorTaskId: professionalDraftTaskId,
    isActive: true,
    version: 0,
  }],
};
const professionalTimeEntry = {
  id: "cbcc08ff-99bc-40c4-8757-bc90016584e3",
  project: { id: professionalProjectId, code: professionalProject.code, nameAr: professionalProject.nameAr, nameEn: professionalProject.nameEn },
  task: { id: professionalResearchTaskId, titleAr: professionalTasks[0].titleAr, titleEn: professionalTasks[0].titleEn, status: professionalTasks[0].status },
  user: professionalManager,
  workDate: "2026-08-27",
  minutes: 210,
  isBillable: true,
  description: "مراجعة حزمة مستندات الحوكمة وتحليل الملاحظات.",
  editable: true,
  version: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

function list(data = []) {
  return { data, meta: { ...meta, total: data.length, totalPages: data.length ? 1 : 0 } };
}

function responseFor(url, method) {
  const pathname = url.pathname.replace(/^\/api\/v1/, "");
  if (pathname === "/auth/csrf") return { csrfToken: "visual-qa-csrf" };
  if (pathname === "/auth/companies") return { data: [company] };
  if (pathname === "/auth/context" || pathname === "/auth/logout") return null;
  if (pathname === "/platform/capabilities") return { platformOperations: true };
  if (pathname === "/platform/overview") return platformOverview;
  if (pathname === "/companies/current") return company;
  if (pathname === "/professional-projects/customer-options") return { data: [professionalCustomer] };
  if (pathname === "/professional-projects/member-options") return { data: [professionalManager] };
  if (pathname === "/professional-projects") return list([professionalProject]);
  if (pathname === "/professional-projects/" + professionalProjectId + "/access") return {
    projectId: professionalProjectId,
    accessMode: "RESTRICTED",
    accessVersion: 2,
    grants: [{
      id: "74d5c65e-3381-4aba-a3ae-0b61409375f6",
      user: professionalManager,
      isActive: true,
      version: 0,
      grantReason: "مشاركة المستشارة في الملف",
      grantedAt: "2026-08-01T08:00:00.000Z",
      revocationReason: null,
      revokedAt: null,
    }],
  };
  if (pathname === "/professional-projects/" + professionalProjectId + "/plan") return professionalPlan;
  if (pathname === "/professional-projects/" + professionalProjectId) return {
    project: professionalProject,
    members: [{ user: professionalManager, role: "MANAGER", isActive: true, version: 0, assignedAt: "2026-08-01T08:00:00.000Z", unassignedAt: null }],
  };
  if (pathname === "/professional-time-entries") return {
    data: [professionalTimeEntry],
    meta: { ...meta, total: 1, totalPages: 1 },
    summary: { trackedMinutes: 210, billableMinutes: 210, nonBillableMinutes: 0 },
  };
  if (pathname === "/professional-timesheets") return list([]);
  if (pathname === "/professional-service-contracts") return { data: [] };
  if (pathname === "/professional-service-rates") return { data: [] };
  if (pathname === "/professional-billing-runs") return { data: [] };
  if (pathname === "/professional-billing/currency-options") return { data: [currency] };
  if (pathname === "/fiscal-years") return list([{ id: "1001", name: "السنة المالية 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "OPEN", periods: [fiscalPeriod] }]);
  if (pathname === "/fiscal-periods") return list([fiscalPeriod]);
  if (pathname === `/fiscal-periods/${fiscalPeriod.id}/close-readiness`) return closeReadiness;
  if (pathname === `/fiscal-periods/${fiscalPeriod.id}/close-run`) return { run: null };
  if (pathname === "/settings") return { data: [{ key: "accounting.manual_journal_maker_checker_enabled", value: true }] };
  if (pathname === "/auth/register/options") return {
    currencies: [currency, { id: "currency-yer", code: "YER", nameAr: "ريال يمني", nameEn: "Yemeni Rial", decimals: 2 }],
    locales: ["ar", "en", "ur", "hi"],
    timezones: ["Asia/Riyadh", "Asia/Aden"],
    chartTemplates: [{ code: "STANDARD_TRADING", nameAr: "الدليل التجاري القياسي", nameEn: "Standard trading chart" }],
    passwordPolicy: { minLength: 12, maxLength: 128 },
  };
  if (pathname === "/accounts/default-template") return { templateCode: "STANDARD_TRADING", version: 1, nameAr: "الدليل التجاري القياسي", nameEn: "Standard trading chart", total: 42, matched: 42, missing: 0, inactive: 0, conflicts: 0, canApply: true };
  if (pathname === "/company-currencies") return { data: [
    { ...currency, isBase: true, isCustom: false, isEnabled: true, latestExchangeRate: "1.00000000", latestExchangeRateDate: "2026-08-21" },
    { id: "currency-yer", code: "YER", nameAr: "ريال يمني", nameEn: "Yemeni Rial", decimals: 2, isBase: false, isCustom: true, isEnabled: true, latestExchangeRate: "0.00610000", latestExchangeRateDate: "2026-08-21" },
    { id: "currency-usd", code: "USD", nameAr: "دولار أمريكي", nameEn: "US Dollar", decimals: 2, isBase: false, isCustom: false, isEnabled: false, latestExchangeRate: null, latestExchangeRateDate: null },
  ] };
  if (pathname === "/exchange-rates") return list([{ id: "rate-yer", currency: { id: "currency-yer", code: "YER", nameAr: "ريال يمني", nameEn: "Yemeni Rial" }, rateDate: "2026-08-21", rate: "0.00610000", source: "Visual QA", updatedAt: "2026-08-21T12:00:00.000Z", updatedBy: { id: "user-qa", displayName: "مدير النظام" } }]);
  if (pathname === "/bank-reconciliation/capabilities") return { enabled: true, stage: "CLOSE", canImport: true, canSuggest: true, canReview: true, canClose: true };
  if (pathname === "/cash-bank-accounts") return list([{ id: "bank-qa", ledgerAccountId: "account-bank-qa", code: "CB-000001", nameAr: "الحساب البنكي التجريبي", nameEn: "Demo bank account", accountType: "BANK", bankName: "Jowar Test Bank", accountNumberMasked: "****2042", ibanMasked: null, isActive: true, version: 0 }]);
  if (pathname === "/bank-statement-imports") return list([]);
  if (pathname === "/bank-reconciliation/sessions") return list([]);
  if (pathname === "/audit-logs/options") return { actions: ["CREATE", "UPDATE"], entityTypes: ["COMPANY", "CURRENCY"], users: [{ id: "user-qa", name: "مدير النظام", email: "qa@example.test" }] };
  if (pathname === "/security-events/options") return { eventTypes: ["LOGIN_SUCCEEDED", "LOGIN_FAILED"], users: [{ id: "user-qa", name: "مدير النظام", email: "qa@example.test" }] };
  if (pathname === "/security-events/summary") return { last24Hours: { info: 3, warning: 1, high: 0, critical: 0 }, unacknowledgedAlerts: 1, latestCriticalAt: null };
  if (pathname === "/reports/dashboard") return {
    range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    baseCurrency: currency,
    metrics: { receipts: "845000.00", payments: "526000.00", netCashFlow: "319000.00", activeSuppliers: 18, activeCustomers: 37, draftDocuments: 6 },
    cashFlow: [
      { month: "2026-01", receipts: "90000", payments: "65000", net: "25000" },
      { month: "2026-02", receipts: "130000", payments: "92000", net: "38000" },
      { month: "2026-03", receipts: "175000", payments: "88000", net: "87000" },
      { month: "2026-04", receipts: "145000", payments: "101000", net: "44000" },
      { month: "2026-05", receipts: "165000", payments: "84000", net: "81000" },
      { month: "2026-06", receipts: "140000", payments: "96000", net: "44000" },
    ],
    recentActivity: [
      { id: "receipt-1", type: "RECEIPT", documentNumber: "REC-2026-0042", documentDate: "2026-08-20", status: "POSTED", description: "تحصيل دفعة فاتورة", counterpartyName: "شركة الأفق", amount: "45000.00" },
      { id: "payment-1", type: "PAYMENT", documentNumber: "PAY-2026-0031", documentDate: "2026-08-19", status: "DRAFT", description: "دفعة مورد", counterpartyName: "مؤسسة الإمداد", amount: "18750.00" },
    ],
  };
  if (pathname === "/reports/cash-flow") return {
    range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, company: { name: company.name }, baseCurrency: currency,
    sections: {
      operating: { netIncome: "185000.0000", adjustments: [{ accountId: "5410", code: "5410", nameAr: "مصروف الإهلاك", nameEn: "Depreciation expense", amount: "15000.0000" }], adjustmentsTotal: "15000.0000", workingCapital: [{ accountId: "1130", code: "1130", nameAr: "ذمم العملاء", nameEn: "Accounts receivable", amount: "-24000.0000" }, { accountId: "2110", code: "2110", nameAr: "ذمم الموردين", nameEn: "Accounts payable", amount: "9000.0000" }], workingCapitalTotal: "-15000.0000", total: "185000.0000" },
      investing: { rows: [{ accountId: "1210", code: "1210", nameAr: "الأجهزة والمعدات", nameEn: "Equipment", amount: "-45000.0000" }], total: "-45000.0000" },
      financing: { rows: [{ accountId: "2210", code: "2210", nameAr: "القروض", nameEn: "Loans", amount: "30000.0000" }], total: "30000.0000" },
    },
    cash: { opening: "80000.0000", netChange: "170000.0000", closing: "250000.0000", calculatedNetChange: "170000.0000", calculatedClosing: "250000.0000", difference: "0.0000", reconciled: true },
    mapping: { complete: true, cashAccountCount: 2, unmappedAccounts: [] },
  };
  if (pathname === "/reports/tax-summary") return {
    range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    filter: { status: null, basis: "LEDGER" },
    company: { name: company.name }, baseCurrency: currency,
    totals: { outputTaxable: "640000.0000", outputTax: "96000.0000", inputTaxable: "360000.0000", inputTax: "54000.0000", netTaxDue: "42000.0000", documentCount: 58 },
    rows: [
      { usage: "OUTPUT", documentType: "SALES_INVOICE", status: "POSTED", taxRateId: "tax-output-qa", taxCode: "VAT-15", taxNameAr: "ضريبة المخرجات 15%", rate: "15.0000", documentCount: 37, taxableBase: "700000.0000", taxBase: "105000.0000" },
      { usage: "OUTPUT", documentType: "SALES_CREDIT_NOTE", status: "POSTED", taxRateId: "tax-output-qa", taxCode: "VAT-15", taxNameAr: "ضريبة المخرجات 15%", rate: "15.0000", documentCount: 4, taxableBase: "-60000.0000", taxBase: "-9000.0000" },
      { usage: "INPUT", documentType: "PURCHASE_INVOICE", status: "POSTED", taxRateId: "tax-input-qa", taxCode: "VAT-IN-15", taxNameAr: "ضريبة المدخلات 15%", rate: "15.0000", documentCount: 17, taxableBase: "360000.0000", taxBase: "54000.0000" },
    ],
  };
  if (pathname === "/reports/cost-centers") return {
    range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    filter: { costCenterId: null, basis: "POSTED_LEDGER" },
    company: { name: company.name }, baseCurrency: currency,
    data: [
      {
        costCenter: { id: "cost-center-operations", code: "CC-000001", nameAr: "العمليات", nameEn: "Operations" },
        accounts: [
          { accountId: "account-rent", code: "5210", nameAr: "مصروف الإيجار", nameEn: "Rent expense", movementLineCount: 12, debit: "120000.0000", credit: "0.0000", net: "120000.0000" },
          { accountId: "account-maintenance", code: "5230", nameAr: "مصروف الصيانة", nameEn: "Maintenance expense", movementLineCount: 8, debit: "42000.0000", credit: "5000.0000", net: "37000.0000" },
        ],
        totals: { movementLineCount: 20, debit: "162000.0000", credit: "5000.0000", net: "157000.0000" },
      },
      {
        costCenter: { id: "cost-center-sales", code: "CC-000002", nameAr: "المبيعات", nameEn: "Sales" },
        accounts: [
          { accountId: "account-marketing", code: "5310", nameAr: "مصروف التسويق", nameEn: "Marketing expense", movementLineCount: 9, debit: "68000.0000", credit: "3000.0000", net: "65000.0000" },
        ],
        totals: { movementLineCount: 9, debit: "68000.0000", credit: "3000.0000", net: "65000.0000" },
      },
    ],
    totals: { costCenterCount: 2, accountCount: 3, movementLineCount: 29, debit: "230000.0000", credit: "8000.0000", net: "222000.0000" },
  };
  if (pathname === "/reports/cash-flow/mappings") return { data: [] };
  if (pathname === "/reports/trial-balance") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/journal") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], meta, totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/financial-position") return { asOf: "2026-08-21", comparisonAsOf: null, company: { name: company.name }, baseCurrency: currency, sections: { assets: zeroSection, liabilities: zeroSection, equity: zeroSection }, currentEarnings: "0.00", totals: { assets: "0.00", liabilities: "0.00", equity: "0.00" }, reconciliation: { leftSide: "0.00", rightSide: "0.00", difference: "0.00", balanced: true } };
  if (pathname === "/reports/income-statement") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, comparisonRange: null, company: { name: company.name }, baseCurrency: currency, sections: { revenues: zeroSection, expenses: zeroSection }, totals: { revenues: "0.00", expenses: "0.00", netIncome: "0.00", comparisonNetIncome: null } };
  if (pathname === "/reports/ledger") return { company: { name: company.name }, baseCurrency: currency, subject: { id: "customer-qa", code: "CUS-000001", nameAr: "شركة الأفق", nameEn: "Horizon Company", type: "CUSTOMER" }, costCenter: url.searchParams.get("costCenterId") ? { id: "cost-center-operations", code: "CC-000001", nameAr: "العمليات", nameEn: "Operations" } : null, range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, openingDebit: "12500.00", openingCredit: "0.00", data: [{ id: "ledger-line-1", date: "2026-08-10", documentId: "invoice-qa", documentNumber: "SI-2026-0041", documentType: "SALES_INVOICE", status: "POSTED", description: "فاتورة توريد تجريبية", debit: "45000.00", credit: "0.00", runningDebit: "57500.00", runningCredit: "0.00" }, { id: "ledger-line-2", date: "2026-08-20", documentId: "receipt-qa", documentNumber: "REC-2026-0042", documentType: "RECEIPT", status: "POSTED", description: "تحصيل دفعة فاتورة", debit: "0.00", credit: "30000.00", runningDebit: "27500.00", runningCredit: "0.00" }], meta: { ...meta, total: 2, totalPages: 1 }, closingDebit: "27500.00", closingCredit: "0.00" };
  if (pathname === "/reports/payables-aging" || pathname === "/reports/receivables-aging") return { asOf: "2026-08-21", baseCurrency: currency, data: [], totals: { current: "0.00", days1To30: "0.00", days31To60: "0.00", days61To90: "0.00", daysOver90: "0.00", total: "0.00" } };
  if (pathname === "/units-of-measure") return list([
    { id: "unit-ea", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true, version: 0 },
  ]);
  if (pathname === "/inventory-items") return list([
    { id: "item-qa", code: "ITM-000001", nameAr: "صنف تجريبي", nameEn: "Sample item", description: "صنف مخصص للفحص البصري", isActive: true, version: 0, unitOfMeasure: { id: "unit-ea", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true, version: 0 } },
  ]);
  if (pathname === "/warehouses") return list([
    { id: "warehouse-qa", code: "WH-000001", nameAr: "المستودع الرئيسي", nameEn: "Main warehouse", address: "الرياض", isActive: true, version: 0 },
    { id: "warehouse-branch", code: "WH-000002", nameAr: "مستودع الفرع", nameEn: "Branch warehouse", address: "جدة", isActive: true, version: 0 },
  ]);
  if (pathname === "/customers") return list([{ id: "customer-qa", receivableAccountId: "account-ar-qa", code: "CUS-000001", nameAr: "شركة الأفق", nameEn: "Horizon Company", phone: null, email: null, taxNumberMasked: null, isActive: true, addresses: [] }]);
  if (pathname === "/inventory-balances") return list([
    { id: "balance-qa", warehouse: { id: "warehouse-qa", code: "WH-000001", nameAr: "المستودع الرئيسي", nameEn: "Main warehouse" }, inventoryItem: { id: "item-qa", code: "ITM-000001", nameAr: "صنف تجريبي", nameEn: "Sample item", unitOfMeasure: { id: "unit-ea", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0 } }, onHand: "125.000000", version: 3, movementCount: 4, updatedAt: "2026-08-24T12:00:00.000Z" },
  ]);
  const movement = { id: "movement-qa", movementNumber: "IMV-00000001", movementType: "RECEIPT", movementDate: "2026-08-24", description: "استلام بضاعة تجريبية", externalReference: "PO-QA-1", source: null, createdByName: "مدير النظام", createdAt: "2026-08-24T12:00:00.000Z", lineCount: 1 };
  if (pathname === "/inventory-movements") return method === "POST" ? { ...movement, lines: [] } : list([movement]);
  if (pathname === "/inventory-movements/movement-qa") return { ...movement, lines: [{ id: "movement-line-qa", lineNumber: 1, inventoryItemId: "item-qa", inventoryItemCode: "ITM-000001", inventoryItemName: "صنف تجريبي", unitOfMeasureCode: "EA", fromWarehouseId: null, fromWarehouseCode: null, fromWarehouseName: null, toWarehouseId: "warehouse-qa", toWarehouseCode: "WH-000001", toWarehouseName: "المستودع الرئيسي", quantity: "125.000000" }] };
  if (method !== "GET") return null;
  return list();
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (!url.pathname.startsWith("/api/v1/")) {
    response.writeHead(404).end();
    return;
  }
  if (url.pathname === "/api/v1/auth/companies" && request.headers.referer?.includes("qa=login")) {
    response.writeHead(401, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }));
    return;
  }
  const body = responseFor(url, request.method ?? "GET");
  response.writeHead(body === null ? 204 : 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body === null ? undefined : JSON.stringify(body));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Visual QA API listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
