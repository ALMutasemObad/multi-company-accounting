import { expect, test, type Page } from "@playwright/test";
import { authMeResponse, e2eCompany } from "../e2e/auth-me-mock.js";
import type { PlatformModuleCode } from "../../apps/web/src/types.js";

const modules: PlatformModuleCode[] = ["CORE_ACCOUNTING", "SALES", "PURCHASES", "TREASURY", "POS", "REPORTING"];
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;
const dashboardReport = {
  range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
  baseCurrency: { id: "sar", code: "SAR", nameAr: "ريال سعودي", decimals: 2 },
  metrics: { receipts: "12500.00", payments: "4500.00", netCashFlow: "8000.00", activeSuppliers: 2, activeCustomers: 3, draftDocuments: 4 },
  cashFlow: [
    { month: "2026-01", receipts: "5000.00", payments: "1500.00" },
    { month: "2026-02", receipts: "7500.00", payments: "3000.00" },
  ],
  recentActivity: [
    { type: "RECEIPT", id: "receipt-1", documentNumber: "REC-2026-001", description: "Synthetic receipt", counterpartyName: "QA Customer", documentDate: "2026-02-20", status: "POSTED", amount: "7500.00" },
    { type: "PAYMENT", id: "payment-1", documentNumber: "PAY-2026-001", description: "Synthetic payment", counterpartyName: "QA Supplier", documentDate: "2026-02-21", status: "DRAFT", amount: "3000.00" },
  ],
};

type DashboardFixtureOptions = {
  permissions: string[];
  firstDashboardResponse?: "error-after-release";
};

async function installDashboardFixture(page: Page, options: DashboardFixtureOptions) {
  const dashboardQueries: string[] = [];
  const writes: string[] = [];
  let dashboardAttempts = 0;
  let releaseFirstResponse = () => {};
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method !== "GET") writes.push(`${method} ${path}`);

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(options.permissions, modules));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/reports/dashboard") {
      dashboardAttempts += 1;
      dashboardQueries.push(url.search);
      if (dashboardAttempts <= 2 && options.firstDashboardResponse === "error-after-release") {
        await firstResponseGate;
        return json({ message: "Synthetic dashboard failure" }, 500);
      }
      return json(dashboardReport);
    }
    if (method === "GET") return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    return route.fulfill({ status: 204, body: "" });
  });

  return { dashboardQueries, writes, releaseFirstResponse };
}

async function openDashboard(page: Page) {
  await page.goto("/#dashboard");
  await expect(page.locator(".dashboard-page")).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth <= document.body.clientWidth + 1,
  }))).toEqual({ document: true, body: true });
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("loads, recovers, filters and renders dashboard evidence without writes", async ({ page }) => {
      const fixture = await installDashboardFixture(page, {
        permissions: ["dashboard.view", "reports.cash_flow.view"],
        firstDashboardResponse: "error-after-release",
      });

      await page.goto("/#dashboard");
      await expect(page.locator(".loading")).toBeVisible();
      fixture.releaseFirstResponse();
      await expect(page.getByRole("alert")).toContainText("Unable to load the dashboard");
      await page.getByRole("button", { name: "Retry" }).click();

      await expect(page.locator(".metric-card")).toHaveCount(4);
      await expect(page.locator(".metric-card").nth(0)).toContainText("12,500.00");
      await expect(page.locator(".metric-card").nth(2)).toContainText("8,000.00");
      await expect(page.getByRole("img", { name: "Monthly cash flow chart" })).toBeVisible();
      await expect(page.locator(".cashflow-chart .chart-month")).toHaveCount(2);
      await expect(page.locator(".activity-panel tbody tr")).toHaveCount(2);
      await expect(page.locator(".activity-panel")).toContainText("REC-2026-001");
      await expect(page.locator(".activity-panel")).toContainText("PAY-2026-001");

      const requestCountBeforeInvalidFilter = fixture.dashboardQueries.length;
      await page.getByLabel("From").fill("2026-03-31");
      await page.getByLabel("To").fill("2026-03-01");
      await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
      expect(fixture.dashboardQueries).toHaveLength(requestCountBeforeInvalidFilter);

      await page.getByLabel("From").fill("2026-02-01");
      await page.getByLabel("To").fill("2026-02-28");
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect.poll(() => fixture.dashboardQueries.at(-1)).toContain("dateFrom=2026-02-01");
      expect(fixture.dashboardQueries.at(-1)).toContain("dateTo=2026-02-28");
      await expect(page.locator(".metric-card")).toHaveCount(4);
      await expectNoPageOverflow(page);
      expect(fixture.writes).toEqual([]);
    });

    test("dashboard-only reader sees no inaccessible destinations or writes", async ({ page }) => {
      const fixture = await installDashboardFixture(page, { permissions: ["dashboard.view"] });
      await openDashboard(page);

      await expect(page.locator(".dashboard-quick-actions")).toHaveCount(0);
      await expect(page.locator(".overview-panel")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View report" })).toHaveCount(0);
      await expect(page.locator(".metric-card")).toHaveCount(4);
      await expect(page.getByRole("img", { name: "Monthly cash flow chart" })).toBeVisible();
      await expect(page.locator(".activity-panel tbody tr")).toHaveCount(2);
      await expectNoPageOverflow(page);
      expect(fixture.writes).toEqual([]);
    });

    test("individually authorized destinations remain discoverable and guarded", async ({ page }) => {
      const fixture = await installDashboardFixture(page, {
        permissions: ["dashboard.view", "sales_invoices.view", "suppliers.view", "reports.cash_flow.view"],
      });
      await openDashboard(page);

      await expect(page.locator(".dashboard-quick-actions button")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Invoice a customer" })).toBeVisible();
      await expect(page.locator(".overview-panel button")).toHaveCount(1);
      await expect(page.getByRole("button", { name: /Active suppliers/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /Active customers/u })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Draft documents/u })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View report" })).toBeVisible();

      await page.getByRole("button", { name: "Invoice a customer" }).click();
      await expect(page).toHaveURL(/#sales$/u);
      await openDashboard(page);
      await page.getByRole("button", { name: /Active suppliers/u }).click();
      await expect(page).toHaveURL(/#suppliers$/u);
      await openDashboard(page);
      await page.getByRole("button", { name: "View report" }).click();
      await expect(page).toHaveURL(/#reports$/u);

      expect(fixture.writes).toEqual([]);
    });
  });
}
