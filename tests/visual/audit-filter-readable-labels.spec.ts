import { expect, test, type Page, type Route } from "@playwright/test";

type RecordedRequest = { method: string; path: string; search: string };

const localeLabels = {
  ar: { knownAction: "إنشاء عميل", knownEntity: "عميل", unknownAction: "إجراء غير معروف", unknownEntity: "كيان غير معروف" },
  en: { knownAction: "Customer created", knownEntity: "Customer", unknownAction: "Unknown action", unknownEntity: "Unknown entity" },
  ur: { knownAction: "کسٹمر نے تخلیق کیا", knownEntity: "گاہک", unknownAction: "نامعلوم کارروائی", unknownEntity: "نامعلوم ہستی" },
  hi: { knownAction: "ग्राहक बनाया गया", knownEntity: "ख़रीदार", unknownAction: "अज्ञात कार्रवाई", unknownEntity: "अज्ञात इकाई" },
} as const;

const auditRow = {
  id: "1",
  actor: { id: "7", name: "Audit User", email: "audit@example.test" },
  action: "CUSTOMER_CREATED",
  entityType: "CUSTOMER",
  entityId: "42",
  details: { source: "synthetic" },
  createdAt: "2026-09-08T09:00:00.000Z",
};

const list = (data: unknown[]) => ({ data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: data.length ? 1 : 0 } });
const json = (route: Route, body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function auditFixture(page: Page) {
  const requests: RecordedRequest[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("mcap.locale", "en");
    sessionStorage.setItem("mcap.csrf", "audit-filter-csrf");
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice("/api/v1".length);
    requests.push({ method: request.method(), path, search: url.search });
    if (path === "/auth/me") return json(route, {
      user: { id: "7", displayName: "Audit User" },
      selectedCompany: { id: "1", name: "Audit Company", timezone: "Asia/Riyadh" },
      modules: ["CORE_ACCOUNTING"],
      permissions: ["audit_logs.view"],
    });
    if (path === "/auth/companies") return json(route, { data: [{ id: "1", name: "Audit Company" }] });
    if (path === "/platform/capabilities") return json(route, { platformOperations: false });
    if (path === "/organizations/workspaces") return json(route, { data: [] });
    if (path === "/auth/csrf") return json(route, { csrfToken: "audit-filter-csrf" });
    if (path === "/audit-logs/options") return json(route, {
      actions: ["CUSTOMER_CREATED", "POS_SALE_COMPLETED"],
      entityTypes: ["CUSTOMER", "POS_SALE"],
      users: [{ id: "7", name: "Audit User", email: "audit@example.test" }],
    });
    if (path === "/audit-logs") return json(route, list([auditRow]));
    if (!["GET", "HEAD"].includes(request.method())) return route.fulfill({ status: 500, json: { code: "UNEXPECTED_WRITE" } });
    return json(route, list([]));
  });
  return { requests, pageErrors, requestFailures };
}

test("audit filter labels stay readable while applied and cleared queries retain exact codes", async ({ page }, testInfo) => {
  const fixture = await auditFixture(page);
  await page.goto("/#audit");
  await expect(page.locator(".audit-filters")).toBeVisible();
  const actionSelect = page.locator(".audit-filters select").nth(1);
  const entitySelect = page.locator(".audit-filters select").nth(2);
  const language = page.locator(".language-switcher select");

  for (const locale of ["ar", "en", "ur", "hi"] as const) {
    await language.selectOption(locale);
    const labels = localeLabels[locale];
    await expect(actionSelect.locator('option[value="CUSTOMER_CREATED"]')).toHaveText(labels.knownAction);
    await expect(entitySelect.locator('option[value="CUSTOMER"]')).toHaveText(labels.knownEntity);
    await expect(actionSelect.locator('option[value="POS_SALE_COMPLETED"]')).toHaveText(`${labels.unknownAction} — POS sale completed`);
    await expect(entitySelect.locator('option[value="POS_SALE"]')).toHaveText(`${labels.unknownEntity} — POS sale`);
    await expect(actionSelect.locator('option[value="POS_SALE_COMPLETED"]')).not.toHaveText("POS_SALE_COMPLETED");
    await expect(entitySelect.locator('option[value="POS_SALE"]')).not.toHaveText("POS_SALE");
  }

  await language.selectOption("en");
  await actionSelect.selectOption("POS_SALE_COMPLETED");
  await entitySelect.selectOption("POS_SALE");
  await page.locator('.audit-filter-actions button[type="submit"]').click();
  await expect.poll(() => fixture.requests.filter((request) => request.path === "/audit-logs").at(-1)?.search ?? "").toContain("action=POS_SALE_COMPLETED");
  expect(fixture.requests.filter((request) => request.path === "/audit-logs").at(-1)?.search).toContain("entityType=POS_SALE");

  await page.locator('.audit-filter-actions button[type="button"]').click();
  await expect.poll(() => fixture.requests.filter((request) => request.path === "/audit-logs").at(-1)?.search ?? "").not.toContain("action=");
  expect(fixture.requests.filter((request) => request.path === "/audit-logs").at(-1)?.search).not.toContain("entityType=");
  expect(fixture.requests.filter((request) => !["GET", "HEAD"].includes(request.method))).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.requestFailures.filter((failure) => !failure.endsWith("net::ERR_ABORTED"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach("audit-filter-request-log", { body: JSON.stringify(fixture.requests, null, 2), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("audit-filter-readable-labels.png"), fullPage: true });
});
