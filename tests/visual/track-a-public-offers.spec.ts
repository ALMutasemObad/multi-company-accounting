import { expect, test } from "@playwright/test";
import type { SubscriptionCatalog } from "../../apps/web/src/types.js";

// Only the fields inspected by this test; the response's remaining fields are
// retained by object spread. Do not pull browser-only modules into NodeNext QA.
type PublicSubscriptionCatalog = { plans: Array<{ id: string; displayName: string }> };

for (const locale of ["ar", "en", "ur", "hi"]) {
  test(`track-a comparison is precise, bounded and keyboard accessible in ${locale}`, async ({ page }, testInfo) => {
    const source = await page.request.get("/api/v1/public/subscription-plans?page=1");
    const fixture = await source.json() as PublicSubscriptionCatalog;
    const plans = fixture.plans.map((plan, index) => ({ ...plan, recurringFee: index === 0 ? "999999999999.1234" : "123.4567", currencyCode: index === 1 ? "USD" : "SAR", taxRate: "10", pricePerAdditionalUser: index === 0 ? "0.0001" : null, billingCycle: index === 0 ? "ANNUAL" as const : index === 1 ? "MONTHLY" as const : "QUARTERLY" as const, includedEmployees: 0 }));
    const paths: string[] = [];
    const failedAssets: string[] = [];
    page.on("response", (response) => { if (response.status() >= 400) failedAssets.push(response.url()); });
    page.on("request", (request) => { if (request.url().includes("/api/v1/")) paths.push(new URL(request.url()).pathname + new URL(request.url()).search); });
    await page.route("**/api/v1/public/subscription-plans?*", (route) => route.fulfill({ json: { plans, meta: { page: 1, pageSize: 9, total: 12, totalPages: 2 } } }));
    await page.addInitScript((value) => localStorage.setItem("mcap.locale", value), locale);
    await page.goto("/plans");
    await expect(page.locator(".plans-card")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".plans-scope")).toContainText("12");
    const summary = page.locator(".plans-comparison > summary");
    await summary.focus(); await page.keyboard.press("Enter");
    await expect(page.locator(".plans-comparison")).toHaveAttribute("open", "");
    const table = page.locator(".plans-comparison table");
    await expect(table).toContainText("123.4567");
    await expect(table).toContainText("0.0001");
    await expect(table).toContainText("USD");
    expect((await table.locator("tbody tr").first().locator("td").first().innerText()).replace(/[^0-9.]/gu, "")).toBe("999999999999.1234");
    await expect(table).toContainText("10%");
    const selectors = page.locator(".plans-compare-selectors select");
    await expect(selectors.first()).toHaveValue(plans[0]!.id);
    await selectors.first().selectOption(plans[2]!.id);
    await expect(table.locator("thead th").nth(1)).toHaveText(plans[2]!.displayName);
    await expect(selectors.nth(1).locator(`option[value="${plans[2]!.id}"]`)).toHaveAttribute("disabled", "");
    await page.locator(".plans-comparison-scroll").focus();
    await expect(page.locator(".plans-comparison-scroll")).toBeFocused();
    await page.keyboard.press(locale === "ar" || locale === "ur" ? "ArrowLeft" : "ArrowRight");
    expect(paths.every((path) => path === "/api/v1/public/subscription-plans?page=1")).toBe(true);
    expect(failedAssets).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const sizes = await page.locator(".public-plans :is(h1,h2,h3,h4,p,small,summary,select,th,td)").evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).fontSize))]);
    expect(sizes.sort()).toEqual(["16px", "24px"]);
    await page.locator(".plans-comparison").screenshot({ path: testInfo.outputPath(`comparison-${locale}.png`) });
  });

  test(`track-a operator distinguishes readiness and listing in ${locale}`, async ({ page }, testInfo) => {
    const response = await page.request.get("/api/v1/subscription/catalog");
    const fixture = await response.json() as SubscriptionCatalog;
    const base = { ...fixture.plans[0]!, publiclyListed: false };
    const versions = [base,
      { ...base, id: "9102", recurringFee: null, includedUsers: null },
      { ...base, id: "9103", effectiveFrom: "2099-01-01T00:00:00Z" },
      { ...base, id: "9104", selfServicePolicy: "DISABLED" },
      { ...base, id: "9105", publiclyListed: true, retiredAt: "2026-08-01T00:00:00Z" },
      { ...base, id: "9106", publicationStatus: "DRAFT", publishedAt: null },
    ];
    let writes = 0;
    page.on("request", (request) => { if (["POST", "PUT", "PATCH"].includes(request.method())) writes += 1; });
    await page.route("**/api/v1/platform/subscription-plans/1101", (route) => route.fulfill({ json: { plan: { id: "1101", code: "VISUAL_BASIC", active: true, version: 0, versions } } }));
    await page.addInitScript((value) => localStorage.setItem("mcap.locale", value), locale);
    await page.goto("/#platformSubscriptions");
    const open = page.locator(".public-offers-plan-open").first();
    await open.focus(); await page.keyboard.press("Enter");
    const rows = page.locator(".public-offers-version");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0).getByRole("button")).toBeDisabled();
    await rows.nth(0).getByRole("checkbox").check();
    await expect(rows.nth(0).getByRole("button")).toBeEnabled();
    for (const index of [1, 2, 3, 5]) {
      await expect(rows.nth(index).getByRole("checkbox")).toBeDisabled();
      await expect(rows.nth(index).getByRole("button")).toBeDisabled();
      await expect(rows.nth(index).locator("li[data-passed=false]").first()).toBeVisible();
    }
    await expect(rows.nth(4).getByRole("button")).toBeEnabled();
    await expect(rows.nth(4).getByRole("checkbox")).toHaveCount(0);
    await expect(rows.nth(1).locator(".public-offers-facts").first()).not.toContainText("unlimited");
    base.version += 1;
    await open.click();
    await expect(rows.first().getByRole("checkbox")).not.toBeChecked();
    await expect(rows.first().getByRole("button")).toBeDisabled();
    await rows.first().locator("summary").first().click();
    await rows.first().locator("summary").last().click();
    expect(writes).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await rows.first().screenshot({ path: testInfo.outputPath(`operator-review-${locale}.png`) });
  });
}

test("track-a recovers when the current server page becomes empty", async ({ page }) => {
  const response = await page.request.get("/api/v1/public/subscription-plans?page=1");
  const fixture = await response.json() as PublicSubscriptionCatalog;
  const requested: string[] = [];
  await page.route("**/api/v1/public/subscription-plans?*", (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get("page")!;
    requested.push(pageNumber);
    return route.fulfill({ json: { plans: pageNumber === "1" ? fixture.plans : [], meta: { page: Number(pageNumber), pageSize: 9, total: pageNumber === "1" ? 12 : 3, totalPages: pageNumber === "1" ? 2 : 1 } } });
  });
  await page.goto("/plans");
  await page.locator(".plans-pager button").last().click();
  await expect(page.locator(".plans-empty")).toBeVisible();
  await expect(page.locator("#plans-catalog")).toBeFocused();
  await expect(page.locator(".plans-comparison")).toHaveCount(0);
  await page.locator(".plans-empty button").click();
  await expect(page.locator(".plans-card")).toHaveCount(3);
  expect(requested).toContain("2");
  expect(requested.at(-1)).toBe("1");
});

test("track-a conflict leaves listing unchanged and never retries the write automatically", async ({ page }) => {
  const response = await page.request.get("/api/v1/subscription/catalog");
  const fixture = await response.json() as SubscriptionCatalog;
  const version = { ...fixture.plans[0]!, publiclyListed: false };
  let writes = 0;
  await page.addInitScript(() => sessionStorage.setItem("mcap.csrf", "visual-qa-csrf"));
  await page.route("**/api/v1/platform/subscription-plans/1101", (route) => route.fulfill({ json: { plan: { id: "1101", code: "VISUAL_BASIC", active: true, version: 0, versions: [version] } } }));
  await page.route("**/api/v1/platform/subscription-plan-versions/2101/public-listing", (route) => { writes += 1; return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Version changed. Refresh the plan." } } }); });
  await page.goto("/#platformSubscriptions");
  await page.locator(".public-offers-plan-open").first().click();
  const row = page.locator(".public-offers-version");
  await row.getByRole("checkbox").check(); await row.getByRole("button").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect(row.getByRole("button")).toBeDisabled();
  expect(writes).toBe(1);
});
