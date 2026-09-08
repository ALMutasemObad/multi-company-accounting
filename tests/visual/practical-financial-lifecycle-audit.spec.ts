import { expect, test, type Page, type Route } from "@playwright/test";

type DocumentStatus = "DRAFT" | "POSTED" | "REVERSED";
type SyntheticDocument = {
  id: string;
  document: {
    id: string;
    documentType: string;
    documentNumber: string;
    documentDate: string;
    description: string;
    status: DocumentStatus;
    fiscalPeriodId: string;
    version: number;
    createdAt: string;
    postedAt: string | null;
  };
} & Record<string, unknown>;
type RecordedSideEffect = {
  method: string;
  path: string;
  csrf: string | undefined;
  idempotencyKey: string | undefined;
  body: Record<string, unknown>;
};
type RecordedRequestFailure = { method: string; path: string; errorText: string };

const currency = { id: "currency-sar", code: "SAR", nameAr: "ريال سعودي", decimals: 2 };
const period = { id: "period-sep", fiscalYearId: "year-2026", periodNumber: 9, name: "September 2026", startDate: "2026-09-01", endDate: "2026-09-30", status: "OPEN", closedAt: null, reopenedAt: null, reopenReason: null, version: 0 };
const fiscalYear = { id: "year-2026", name: "Fiscal year 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "OPEN", periods: [period] };
const accounts = [
  { id: "account-cash", accountTypeId: "type-asset", parentAccountId: null, code: "1100", nameAr: "النقدية", nameEn: "Cash", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: "STANDARD_TRADING", sourceTemplateKey: "cash" },
  { id: "account-ar", accountTypeId: "type-asset", parentAccountId: null, code: "1200", nameAr: "العملاء", nameEn: "Accounts receivable", level: 1, allowsPosting: true, isControlAccount: true, isActive: true, sourceTemplateCode: "STANDARD_TRADING", sourceTemplateKey: "receivables" },
  { id: "account-ap", accountTypeId: "type-liability", parentAccountId: null, code: "2100", nameAr: "الموردون", nameEn: "Accounts payable", level: 1, allowsPosting: true, isControlAccount: true, isActive: true, sourceTemplateCode: "STANDARD_TRADING", sourceTemplateKey: "payables" },
  { id: "account-revenue", accountTypeId: "type-revenue", parentAccountId: null, code: "4100", nameAr: "إيراد المبيعات", nameEn: "Sales revenue", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: "STANDARD_TRADING", sourceTemplateKey: "sales" },
  { id: "account-expense", accountTypeId: "type-expense", parentAccountId: null, code: "5100", nameAr: "مشتريات", nameEn: "Purchases", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: "STANDARD_TRADING", sourceTemplateKey: "purchases" },
];
const accountTypes = [
  { id: "type-asset", code: "ASSET", nameAr: "أصل", nameEn: "Asset", class: "ASSET", normalBalance: "DEBIT", statementSection: "ASSETS" },
  { id: "type-liability", code: "LIABILITY", nameAr: "التزام", nameEn: "Liability", class: "LIABILITY", normalBalance: "CREDIT", statementSection: "LIABILITIES" },
  { id: "type-revenue", code: "REVENUE", nameAr: "إيراد", nameEn: "Revenue", class: "REVENUE", normalBalance: "CREDIT", statementSection: "REVENUE" },
  { id: "type-expense", code: "EXPENSE", nameAr: "مصروف", nameEn: "Expense", class: "EXPENSE", normalBalance: "DEBIT", statementSection: "EXPENSES" },
];
const customer = { id: "customer-1", receivableAccountId: "account-ar", code: "CUS-000001", nameAr: "عميل دورة الاختبار", nameEn: "Lifecycle Customer", phone: "+966500000001", email: "customer@example.test", taxNumberMasked: "***001", isActive: true, addresses: [] };
const supplier = { id: "supplier-1", payableAccountId: "account-ap", code: "SUP-000001", nameAr: "مورد دورة الاختبار", nameEn: "Lifecycle Supplier", phone: "+966500000002", email: "supplier@example.test", taxNumberMasked: "***002", isActive: true, addresses: [] };
const cashBank = { id: "cash-1", ledgerAccountId: "account-cash", code: "CB-000001", nameAr: "الصندوق التجريبي", nameEn: "Lifecycle Cash", accountType: "CASH", bankName: null, accountNumberMasked: null, ibanMasked: null, isActive: true, version: 0 };
const paymentMethod = { id: "method-cash", code: "CASH", nameAr: "نقدي", nameEn: "Cash", requiresReference: false, isActive: true, scope: "GLOBAL", version: 0 };

const header = (id: string, documentType: string, documentNumber: string) => ({
  id: `header-${id}`,
  documentType,
  documentNumber,
  documentDate: "2026-09-08",
  description: `Synthetic lifecycle ${documentNumber}`,
  status: "DRAFT" as DocumentStatus,
  fiscalPeriodId: period.id,
  version: 0,
  createdAt: "2026-09-08T08:00:00.000Z",
  postedAt: null,
});

const makeSalesInvoice = (): SyntheticDocument => ({
  id: "sales-1", document: header("sales-1", "SALES_INVOICE", "SI-2026-0001"),
  customerId: customer.id, customer: { id: customer.id, code: customer.code, nameAr: customer.nameAr },
  warehouseId: null, warehouseCodeSnapshot: null, warehouseNameSnapshot: null,
  sourceInvoiceId: null, sourceInvoiceNumber: null, receivableItemId: "receivable-1", settlementVersion: 0,
  currencyId: currency.id, currency, exchangeRate: "1.00000000", dueDate: "2026-09-30",
  subtotal: "100.0000", discountTotal: "0.0000", taxableTotal: "100.0000", taxTotal: "15.0000", total: "115.0000", baseTotal: "115.0000",
  paidAmount: "0.0000", creditedAmount: "0.0000", outstandingAmount: "115.0000", outstandingBaseAmount: "115.0000", settlementStatus: "OPEN",
  customerNameSnapshot: customer.nameEn, customerTaxMasked: customer.taxNumberMasked, customerAddressSnapshot: null, notes: "Synthetic audit only",
  lines: [{ id: "sales-line-1", lineNumber: 1, inventoryItemId: null, inventoryItemCodeSnapshot: null, inventoryItemNameSnapshot: null, unitOfMeasureCodeSnapshot: null, description: "Lifecycle sale", revenueAccountId: "account-revenue", revenueAccount: { id: "account-revenue", code: "4100", nameAr: "إيراد المبيعات" }, costCenterId: null, costCenter: null, taxRateId: null, taxRate: null, quantity: "1.000000", unitPrice: "100.0000", discountAmount: "0.0000", netAmount: "100.0000", taxRateSnapshot: "15.0000", taxAmount: "15.0000", totalAmount: "115.0000" }],
});

const makePurchaseInvoice = (): SyntheticDocument => ({
  id: "purchase-1", document: header("purchase-1", "PURCHASE_INVOICE", "PI-2026-0001"),
  supplierId: supplier.id, supplier: { id: supplier.id, code: supplier.code, nameAr: supplier.nameAr },
  warehouseId: null, warehouseCodeSnapshot: null, warehouseNameSnapshot: null, supplierInvoiceNumber: "VENDOR-001",
  sourceInvoiceId: null, sourceInvoiceNumber: null, payableItemId: "payable-1", settlementVersion: 0,
  currencyId: currency.id, currency, exchangeRate: "1.00000000", dueDate: "2026-09-30",
  subtotal: "100.0000", discountTotal: "0.0000", taxableTotal: "100.0000", taxTotal: "15.0000", total: "115.0000", baseTotal: "115.0000",
  paidAmount: "0.0000", debitedAmount: "0.0000", outstandingAmount: "115.0000", outstandingBaseAmount: "115.0000", settlementStatus: "OPEN",
  supplierNameSnapshot: supplier.nameEn, supplierTaxMasked: supplier.taxNumberMasked, supplierAddressSnapshot: null, notes: "Synthetic audit only",
  lines: [{ id: "purchase-line-1", lineNumber: 1, inventoryItemId: null, inventoryItemCodeSnapshot: null, inventoryItemNameSnapshot: null, unitOfMeasureCodeSnapshot: null, description: "Lifecycle purchase", debitAccountId: "account-expense", debitAccount: { id: "account-expense", code: "5100", nameAr: "مشتريات" }, costCenterId: null, costCenter: null, taxRateId: null, taxRate: null, quantity: "1.000000", unitPrice: "100.0000", discountAmount: "0.0000", netAmount: "100.0000", taxRateSnapshot: "15.0000", taxAmount: "15.0000", totalAmount: "115.0000" }],
});

const makeReceipt = (): SyntheticDocument => ({
  id: "receipt-1", document: header("receipt-1", "RECEIPT", "REC-2026-0001"),
  customerId: customer.id, counterAccountId: null, cashBankAccountId: cashBank.id, paymentMethodId: paymentMethod.id,
  currencyId: currency.id, exchangeRate: "1.00000000", amount: "115.0000", baseAmount: "115.0000", realizedFxBaseAmount: "0.0000",
  referenceNumber: "RCPT-AUDIT-1", counterpartyNameSnapshot: customer.nameEn, counterpartyTaxMasked: customer.taxNumberMasked, counterpartyAddressSnapshot: null,
  notes: "Synthetic audit only", allocations: [{ id: "receipt-allocation-1", receivableItemId: "receivable-1", allocatedAmount: "115.0000", invoiceNumber: "SI-2026-0001", customerName: customer.nameEn, dueDate: "2026-09-30" }],
});

const makePayment = (): SyntheticDocument => ({
  id: "payment-1", document: header("payment-1", "PAYMENT", "PAY-2026-0001"),
  supplierId: supplier.id, counterAccountId: null, cashBankAccountId: cashBank.id, paymentMethodId: paymentMethod.id,
  currencyId: currency.id, exchangeRate: "1.00000000", amount: "115.0000", baseAmount: "115.0000", realizedFxBaseAmount: "0.0000",
  referenceNumber: "PAY-AUDIT-1", counterpartyNameSnapshot: supplier.nameEn, counterpartyTaxMasked: supplier.taxNumberMasked, counterpartyAddressSnapshot: null,
  notes: "Synthetic audit only", allocations: [{ id: "payment-allocation-1", payableItemId: "payable-1", allocatedAmount: "115.0000" }],
});

const list = (data: unknown[], pageSize = 20) => ({ data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length ? 1 : 0 } });

function fulfill(route: Route, json: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

function dateInTimeZone(instant: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function configureLifecycle(page: Page) {
  const state = {
    sales: makeSalesInvoice(),
    purchase: makePurchaseInvoice(),
    receipt: makeReceipt(),
    payment: makePayment(),
  };
  const sideEffects: RecordedSideEffect[] = [];
  const reads: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: RecordedRequestFailure[] = [];

  await page.addInitScript(() => {
    localStorage.setItem("mcap.locale", "en");
    sessionStorage.setItem("mcap.csrf", "synthetic-lifecycle-csrf");
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push({
    method: request.method(),
    path: new URL(request.url()).pathname,
    errorText: request.failure()?.errorText ?? "unknown",
  }));

  const documentRoutes = new Map<string, SyntheticDocument>([
    ["/sales-invoices/sales-1", state.sales],
    ["/purchase-invoices/purchase-1", state.purchase],
    ["/receipts/receipt-1", state.receipt],
    ["/payments/payment-1", state.payment],
  ]);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice("/api/v1".length);
    const method = request.method();
    if (method === "GET" || method === "HEAD") reads.push(path);
    else sideEffects.push({
      method,
      path,
      csrf: request.headers()["x-csrf-token"],
      idempotencyKey: request.headers()["idempotency-key"],
      body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    });

    if (path === "/auth/me") return fulfill(route, {
      user: { id: "audit-user", displayName: "Lifecycle audit user" },
      selectedCompany: { id: "audit-company", name: "Lifecycle audit company", timezone: "Asia/Riyadh" },
      modules: ["CORE_ACCOUNTING", "SALES", "PURCHASES", "TREASURY", "REPORTING"],
      permissions: [
        "accounts.view", "cost_centers.manage", "fiscal_periods.view", "fiscal_periods.manage", "fiscal_periods.close", "fiscal_periods.reopen",
        "customers.view", "customers.manage", "suppliers.view", "suppliers.manage", "currencies.view", "cash_bank_accounts.view",
        "sales_invoices.view", "sales_invoices.create", "sales_invoices.update", "sales_invoices.post", "sales_invoices.reverse",
        "purchase_invoices.view", "purchase_invoices.create", "purchase_invoices.update", "purchase_invoices.post", "purchase_invoices.reverse",
        "receipts.view", "receipts.create", "receipts.update", "receipts.post", "receipts.reverse",
        "payments.view", "payments.create", "payments.update", "payments.post", "payments.reverse",
        "reports.cash_flow.view", "reports.receivables.view", "reports.payables.view",
      ],
    });
    if (path === "/auth/companies") return fulfill(route, { data: [{ id: "audit-company", name: "Lifecycle audit company" }] });
    if (path === "/platform/capabilities") return fulfill(route, { platformOperations: false });
    if (path === "/organizations/workspaces") return fulfill(route, { data: [] });
    if (path === "/auth/csrf") return fulfill(route, { csrfToken: "synthetic-lifecycle-csrf" });

    const command = path.match(/^\/(sales-invoices|purchase-invoices|receipts|payments)\/([^/]+)\/(post|reverse)$/u);
    if (method === "POST" && command) {
      const basePath = `/${command[1]}/${command[2]}`;
      const record = documentRoutes.get(basePath);
      if (!record) return fulfill(route, { code: "NOT_FOUND" }, 404);
      record.document.status = command[3] === "post" ? "POSTED" : "REVERSED";
      record.document.version += 1;
      if (command[3] === "post") record.document.postedAt = "2026-09-08T22:30:00.000Z";
      return fulfill(route, record);
    }

    if (method !== "GET" && method !== "HEAD") return fulfill(route, { code: "UNEXPECTED_WRITE" }, 500);
    if (documentRoutes.has(path)) return fulfill(route, documentRoutes.get(path));
    if (path === "/fiscal-years") return fulfill(route, list([fiscalYear], 10));
    if (path === "/fiscal-periods") return fulfill(route, list([period], 100));
    if (path === "/accounts/default-template") return fulfill(route, { templateCode: "STANDARD_TRADING", version: 1, nameAr: "الدليل التجاري القياسي", nameEn: "Standard trading chart", total: accounts.length, matched: accounts.length, missing: 0, inactive: 0, conflicts: 0, canApply: true });
    if (path === "/accounts") return fulfill(route, list(accounts, Number(url.searchParams.get("pageSize") ?? 100)));
    if (path === "/account-types") return fulfill(route, { data: accountTypes });
    if (path === "/cost-centers") return fulfill(route, list([]));
    if (path === "/customers") return fulfill(route, list([customer], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/suppliers") return fulfill(route, list([supplier], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/currencies") return fulfill(route, { data: [currency] });
    if (path === "/cash-bank-accounts") return fulfill(route, list([cashBank], 100));
    if (path === "/payment-methods") return fulfill(route, { data: [paymentMethod] });
    if (path === "/sales-invoices") return fulfill(route, list([state.sales], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/purchase-invoices") return fulfill(route, list([state.purchase], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/receipts") return fulfill(route, list([state.receipt], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/payments") return fulfill(route, list([state.payment], Number(url.searchParams.get("pageSize") ?? 10)));
    if (path === "/tax-rates" || path === "/purchase-tax-rates") return fulfill(route, list([]));
    if (path === "/reports/cash-flow") return fulfill(route, {
      range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, company: { name: "Lifecycle audit company" }, baseCurrency: currency,
      sections: { operating: { netIncome: "0.0000", adjustments: [], adjustmentsTotal: "0.0000", workingCapital: [], workingCapitalTotal: "0.0000", total: "0.0000" }, investing: { rows: [], total: "0.0000" }, financing: { rows: [], total: "0.0000" } },
      cash: { opening: "1000.0000", netChange: "0.0000", closing: "1000.0000", calculatedNetChange: "0.0000", calculatedClosing: "1000.0000", difference: "0.0000", reconciled: true },
      mapping: { complete: true, cashAccountCount: 1, unmappedAccounts: [] },
    });
    if (path === "/reports/trial-balance") return fulfill(route, {
      range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
      data: [{ accountId: "account-cash", code: "1100", nameAr: "النقدية", accountClass: "ASSET", debit: "460.0000", credit: "460.0000", balance: "0.0000" }],
      totals: { debit: "460.0000", credit: "460.0000" },
    });
    if (path === "/reports/journal") return fulfill(route, {
      range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
      data: [state.sales, state.purchase, state.receipt, state.payment].map((record, index) => ({ journalEntryId: `journal-${index + 1}`, documentId: record.id, documentNumber: record.document.documentNumber, documentType: record.document.documentType, documentDate: record.document.documentDate, status: record.document.status === "REVERSED" ? "REVERSED" : "POSTED", entryNumber: index + 1, entryDate: record.document.documentDate, description: record.document.description, debitTotal: "115.0000", creditTotal: "115.0000", balanced: true })),
      meta: { page: 1, pageSize: 25, total: 4, totalPages: 1 }, totals: { debit: "460.0000", credit: "460.0000" },
    });
    return fulfill(route, list([]));
  });

  return { state, sideEffects, reads, pageErrors, requestFailures };
}

async function openView(page: Page, view: string, marker: string) {
  if (page.url() === "about:blank") await page.goto(`/#${view}`);
  else await page.evaluate((nextView) => { window.location.hash = nextView; }, view);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
}

test("prerequisites, counterparties and reports form a coherent read-only journey", async ({ page }, testInfo) => {
  const fixture = await configureLifecycle(page);

  await openView(page, "fiscal", "Fiscal year 2026");
  await expect(page.locator(".status-chip.open")).toHaveText("Open");
  await openView(page, "accounts", "1100");
  for (const code of ["1100", "1200", "2100", "4100", "5100"]) await expect(page.getByText(code, { exact: true })).toBeVisible();
  await openView(page, "customers", "CUS-000001");
  await expect(page.getByRole("button", { name: "Lifecycle Customer", exact: true })).toBeVisible();
  await openView(page, "suppliers", "SUP-000001");
  await expect(page.getByRole("button", { name: "Lifecycle Supplier", exact: true })).toBeVisible();
  await openView(page, "reports", "Indirect cash flow statement");
  await page.getByRole("button", { name: "Trial balance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trial balance", exact: true })).toBeVisible();
  await expect(page.getByText("1100", { exact: true })).toBeVisible();

  for (const expectedRead of [
    "/fiscal-years",
    "/accounts",
    "/account-types",
    "/customers",
    "/suppliers",
    "/reports/cash-flow",
    "/reports/trial-balance",
  ]) {
    expect(fixture.reads).toContain(expectedRead);
  }
  await testInfo.attach("read-only-request-log", {
    body: JSON.stringify({ reads: fixture.reads, sideEffects: fixture.sideEffects, requestFailures: fixture.requestFailures }, null, 2),
    contentType: "application/json",
  });
  expect(fixture.sideEffects).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => failure.errorText !== "net::ERR_ABORTED")).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => failure.method !== "GET")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("financial-prerequisites-and-reports.png"), fullPage: true });
});

test("documents post, reverse and remain traceable into journal reports", async ({ page }, testInfo) => {
  const fixture = await configureLifecycle(page);
  await page.clock.install({ time: new Date("2026-09-08T22:30:00.000Z") });
  const reversalPromptDefaults: string[] = [];
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") return dialog.accept();
    if (dialog.defaultValue()) {
      reversalPromptDefaults.push(dialog.defaultValue());
      return dialog.accept(dialog.defaultValue());
    }
    return dialog.accept("Synthetic lifecycle reversal");
  });

  const documents = [
    { view: "sales", number: "SI-2026-0001", reverse: "Reverse", basePath: "/sales-invoices/sales-1" },
    { view: "purchases", number: "PI-2026-0001", reverse: "Reverse", basePath: "/purchase-invoices/purchase-1" },
    { view: "receipts", number: "REC-2026-0001", reverse: "Reverse voucher", basePath: "/receipts/receipt-1" },
    { view: "payments", number: "PAY-2026-0001", reverse: "Reverse voucher", basePath: "/payments/payment-1" },
  ];

  for (const document of documents) {
    await openView(page, document.view, document.number);
    await page.getByRole("button", { name: document.number, exact: true }).click();
    let modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(document.number, "u") })).toContainText("Posted");

    await page.getByRole("button", { name: document.number, exact: true }).click();
    modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: document.reverse, exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(document.number, "u") })).toContainText("Reversed");
  }

  expect(fixture.sideEffects.map((entry) => `${entry.method} ${entry.path}`)).toEqual(documents.flatMap((document) => [
    `POST ${document.basePath}/post`,
    `POST ${document.basePath}/reverse`,
  ]));
  for (const sideEffect of fixture.sideEffects) {
    expect(sideEffect.csrf).toBe("synthetic-lifecycle-csrf");
    expect(sideEffect.idempotencyKey).toBeTruthy();
  }
  for (const post of fixture.sideEffects.filter((entry) => entry.path.endsWith("/post"))) expect(post.body.version).toBe(0);
  for (const reversal of fixture.sideEffects.filter((entry) => entry.path.endsWith("/reverse"))) {
    expect(reversal.body).toMatchObject({ version: 1, reason: "Synthetic lifecycle reversal", reversalDate: "2026-09-08" });
  }

  // Reproducible P1: at 22:30 UTC the company's Asia/Riyadh date is 2026-09-09,
  // but all four reversal prompts default to the previous UTC date.
  expect(dateInTimeZone("2026-09-08T22:30:00.000Z", "Asia/Riyadh")).toBe("2026-09-09");
  expect(reversalPromptDefaults).toEqual(["2026-09-08", "2026-09-08", "2026-09-08", "2026-09-08"]);

  await openView(page, "reports", "Indirect cash flow statement");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  for (const document of documents) await expect(page.getByText(document.number, { exact: true })).toBeVisible();
  await expect(page.locator(".status-chip.reversed")).toHaveCount(4);

  await testInfo.attach("write-and-reversal-request-log", {
    body: JSON.stringify({ reads: fixture.reads, sideEffects: fixture.sideEffects, reversalPromptDefaults, requestFailures: fixture.requestFailures }, null, 2),
    contentType: "application/json",
  });

  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => failure.errorText !== "net::ERR_ABORTED")).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => failure.method !== "GET")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("financial-document-lifecycle.png"), fullPage: true });
});
