import { expect, test, type Page } from "@playwright/test";

const supportedProjects = new Set(["mobile-390", "desktop-1440"]);

const readerPermissions = [
  "users.view",
  "roles.view",
  "approvals.view",
  "audit_logs.view",
  "security_events.view",
];

const managerPermissions = [
  ...readerPermissions,
  "users.create",
  "users.update",
  "users.disable",
  "roles.manage",
  "auth.sessions.view",
  "auth.sessions.revoke",
  "approvals.decide",
  "audit_logs.export",
  "security_events.acknowledge",
];

async function usePermissions(page: Page, permissions: string[]) {
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({ response, json: { ...authorization, permissions } });
  });
}

async function openView(page: Page, view: string, heading: string) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto(`/?qa=admin-controls-audit#${view}`);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

async function readOnlySmoke(page: Page, permissions: string[]) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
  });
  await usePermissions(page, permissions);

  await openView(page, "admin", "المستخدمون والأدوار والصلاحيات");
  await expect(page.getByRole("button", { name: "المستخدمون", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "الأدوار والصلاحيات", exact: true })).toBeVisible();
  await openView(page, "approvals", "صندوق الموافقات");
  await expect(page.getByRole("combobox", { name: "حالة الطلب", exact: true })).toBeVisible();
  await openView(page, "audit", "سجل التدقيق");
  await expect(page.getByRole("button", { name: "تطبيق", exact: true })).toBeVisible();
  await openView(page, "security", "سجل الأمان");
  await expect(page.getByRole("button", { name: "تطبيق", exact: true })).toBeVisible();

  expect(writes).toEqual([]);
}

async function fulfillPendingApproval(page: Page) {
  await page.route(/\/api\/v1\/approval-requests\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        data: [{
          id: "00000000-0000-4000-8000-000000000101",
          subjectType: "FINANCIAL_CLOSE_RUN",
          subjectId: "close-run-qa",
          subjectVersion: 1,
          subjectSnapshotHashSha256: "0".repeat(64),
          status: "PENDING",
          makerCheckerRequired: true,
          requestedBy: { id: "reader-qa", displayName: "قارئ تجريبي" },
          decision: null,
          version: 1,
          createdAt: "2026-09-08T10:00:00.000Z",
          updatedAt: "2026-09-08T10:00:00.000Z",
        }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
    });
  });
}

async function fulfillHighSecurityEvent(page: Page) {
  await page.route(/\/api\/v1\/security-events\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        data: [{
          id: "101",
          eventType: "LOGIN_FAILED",
          severity: "HIGH",
          user: null,
          email: "reader@example.test",
          ipAddress: "192.0.2.10",
          userAgent: "Synthetic QA",
          details: { source: "synthetic-read-only-fixture" },
          sessionId: null,
          createdAt: "2026-09-08T10:00:00.000Z",
          acknowledgedAt: null,
          acknowledgedBy: null,
        }],
        meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
    });
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name), "The audit is scoped to 390px and 1440px.");
});

test("smoke: administrative read journeys stay usable for a manager", async ({ page }) => {
  await readOnlySmoke(page, managerPermissions);
});

test("smoke: administrative read journeys stay usable for a limited reader", async ({ page }) => {
  await readOnlySmoke(page, readerPermissions);
});

test.fixme("reader does not see user and role creation controls", async ({ page }) => {
  await usePermissions(page, readerPermissions);
  await openView(page, "admin", "المستخدمون والأدوار والصلاحيات");
  await expect(page.getByRole("button", { name: "مستخدم جديد", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "الأدوار والصلاحيات", exact: true }).click();
  await expect(page.getByRole("button", { name: "دور جديد", exact: true })).toHaveCount(0);
});

test.fixme("users-view alone can open the users surface without roles-view", async ({ page }) => {
  await usePermissions(page, ["users.view"]);
  await openView(page, "admin", "المستخدمون والأدوار والصلاحيات");
  await expect(page.getByRole("button", { name: "المستخدمون", exact: true })).toBeVisible();
});

test.fixme("reader without auth-sessions-view does not see the sessions tab", async ({ page }) => {
  await usePermissions(page, readerPermissions);
  await openView(page, "admin", "المستخدمون والأدوار والصلاحيات");
  await expect(page.getByRole("button", { name: "جلساتي", exact: true })).toHaveCount(0);
});

test.fixme("approval reader does not see decision actions", async ({ page }) => {
  await usePermissions(page, ["approvals.view"]);
  await fulfillPendingApproval(page);
  await openView(page, "approvals", "صندوق الموافقات");
  await expect(page.getByRole("button", { name: "اعتماد", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "رفض", exact: true })).toHaveCount(0);
});

test.fixme("audit reader does not see CSV export", async ({ page }) => {
  await usePermissions(page, ["audit_logs.view"]);
  await openView(page, "audit", "سجل التدقيق");
  await expect(page.getByRole("button", { name: "تصدير CSV", exact: true })).toHaveCount(0);
});

test.fixme("security reader does not see alert acknowledgement", async ({ page }) => {
  await usePermissions(page, ["security_events.view"]);
  await fulfillHighSecurityEvent(page);
  await openView(page, "security", "سجل الأمان");
  await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
  await expect(page.getByRole("button", { name: "إقرار التنبيه", exact: true })).toHaveCount(0);
});
