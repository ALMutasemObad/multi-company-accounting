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

function list(data = []) {
  return { data, meta: { ...meta, total: data.length, totalPages: data.length ? 1 : 0 } };
}

function responseFor(url, method) {
  const pathname = url.pathname.replace(/^\/api\/v1/, "");
  if (pathname === "/auth/csrf") return { csrfToken: "visual-qa-csrf" };
  if (pathname === "/auth/companies") return { data: [company] };
  if (pathname === "/auth/context" || pathname === "/auth/logout") return null;
  if (pathname === "/companies/current") return company;
  if (pathname === "/fiscal-years") return list([{ id: "1001", name: "السنة المالية 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "OPEN", periods: [fiscalPeriod] }]);
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
  if (pathname === "/reports/cash-flow/mappings") return { data: [] };
  if (pathname === "/reports/trial-balance") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/journal") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], meta, totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/financial-position") return { asOf: "2026-08-21", comparisonAsOf: null, company: { name: company.name }, baseCurrency: currency, sections: { assets: zeroSection, liabilities: zeroSection, equity: zeroSection }, currentEarnings: "0.00", totals: { assets: "0.00", liabilities: "0.00", equity: "0.00" }, reconciliation: { leftSide: "0.00", rightSide: "0.00", difference: "0.00", balanced: true } };
  if (pathname === "/reports/income-statement") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, comparisonRange: null, company: { name: company.name }, baseCurrency: currency, sections: { revenues: zeroSection, expenses: zeroSection }, totals: { revenues: "0.00", expenses: "0.00", netIncome: "0.00", comparisonNetIncome: null } };
  if (pathname === "/reports/ledger") return { company: { name: company.name }, baseCurrency: currency, subject: { id: "customer-qa", code: "CUS-000001", nameAr: "شركة الأفق", nameEn: "Horizon Company", type: "CUSTOMER" }, range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, openingDebit: "12500.00", openingCredit: "0.00", data: [{ id: "ledger-line-1", date: "2026-08-10", documentId: "invoice-qa", documentNumber: "SI-2026-0041", documentType: "SALES_INVOICE", status: "POSTED", description: "فاتورة توريد تجريبية", debit: "45000.00", credit: "0.00", runningDebit: "57500.00", runningCredit: "0.00" }, { id: "ledger-line-2", date: "2026-08-20", documentId: "receipt-qa", documentNumber: "REC-2026-0042", documentType: "RECEIPT", status: "POSTED", description: "تحصيل دفعة فاتورة", debit: "0.00", credit: "30000.00", runningDebit: "27500.00", runningCredit: "0.00" }], meta: { ...meta, total: 2, totalPages: 1 }, closingDebit: "27500.00", closingCredit: "0.00" };
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
