import { expect, test, type Page } from "@playwright/test";
import { authMeResponse } from "./auth-me-mock.js";

const tenantCompany = { id: "1", name: "North Star Services", timezone: "Asia/Riyadh" };
const tenantPermissions = [
  "pos.view",
  "professional_projects.view",
  "hr.employees.view",
  "hr.structure.view",
  "hr.contracts.view",
];

const analytics = {
  generatedAt: "2026-08-28T09:00:00.000Z",
  scope: { company: null },
  period: { from: "2026-07-30", to: "2026-08-28", days: 30, comparison: "PREVIOUS_PERIOD", comparisonFrom: "2026-06-30", comparisonTo: "2026-07-29" },
  companyOptions: [
    { id: "company-1", name: "North Star Services", isActive: true, baseCurrencyCode: "SAR" },
    { id: "company-2", name: "Legal Advisory House", isActive: true, baseCurrencyCode: "SAR" },
  ],
  metrics: {
    operations: { current: 12840, previous: 10600, changePercent: 21.1 },
    postedDocuments: { current: 2871, previous: 2510, changePercent: 14.4 },
    activeCompanies: { current: 16, previous: 14, changePercent: 14.3 },
    newCompanies: { current: 3, previous: 2, changePercent: 50 },
    securityAlerts: { current: 2, previous: 4, changePercent: -50 },
  },
  activityTimeline: [
    { key: "2026-07-30", from: "2026-07-30", to: "2026-08-13", operations: 5200, previousOperations: 4400, postedDocuments: 1220, previousPostedDocuments: 1080, securityAlerts: 1, newCompanies: 1 },
    { key: "2026-08-14", from: "2026-08-14", to: "2026-08-28", operations: 7640, previousOperations: 6200, postedDocuments: 1651, previousPostedDocuments: 1430, securityAlerts: 1, newCompanies: 2 },
  ],
  financials: [{
    currencyCode: "SAR",
    recurringMonthly: "118500.0000",
    billed: { current: "241200.0000", previous: "204000.0000", changePercent: 18.2 },
    collected: { current: "200700.0000", previous: "166100.0000", changePercent: 20.8 },
    collectionRate: { current: 83.2, previous: 81.4, changePercent: 2.2 },
    outstanding: "49700.0000",
    overdue: "5500.0000",
    invoiceCount: { current: 27, previous: 23, changePercent: 17.4 },
    timeline: [
      { key: "2026-07-30", from: "2026-07-30", to: "2026-08-13", billed: "105000.0000", previousBilled: "92000.0000", collected: "84100.0000", previousCollected: "76000.0000" },
      { key: "2026-08-14", from: "2026-08-14", to: "2026-08-28", billed: "136200.0000", previousBilled: "112000.0000", collected: "116600.0000", previousCollected: "90100.0000" },
    ],
    aging: { notDue: "32000.0000", days1To30: "12200.0000", days31To60: "4200.0000", days61Plus: "1300.0000" },
  }],
  modules: [
    { code: "SALES", current: 4700, previous: 3900, changePercent: 20.5 },
    { code: "PURCHASES", current: 2100, previous: 1900, changePercent: 10.5 },
    { code: "TREASURY", current: 1800, previous: 1500, changePercent: 20 },
    { code: "POS", current: 1340, previous: 1100, changePercent: 21.8 },
    { code: "INVENTORY", current: 950, previous: 840, changePercent: 13.1 },
    { code: "PROJECTS", current: 810, previous: 720, changePercent: 12.5 },
    { code: "HR", current: 480, previous: 450, changePercent: 6.7 },
    { code: "APPROVALS", current: 390, previous: 330, changePercent: 18.2 },
    { code: "IMPORTS", current: 270, previous: 230, changePercent: 17.4 },
  ],
  companies: [
    { id: "company-1", name: "North Star Services", currencyCode: "SAR", operations: 1640, postedDocuments: 510, billed: "92000.0000", collected: "84400.0000", outstanding: "18400.0000", overdue: "4200.0000", lastActivityAt: "2026-08-28T08:57:00.000Z" },
    { id: "company-2", name: "Legal Advisory House", currencyCode: "SAR", operations: 1180, postedDocuments: 420, billed: "77800.0000", collected: "70100.0000", outstanding: "12600.0000", overdue: "0.0000", lastActivityAt: "2026-08-28T08:44:00.000Z" },
  ],
  alerts: { overdueInvoices: 3, dueSoonInvoices: 5, unacknowledgedSecurity: 2, pendingOutbox: 4, failedOutbox: 0, staleCompanies: 1 },
};

async function mockBootstrap(page: Page, platformOperations: boolean) {
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/companies") return json({ data: [tenantCompany] });
    if (path === "/auth/me") return json(authMeResponse(tenantPermissions, [
      "CORE_ACCOUNTING",
      "SALES",
      "TREASURY",
      "INVENTORY",
      "POS",
      "HUMAN_RESOURCES",
      "PROFESSIONAL_PROJECTS",
    ], tenantCompany));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/platform/capabilities") return json({ platformOperations });
    if (path === "/platform/analytics") return json(analytics);
    if (request.method() === "GET") return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    return route.fulfill({ status: 204, body: "" });
  });
}

test("opens the card-based system directory and the authorized platform dashboard", async ({ page }) => {
  await mockBootstrap(page, true);
  await page.goto("/#home");

  await expect(page.getByRole("heading", { name: "Every company workflow in one place" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commercial operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Point of Sale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Human resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Professional projects" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Platform operations" }).click();
  await expect(page).toHaveURL(/#platform$/u);
  await expect(page.getByRole("heading", { name: "Platform operations dashboard" })).toBeVisible();
  await expect(page.getByText("12,840").first()).toBeVisible();
  await expect(page.getByText("North Star Services").last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usage and operating activity" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("does not expose the platform dashboard to a tenant-only user", async ({ page }) => {
  await mockBootstrap(page, false);
  await page.goto("/#platform");

  await expect(page).toHaveURL(/#home$/u);
  await expect(page.getByRole("heading", { name: "Every company workflow in one place" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Platform operations" })).toHaveCount(0);
});
