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

function list(data = []) {
  return { data, meta: { ...meta, total: data.length, totalPages: data.length ? 1 : 0 } };
}

function responseFor(url, method) {
  const pathname = url.pathname.replace(/^\/api\/v1/, "");
  if (pathname === "/auth/csrf") return { csrfToken: "visual-qa-csrf" };
  if (pathname === "/auth/companies") return { data: [company] };
  if (pathname === "/auth/context" || pathname === "/auth/logout") return null;
  if (pathname === "/companies/current") return company;
  if (pathname === "/settings") return { data: [{ key: "accounting.manual_journal_maker_checker_enabled", value: true }] };
  if (pathname === "/auth/register/options") return {
    currencies: [currency, { id: "currency-yer", code: "YER", nameAr: "ريال يمني", nameEn: "Yemeni Rial", decimals: 2 }],
    locales: ["ar", "en"],
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
  if (pathname === "/reports/trial-balance") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/journal") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, data: [], meta, totals: { debit: "0.00", credit: "0.00" } };
  if (pathname === "/reports/financial-position") return { asOf: "2026-08-21", comparisonAsOf: null, company: { name: company.name }, baseCurrency: currency, sections: { assets: zeroSection, liabilities: zeroSection, equity: zeroSection }, currentEarnings: "0.00", totals: { assets: "0.00", liabilities: "0.00", equity: "0.00" }, reconciliation: { leftSide: "0.00", rightSide: "0.00", difference: "0.00", balanced: true } };
  if (pathname === "/reports/income-statement") return { range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, comparisonRange: null, company: { name: company.name }, baseCurrency: currency, sections: { revenues: zeroSection, expenses: zeroSection }, totals: { revenues: "0.00", expenses: "0.00", netIncome: "0.00", comparisonNetIncome: null } };
  if (pathname === "/reports/ledger") return { subject: { id: "account-qa", code: "1000", nameAr: "حساب تجريبي", type: "ACCOUNT" }, range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, openingDebit: "0.00", openingCredit: "0.00", data: [], meta, closingDebit: "0.00", closingCredit: "0.00" };
  if (pathname === "/reports/payables-aging" || pathname === "/reports/receivables-aging") return { asOf: "2026-08-21", baseCurrency: currency, data: [], totals: { current: "0.00", days1To30: "0.00", days31To60: "0.00", days61To90: "0.00", daysOver90: "0.00", total: "0.00" } };
  if (pathname === "/units-of-measure") return list([
    { id: "unit-ea", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true, version: 0 },
  ]);
  if (pathname === "/inventory-items") return list([
    { id: "item-qa", code: "ITM-000001", nameAr: "صنف تجريبي", nameEn: "Sample item", description: "صنف مخصص للفحص البصري", isActive: true, version: 0, unitOfMeasure: { id: "unit-ea", code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true, version: 0 } },
  ]);
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
