import { expect, test, type Page } from "@playwright/test";
import type { SubscriptionUsageSnapshot as SubscriptionUsage } from "../../apps/api/src/platform-subscriptions/subscription-usage-ports.js";

// Synthetic measurements only, never seed or production pricing.
const usage: SubscriptionUsage = {
  companyId: "1", measuredAt: "2026-08-31T09:00:00.000Z", consistency: "BEST_EFFORT",
  plan: { id: "2101", displayName: "خطة الاختبار · Test plan", billingCycle: "ANNUAL" },
  period: { kind: "STATISTICAL_MONTH_TO_DATE", timezone: "UTC", startsAt: "2026-08-01T00:00:00.000Z", endsAtExclusive: "2026-08-31T09:00:00.000Z", billingPeriodStatus: "NOT_CONFIGURED" },
  metrics: {
    users: { used: 7, included: 5, remaining: 0, excess: 2, state: "EXCEEDED", comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_COMPANY_USERS" },
    employees: { used: 0, included: 0, remaining: 0, excess: 0, state: "AT_LIMIT", comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_OR_ON_LEAVE_EMPLOYEES" },
    postedDocuments: { used: 4_000_000_000, included: 100, remaining: null, excess: null, state: "UNKNOWN", comparisonBasis: "UNCONFIRMED_PERIOD", definition: "DOCUMENTS_POSTED_IN_WINDOW" },
  },
};

async function setup(page: Page, locale = "en", preference = "") {
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /change-requests|checkout|subscription\/usage/.test(request.url())) commands.push(request.url());
  });
  await page.addInitScript(({ locale, preference }) => {
    localStorage.setItem("mcap.locale", locale);
    if (preference) sessionStorage.setItem("mcap.subscription-plan-intent", JSON.stringify({ id: preference, expiresAt: Date.now() + 86_400_000 }));
  }, { locale, preference });
  await page.route("**/api/v1/subscription/usage", (route) => route.fulfill({ json: usage }));
  return commands;
}

for (const locale of ["ar", "en", "ur", "hi"]) {
  test(`usage cards are readable, bounded and non-financial in ${locale}`, async ({ page }, testInfo) => {
    const commands = await setup(page, locale);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/#subscription");
    const panel = page.locator(".subscription-usage-panel");
    await expect(panel.locator(".subscription-usage-card")).toHaveCount(3);
    await expect(page.locator("html")).toHaveAttribute("dir", ["ar", "ur"].includes(locale) ? "rtl" : "ltr");
    await expect(panel.locator(".state-exceeded")).toHaveCount(1);
    await expect(panel.locator(".state-at_limit")).toHaveCount(1);
    await expect(panel.locator(".state-unknown progress")).toHaveCount(0);
    await expect(panel.locator(".state-unknown dl > div")).toHaveCount(2);
    await expect(panel).toContainText("UTC");
    await expect(panel).not.toContainText("subscriptionUsage.");
    const fontSizes = await panel.locator("h2, h3, p, dt, dd, button").evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).fontSize))].sort());
    expect(fontSizes).toEqual(["16px", "18px"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`usage-${locale}.png`), fullPage: true });
    const refresh = panel.getByRole("button");
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await refresh.press("Enter");
    await expect(panel.locator(".subscription-usage-card")).toHaveCount(3);
    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("unconfigured allowance is not zero or unlimited; unknown counts never gain a progress bar", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/subscription/usage", (route) => route.fulfill({ json: {
    ...usage, plan: null, metrics: {
      ...usage.metrics,
      users: { ...usage.metrics.users, included: null, remaining: null, excess: null, state: "NOT_CONFIGURED" },
      employees: { ...usage.metrics.employees, used: null, included: 10, remaining: null, excess: null, state: "UNKNOWN" },
    },
  } }));
  await page.goto("/#subscription");
  await expect(page.locator(".state-not_configured")).toContainText("Not configured");
  await expect(page.locator(".subscription-usage-card progress")).toHaveCount(0);
});

test("errors and throttling show a safe retry, not zeros or raw server errors", async ({ page }) => {
  const commands = await setup(page);
  await page.route("**/api/v1/subscription/usage", (route) => route.fulfill({ status: 429, json: { code: "TOO_MANY_REQUESTS", reason: "private internals" } }));
  await page.goto("/#subscription");
  const panel = page.locator(".subscription-usage-panel");
  await expect(panel.getByRole("alert")).toContainText("does not mean zero");
  await expect(panel).not.toContainText("private internals");
  await page.unroute("**/api/v1/subscription/usage");
  await page.route("**/api/v1/subscription/usage", (route) => route.fulfill({ json: usage }));
  await panel.getByRole("alert").getByRole("button").click();
  await expect(panel.locator(".subscription-usage-card")).toHaveCount(3);
  expect(commands).toEqual([]);
});

test("a slow read times out without retrying and a different company response is discarded", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/v1/subscription/usage", async (route) => {
    calls += 1;
    await new Promise<void>((resolve) => { page.once("close", () => resolve()); });
    await route.abort().catch(() => undefined);
  });
  await page.clock.install();
  await page.goto("/#subscription");
  const panel = page.locator(".subscription-usage-panel");
  await expect(panel.getByRole("status")).toBeVisible();
  // React StrictMode mounts effects twice in this development harness; neither request is a retry.
  await page.clock.fastForward(12_100);
  await expect(panel.getByRole("alert")).toContainText("longer than expected");
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(2);
  const timedOutCalls = calls;
  await page.clock.fastForward(60_000);
  expect(calls).toBe(timedOutCalls);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/v1/subscription/usage", (route) => route.fulfill({ json: { ...usage, companyId: "999" } }));
  await panel.getByRole("alert").getByRole("button").click();
  await expect(panel.getByRole("alert")).toContainText("could not retrieve");
  await expect(panel.locator(".subscription-usage-card")).toHaveCount(0);
});

test("no usage request when subscription permission is absent", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/v1/subscription/usage", (route) => { calls += 1; return route.fulfill({ json: usage }); });
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, permissions: body.permissions.filter((permission: string) => !permission.startsWith("subscriptions.")) } });
  });
  await page.goto("/#subscription");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".subscription-usage-panel")).toHaveCount(0);
  expect(calls).toBe(0);
});

test("available URL preference is retained without an automatic subscription command", async ({ page }) => {
  const commands = await setup(page, "en", "2101");
  await page.goto("/#subscription?plan=2101");
  await expect(page.locator(".subscription-change-form select").first()).toHaveValue("2101");
  await expect(page.locator(".subscription-catalog-notice")).toHaveCount(0);
  expect(commands).toEqual([]);
});

test("missing preference on a paginated catalog stays empty until explicit selection", async ({ page }) => {
  const commands = await setup(page, "en", "999");
  const catalogResponse = await page.request.get("/api/v1/subscription/catalog?page=1&pageSize=100");
  const catalog = await catalogResponse.json();
  const pages: number[] = [];
  await page.route("**/api/v1/subscription/catalog?*", (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(number);
    return route.fulfill({ json: { plans: number === 1 ? catalog.plans : [{ ...catalog.plans[0], id: "999" }], meta: { page: number, pageSize: 100, total: 101, totalPages: 2 } } });
  });
  await page.goto("/#subscription?plan=999");
  const select = page.locator(".subscription-change-form select").first();
  await expect(select).toHaveValue("");
  await expect(page.locator(".subscription-catalog-notice")).toContainText("displayed plans");
  await expect(page.locator(".subscription-change-form button[type=submit]")).toBeDisabled();
  const initialPageRequests = pages.length;
  await page.locator(".subscription-catalog-pagination button").last().click();
  await expect(select.locator("option[value='999']")).toHaveCount(1);
  await expect(select).toHaveValue("");
  expect(pages.slice(0, initialPageRequests).every((number) => number === 1)).toBe(true);
  expect(pages.slice(initialPageRequests)).toEqual([2]);
  await select.selectOption("999");
  await expect(page.locator(".subscription-change-form button[type=submit]")).toBeEnabled();
  expect(commands).toEqual([]);
});

test("a previous selection that disappears clears dependent optional modules; no preference stays empty", async ({ page }) => {
  const commands = await setup(page);
  const catalog = await (await page.request.get("/api/v1/subscription/catalog")).json();
  let changed = false;
  await page.route("**/api/v1/subscription/catalog?*", (route) => route.fulfill({ json: {
    ...catalog, plans: [{ ...catalog.plans[0], id: changed ? "999" : "2101", modules: [...catalog.plans[0].modules, { id: "3102", code: "SALES", displayName: "Optional test module", active: true, selectionMode: "OPTIONAL", additionalRecurringFee: "0.0000", dependencyIds: [] }] }],
  } }));
  await page.goto("/#subscription");
  const select = page.locator(".subscription-change-form select").first();
  await expect(select).toHaveValue("");
  await select.selectOption("2101");
  await expect(select).toHaveValue("2101");
  await page.locator(".subscription-change-form input[type=checkbox]").check();
  changed = true;
  await page.locator(".subscription-page > .page-heading button").click();
  await expect(select).toHaveValue("");
  await expect(page.locator(".subscription-catalog-notice")).toBeVisible();
  await select.selectOption("999");
  await expect(page.locator(".subscription-change-form input[type=checkbox]")).not.toBeChecked();
  expect(commands).toEqual([]);
});
