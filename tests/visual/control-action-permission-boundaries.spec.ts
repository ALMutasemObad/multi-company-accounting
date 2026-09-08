import { expect, test, type Page } from "@playwright/test";

const viewPermissions = [
  "approvals.view",
  "audit_logs.view",
  "security_events.view",
] as const;

const approval = {
  id: "approval-qa-101",
  subjectType: "FINANCIAL_CLOSE_RUN",
  subjectId: "close-run-qa",
  subjectVersion: 1,
  subjectSnapshotHashSha256: "0".repeat(64),
  status: "PENDING",
  makerCheckerRequired: true,
  requestedBy: { id: "requester-qa", displayName: "طالب اعتماد تجريبي" },
  decision: null,
  version: 1,
  createdAt: "2026-09-08T08:00:00.000Z",
  updatedAt: "2026-09-08T08:00:00.000Z",
};

const auditLog = {
  id: "audit-qa-101",
  actor: { id: "reader-qa", name: "قارئ تجريبي", email: "reader@example.test" },
  action: "UPDATE",
  entityType: "COMPANY",
  entityId: "company-qa",
  details: { source: "synthetic-read-only-fixture" },
  createdAt: "2026-09-08T08:15:00.000Z",
};

const securityEvent = {
  id: "security-qa-101",
  eventType: "LOGIN_FAILED",
  severity: "HIGH",
  user: null,
  email: "reader@example.test",
  ipAddress: "192.0.2.10",
  userAgent: "Synthetic QA",
  details: { source: "synthetic-read-only-fixture" },
  sessionId: null,
  createdAt: "2026-09-08T08:30:00.000Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
};

async function configureScenario(page: Page, permissions: readonly string[]) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/auth/me") {
      const response = await route.fetch();
      const authorization = await response.json();
      await route.fulfill({ response, json: { ...authorization, permissions } });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/v1/approval-requests") {
      await route.fulfill({ json: { data: [approval], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/v1/audit-logs") {
      await route.fulfill({ json: { data: [auditLog], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } } });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/v1/security-events") {
      await route.fulfill({ json: { data: [securityEvent], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } } });
      return;
    }
    await route.continue();
  });
}

async function openWorkspace(page: Page, view: "approvals" | "audit" | "security", heading: string) {
  await page.goto(`/?qa=${view}#${view}`);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
  await expect(page.locator("[role=alert]")).toHaveCount(0);
}

async function expectUsableViewport(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test("view-only users keep read/details access without mounted controls or side effects", async ({ page }) => {
  await configureScenario(page, viewPermissions);
  const dialogs: string[] = [];
  const downloads: string[] = [];
  const writes: string[] = [];
  const exportReads: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/audit-logs/export.csv") exportReads.push(request.url());
    if (request.method() !== "GET") writes.push(`${request.method()} ${url.pathname}`);
  });

  await openWorkspace(page, "approvals", "صندوق الموافقات");
  await expect(page.locator("tbody tr").filter({ hasText: "طالب اعتماد تجريبي" })).toBeVisible();
  await expect(page.getByRole("button", { name: "اعتماد", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "رفض", exact: true })).toHaveCount(0);
  await expectUsableViewport(page);

  await openWorkspace(page, "audit", "سجل التدقيق");
  await expect(page.locator("tbody tr").filter({ hasText: "reader@example.test" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تصدير CSV", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
  const auditDialog = page.getByRole("dialog");
  await expect(auditDialog).toContainText("synthetic-read-only-fixture");
  await auditDialog.locator(".form-actions").getByRole("button", { name: "إغلاق", exact: true }).click();
  await expectUsableViewport(page);

  await openWorkspace(page, "security", "سجل الأمان");
  await expect(page.getByText("192.0.2.10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
  const securityDialog = page.getByRole("dialog");
  await expect(securityDialog).toContainText("Synthetic QA");
  await expect(securityDialog.getByRole("button", { name: "إقرار التنبيه", exact: true })).toHaveCount(0);
  await securityDialog.locator(".form-actions").getByRole("button", { name: "إغلاق", exact: true }).click();
  await expectUsableViewport(page);

  expect(dialogs).toEqual([]);
  expect(downloads).toEqual([]);
  expect(writes).toEqual([]);
  expect(exportReads).toEqual([]);
});

test("approvals.decide mounts only approval decision controls", async ({ page }) => {
  await configureScenario(page, [...viewPermissions, "approvals.decide"]);
  await openWorkspace(page, "approvals", "صندوق الموافقات");
  await expect(page.getByRole("button", { name: "اعتماد", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "رفض", exact: true })).toBeVisible();
  await expectUsableViewport(page);
});

test("audit_logs.export mounts only the audit export control", async ({ page }) => {
  await configureScenario(page, [...viewPermissions, "audit_logs.export"]);
  await openWorkspace(page, "audit", "سجل التدقيق");
  await expect(page.getByRole("button", { name: "تصدير CSV", exact: true })).toBeVisible();
  await expectUsableViewport(page);
});

test("security_events.acknowledge mounts the action without hiding event details", async ({ page }) => {
  await configureScenario(page, [...viewPermissions, "security_events.acknowledge"]);
  await openWorkspace(page, "security", "سجل الأمان");
  await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Synthetic QA");
  await expect(dialog.getByRole("button", { name: "إقرار التنبيه", exact: true })).toBeVisible();
  await expectUsableViewport(page);
});
