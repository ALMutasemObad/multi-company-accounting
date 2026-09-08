import { expect, test, type Page, type Route } from "@playwright/test";

const supportedProjects = new Set(["mobile-390", "desktop-1440"]);
const period = {
  id: "period-september",
  fiscalYearId: "year-2026",
  periodNumber: 9,
  name: "September 2026",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  status: "OPEN",
  closedAt: null,
  reopenedAt: null,
  reopenReason: null,
  version: 0,
};
const accounts = [
  { id: "account-debit", accountTypeId: "asset", parentAccountId: null, code: "1100", nameAr: "مدين", nameEn: "Debit account", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: null, sourceTemplateKey: null },
  { id: "account-credit", accountTypeId: "revenue", parentAccountId: null, code: "4100", nameAr: "دائن", nameEn: "Credit account", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: null, sourceTemplateKey: null },
];
const currency = { id: "currency-sar", code: "SAR", nameAr: "ريال سعودي", decimals: 2, isBase: true, latestExchangeRate: "1.00000000", latestExchangeRateDate: "2026-09-09" };

const list = (data: unknown[]) => ({ data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: data.length ? 1 : 0 } });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installFixture(page: Page) {
  let releasePeriods = () => {};
  const periodsReady = new Promise<void>((resolve) => { releasePeriods = resolve; });
  const writes: Array<Record<string, unknown>> = [];

  await page.clock.install({ time: new Date("2026-09-08T22:30:00.000Z") });
  await page.addInitScript(() => {
    localStorage.setItem("mcap.locale", "en");
    sessionStorage.setItem("mcap.csrf", "manual-journal-date-csrf");
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    if (path === "/auth/me") return json(route, {
      user: { id: "journal-user", displayName: "Journal user" },
      selectedCompany: { id: "company-riyadh", name: "Riyadh company", timezone: "Asia/Riyadh" },
      modules: ["CORE_ACCOUNTING"],
      permissions: ["manual_journals.view", "manual_journals.create", "accounts.view", "fiscal_periods.view", "cost_centers.manage", "currencies.view", "customers.view", "suppliers.view"],
    });
    if (path === "/auth/companies") return json(route, { data: [{ id: "company-riyadh", name: "Riyadh company", timezone: "Asia/Riyadh" }] });
    if (path === "/platform/capabilities") return json(route, { platformOperations: false });
    if (path === "/organizations/workspaces") return json(route, { data: [] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/accounts") return json(route, list(accounts));
    if (path === "/fiscal-periods") {
      await periodsReady;
      return json(route, list([period]));
    }
    if (path === "/cost-centers" || path === "/customers" || path === "/suppliers") return json(route, list([]));
    if (path === "/currencies") return json(route, { data: [currency] });
    if (path === "/manual-journals" && method === "GET") return json(route, list([]));
    if (path === "/manual-journals" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      return json(route, {
        document: {
          id: "journal-created",
          documentType: "MANUAL_JOURNAL",
          documentNumber: "JV-2026-0001",
          documentDate: body.documentDate,
          description: body.description,
          status: "DRAFT",
          fiscalPeriodId: body.fiscalPeriodId,
          version: 0,
          createdAt: "2026-09-09T00:00:00.000Z",
          postedAt: null,
        },
        entries: body.entries,
      }, 201);
    }
    return json(route, list([]));
  });

  return { releasePeriods, writes };
}

async function openForm(page: Page) {
  await page.goto("/#journals");
  await expect(page.locator(".workspace-page")).toBeVisible();
  await page.getByRole("button", { name: "New journal entry", exact: true }).first().click();
  const form = page.locator(".journal-form");
  await expect(form).toBeVisible();
  return form;
}

async function completeAndSubmit(form: ReturnType<Page["locator"]>) {
  await form.getByLabel("Document description").fill("Timezone-aware draft");
  await form.getByLabel("Entry description").fill("Balanced opening entry");
  const rows = form.locator(".journal-line:not(.headings)");
  await rows.nth(0).locator("select").nth(0).selectOption("account-debit");
  await rows.nth(1).locator("select").nth(0).selectOption("account-credit");
  await rows.nth(0).locator("select").nth(3).selectOption("currency-sar");
  await rows.nth(1).locator("select").nth(3).selectOption("currency-sar");
  await rows.nth(0).locator(".money-input").nth(0).fill("100");
  await rows.nth(1).locator(".money-input").nth(1).fill("100");
  await form.getByRole("button", { name: "Save the draft", exact: true }).click();
}

test.beforeEach(({}, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name), "This regression targets 390px and 1440px only.");
});

test("late references apply company-date defaults and preserve the exact request body", async ({ page }) => {
  const fixture = await installFixture(page);
  const form = await openForm(page);
  await expect(form.getByLabel("Fiscal period")).toHaveValue("");
  await expect(form.getByLabel("Document date")).toHaveValue("2026-09-09");
  await expect(form.getByLabel("Entry date")).toHaveValue("2026-09-09");

  fixture.releasePeriods();
  await expect(form.getByLabel("Fiscal period")).toHaveValue("period-september");
  await completeAndSubmit(form);
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({
    fiscalPeriodId: "period-september",
    documentDate: "2026-09-09",
    description: "Timezone-aware draft",
    entries: [{
      entryNumber: 1,
      entryDate: "2026-09-09",
      description: "Balanced opening entry",
      lines: [
        { lineNumber: 1, accountId: "account-debit", currencyId: "currency-sar", exchangeRate: "1.00000000", debitAmount: "100.0000", creditAmount: "0.0000" },
        { lineNumber: 2, accountId: "account-credit", currencyId: "currency-sar", exchangeRate: "1.00000000", debitAmount: "0.0000", creditAmount: "100.0000" },
      ],
    }],
  });
});

test("late references never overwrite dates entered by the user", async ({ page }) => {
  const fixture = await installFixture(page);
  const form = await openForm(page);
  await form.getByLabel("Document date").fill("2026-09-15");
  await form.getByLabel("Entry date").fill("2026-09-16");

  fixture.releasePeriods();
  await expect(form.getByLabel("Fiscal period")).toHaveValue("period-september");
  await expect(form.getByLabel("Document date")).toHaveValue("2026-09-15");
  await expect(form.getByLabel("Entry date")).toHaveValue("2026-09-16");
  await completeAndSubmit(form);
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({
    fiscalPeriodId: "period-september",
    documentDate: "2026-09-15",
    entries: [{ entryDate: "2026-09-16" }],
  });
});
