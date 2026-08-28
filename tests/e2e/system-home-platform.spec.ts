import { expect, test, type Page } from "@playwright/test";

const overview = {
  generatedAt: "2026-08-28T09:00:00.000Z",
  window: { days: 30, startsAt: "2026-07-30T09:00:00.000Z", endsAt: "2026-08-28T09:00:00.000Z" },
  metrics: {
    totalCompanies: 18,
    activeCompanies: 16,
    newCompanies: 3,
    totalEmployees: 247,
    activeEmployees: 231,
    linkedEmployees: 208,
    totalUsers: 214,
    activeUsers: 203,
    activeSessions: 37,
    systemOperations: 12840,
    financialDocuments: 3190,
    postedDocuments: 2871,
    securityAlerts: 2,
  },
  health: {
    pendingOutbox: 4,
    failedOutbox: 0,
    unacknowledgedSecurityAlerts: 2,
    activeCompaniesInWindow: 15,
    employeeAccountCoverage: 84,
    companyAdoptionRate: 83,
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
    { id: "company-1", name: "North Star Services", operations: 1640, lastActivityAt: "2026-08-28T08:57:00.000Z" },
    { id: "company-2", name: "Legal Advisory House", operations: 1180, lastActivityAt: "2026-08-28T08:44:00.000Z" },
  ],
};

async function mockBootstrap(page: Page, platformOperations: boolean) {
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/companies") return json({ data: [{ id: "company-1", name: "North Star Services" }] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/platform/capabilities") return json({ platformOperations });
    if (path === "/platform/overview") return json(overview);
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
  await expect(page.getByRole("heading", { name: "Operational health and adoption" })).toBeVisible();
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
