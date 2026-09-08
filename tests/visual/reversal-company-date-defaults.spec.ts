import { expect, test, type Page, type Route } from "@playwright/test";

type Scenario = {
  title: string;
  view: "sales" | "purchases" | "receipts" | "payments";
  module: "SALES" | "PURCHASES" | "TREASURY";
  basePath: "sales-invoices" | "purchase-invoices" | "receipts" | "payments";
  id: string;
  documentNumber: string;
  documentType: "SALES_INVOICE" | "PURCHASE_INVOICE" | "RECEIPT" | "PAYMENT";
  permissions: [string, string];
  reverseButton: "Reverse" | "Reverse voucher";
  timeZone: string;
  instant: string;
  expectedDate: string;
};

const scenarios: Scenario[] = [
  {
    title: "sales invoice",
    view: "sales",
    module: "SALES",
    basePath: "sales-invoices",
    id: "sales-reversal-qa",
    documentNumber: "SI-REV-0001",
    documentType: "SALES_INVOICE",
    permissions: ["sales_invoices.view", "sales_invoices.reverse"],
    reverseButton: "Reverse",
    timeZone: "Asia/Riyadh",
    instant: "2026-09-08T22:30:00.000Z",
    expectedDate: "2026-09-09",
  },
  {
    title: "purchase invoice",
    view: "purchases",
    module: "PURCHASES",
    basePath: "purchase-invoices",
    id: "purchase-reversal-qa",
    documentNumber: "PI-REV-0001",
    documentType: "PURCHASE_INVOICE",
    permissions: ["purchase_invoices.view", "purchase_invoices.reverse"],
    reverseButton: "Reverse",
    timeZone: "America/Los_Angeles",
    instant: "2026-09-08T01:30:00.000Z",
    expectedDate: "2026-09-07",
  },
  {
    title: "receipt",
    view: "receipts",
    module: "TREASURY",
    basePath: "receipts",
    id: "receipt-reversal-qa",
    documentNumber: "REC-REV-0001",
    documentType: "RECEIPT",
    permissions: ["receipts.view", "receipts.reverse"],
    reverseButton: "Reverse voucher",
    timeZone: "Asia/Kathmandu",
    instant: "2026-09-08T20:30:00.000Z",
    expectedDate: "2026-09-09",
  },
  {
    title: "payment",
    view: "payments",
    module: "TREASURY",
    basePath: "payments",
    id: "payment-reversal-qa",
    documentNumber: "PAY-REV-0001",
    documentType: "PAYMENT",
    permissions: ["payments.view", "payments.reverse"],
    reverseButton: "Reverse voucher",
    timeZone: "America/St_Johns",
    instant: "2026-09-08T01:30:00.000Z",
    expectedDate: "2026-09-07",
  },
];

const meta = { page: 1, pageSize: 10, total: 1, totalPages: 1 };
const reason = "Timezone-aware reversal";

function documentFor(scenario: Scenario) {
  return {
    id: `${scenario.id}-document`,
    documentType: scenario.documentType,
    documentNumber: scenario.documentNumber,
    documentDate: "2026-09-01",
    description: `${scenario.title} reversal fixture`,
    status: "POSTED",
    fiscalPeriodId: "period-qa",
    version: 7,
    createdAt: "2026-09-01T08:00:00.000Z",
    postedAt: "2026-09-01T09:00:00.000Z",
  };
}

function recordFor(scenario: Scenario) {
  const shared = { id: scenario.id, document: documentFor(scenario) };
  if (scenario.documentType === "SALES_INVOICE") return {
    ...shared,
    customerId: "customer-qa",
    warehouseId: null,
    warehouseCodeSnapshot: null,
    warehouseNameSnapshot: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    receivableItemId: "receivable-qa",
    settlementVersion: 1,
    currencyId: "currency-sar",
    currency: { id: "currency-sar", code: "SAR", nameAr: "ريال سعودي" },
    exchangeRate: "1.00000000",
    dueDate: "2026-09-30",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxableTotal: "100.0000",
    taxTotal: "0.0000",
    total: "100.0000",
    baseTotal: "100.0000",
    paidAmount: "0.0000",
    creditedAmount: "0.0000",
    outstandingAmount: "100.0000",
    outstandingBaseAmount: "100.0000",
    settlementStatus: "OPEN",
    customerNameSnapshot: "Reversal customer",
    customerTaxMasked: null,
    customerAddressSnapshot: null,
    notes: null,
    lines: [],
  };
  if (scenario.documentType === "PURCHASE_INVOICE") return {
    ...shared,
    supplierId: "supplier-qa",
    warehouseId: null,
    warehouseCodeSnapshot: null,
    warehouseNameSnapshot: null,
    supplierInvoiceNumber: "SUP-REV-1",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    payableItemId: "payable-qa",
    settlementVersion: 1,
    currencyId: "currency-sar",
    currency: { id: "currency-sar", code: "SAR", nameAr: "ريال سعودي" },
    exchangeRate: "1.00000000",
    dueDate: "2026-09-30",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxableTotal: "100.0000",
    taxTotal: "0.0000",
    total: "100.0000",
    baseTotal: "100.0000",
    paidAmount: "0.0000",
    debitedAmount: "0.0000",
    outstandingAmount: "100.0000",
    outstandingBaseAmount: "100.0000",
    settlementStatus: "OPEN",
    supplierNameSnapshot: "Reversal supplier",
    supplierTaxMasked: null,
    supplierAddressSnapshot: null,
    notes: null,
    lines: [],
  };
  return {
    ...shared,
    ...(scenario.documentType === "RECEIPT"
      ? { customerId: "customer-qa" }
      : { supplierId: "supplier-qa" }),
    counterAccountId: "account-qa",
    cashBankAccountId: "cash-qa",
    paymentMethodId: "method-qa",
    currencyId: "currency-sar",
    exchangeRate: "1.00000000",
    amount: "100.0000",
    baseAmount: "100.0000",
    realizedFxBaseAmount: "0.0000",
    referenceNumber: "REF-REV-1",
    counterpartyNameSnapshot: "Reversal counterparty",
    counterpartyTaxMasked: null,
    counterpartyAddressSnapshot: null,
    notes: null,
    allocations: [],
  };
}

async function installScenario(page: Page, scenario: Scenario) {
  const record = recordFor(scenario);
  await page.clock.setFixedTime(new Date(scenario.instant));
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({
      response,
      json: {
        ...authorization,
        selectedCompany: { ...authorization.selectedCompany, timezone: scenario.timeZone },
        modules: [scenario.module],
        permissions: scenario.permissions,
      },
    });
  });
  await page.route(`**/api/v1/${scenario.basePath}**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const base = `/api/v1/${scenario.basePath}`;
    if (route.request().method() === "POST" && url.pathname === `${base}/${scenario.id}/reverse`) {
      await route.fulfill({ json: record });
      return;
    }
    if (url.pathname === `${base}/${scenario.id}`) {
      await route.fulfill({ json: record });
      return;
    }
    if (url.pathname === base) {
      await route.fulfill({ json: { data: [record], meta } });
      return;
    }
    await route.fallback();
  });

  return record;
}

for (const scenario of scenarios) {
  test(`${scenario.title} reversal prompt and body use the company calendar date`, async ({ page }) => {
    const record = await installScenario(page, scenario);
    const promptDefaults: string[] = [];
    const dialogTypes: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogTypes.push(dialog.type());
      if (dialog.type() === "confirm") {
        await dialog.accept();
        return;
      }
      promptDefaults.push(dialog.defaultValue());
      await dialog.accept(dialog.defaultValue() || reason);
    });

    await page.goto(`/?qa=reversal-company-date#${scenario.view}`);
    await expect(page.locator(".workspace-page")).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    await page.getByRole("button", { name: scenario.documentNumber, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const reversalRequest = page.waitForRequest((request) =>
      request.method() === "POST"
      && new URL(request.url()).pathname === `/api/v1/${scenario.basePath}/${scenario.id}/reverse`);
    await page.getByRole("button", { name: scenario.reverseButton, exact: true }).click();
    const request = await reversalRequest;

    expect(dialogTypes).toEqual(["confirm", "prompt", "prompt"]);
    expect(promptDefaults).toEqual(["", scenario.expectedDate]);
    expect(request.postDataJSON()).toEqual({
      version: record.document.version,
      reason,
      reversalDate: scenario.expectedDate,
    });
  });
}
