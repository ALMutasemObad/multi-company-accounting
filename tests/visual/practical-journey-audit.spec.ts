import { expect, test, type Page } from "@playwright/test";

const auditedProjects = new Set(["mobile-390", "desktop-1440"]);

async function openArabicFixture(page: Page, path: string, ready: string) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name), "The practical audit is maintained at 390 and 1440 only.");
  page.on("pageerror", error => { throw error; });
});

test("the nine audited journeys load without page overflow or runtime errors", async ({ page }) => {
  const journeys = [
    ["login", "/?qa=login", ".login-card"],
    ["home", "/?qa=home#home", ".system-home-page"],
    ["sales", "/?qa=sales#sales", ".workspace-page"],
    ["purchases", "/?qa=purchases#purchases", ".workspace-page"],
    ["inventory", "/?qa=inventory#inventory", ".workspace-page"],
    ["treasury", "/?qa=treasury#treasury", ".workspace-page"],
    ["reports", "/?qa=reports#reports", ".workspace-page"],
    ["group", "/?qa=organization-owner#organizationOwner", ".organization-owner-page"],
    ["subscription", "/?qa=subscription#subscription", ".workspace-page"],
  ] as const;

  for (const [name, path, ready] of journeys) {
    await test.step(name, async () => {
      await openArabicFixture(page, path, ready);
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    });
  }
});

test("P1: new sales and purchase documents start inside the selected open period", async ({ page }) => {
  const failures: string[] = [];

  for (const route of ["sales", "purchases"] as const) {
    await openArabicFixture(page, `/?qa=${route}#${route}`, ".workspace-page");
    await page.getByRole("button", { name: "فاتورة جديدة" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const periodsResponse = await page.request.get("/api/v1/fiscal-periods?page=1&pageSize=100");
    expect(periodsResponse.ok()).toBe(true);
    const periods = (await periodsResponse.json()) as {
      data: Array<{ id: string; startDate: string; endDate: string; status: string }>;
    };
    const openPeriods = periods.data.filter(period => period.status === "OPEN");
    expect(openPeriods).toHaveLength(1);
    const period = openPeriods[0]!;

    await dialog.locator('select[name="fiscalPeriodId"]').selectOption(period.id);
    const documentDate = await dialog.locator('input[name="documentDate"]').inputValue();
    const dueDate = await dialog.locator('input[name="dueDate"]').inputValue();
    if (!documentDate || documentDate < period.startDate || documentDate > period.endDate) {
      failures.push(`${route}: documentDate=${documentDate ?? "missing"}, open=${period.startDate}..${period.endDate}`);
    }
    if (!dueDate || dueDate < documentDate) {
      failures.push(`${route}: dueDate=${dueDate || "missing"}, documentDate=${documentDate || "missing"}`);
    }
    await dialog.getByRole("button", { name: "إغلاق" }).click();
  }

  expect(failures).toEqual([]);
});

test("P2: treasury shows a business-readable ledger account instead of an opaque id", async ({ page }) => {
  await openArabicFixture(page, "/?qa=treasury#treasury", ".workspace-page");
  const row = page.locator(".data-table tbody tr").filter({ hasText: "CB-000001" });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(2)).not.toHaveText(/^account-[a-z0-9-]+$/i);
});

test("P2: sales, purchases, and reports expose complete tab semantics", async ({ page }) => {
  test.fixme(true, "Known gap: visible tab bars declare tablist but their buttons are not semantic tabs and have no selected state.");
  const failures: string[] = [];

  for (const route of ["sales", "purchases", "reports"] as const) {
    await openArabicFixture(page, `/?qa=${route}#${route}`, ".workspace-page");
    const tablist = page.locator('[role="tablist"]').first();
    await expect(tablist).toBeVisible();
    const summary = await tablist.evaluate(element => {
      const buttons = Array.from(element.querySelectorAll(":scope > button"));
      return {
        labelled: Boolean(element.getAttribute("aria-label") || element.getAttribute("aria-labelledby")),
        buttonCount: buttons.length,
        tabCount: buttons.filter(button => button.getAttribute("role") === "tab").length,
        selectedCount: buttons.filter(button => button.getAttribute("aria-selected") === "true").length,
      };
    });
    if (!summary.labelled || summary.tabCount !== summary.buttonCount || summary.selectedCount !== 1) {
      failures.push(`${route}: ${JSON.stringify(summary)}`);
    }
  }

  expect(failures).toEqual([]);
});
