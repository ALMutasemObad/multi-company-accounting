import { expect, test } from "@playwright/test";

for (const locale of ["ar", "en", "ur", "hi"]) {
  test(`public subscription plans: anonymous responsive catalog in ${locale}`, async ({ page }, testInfo) => {
    const apiRequests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/v1/")) apiRequests.push(new URL(request.url()).pathname); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((value) => localStorage.setItem("mcap.locale", value), locale);
    await page.goto("/plans");
    await expect(page.locator(".plans-card")).toHaveCount(3);
    await expect(page.locator("html")).toHaveAttribute("dir", ["ar", "ur"].includes(locale) ? "rtl" : "ltr");
    await page.evaluate(() => document.fonts.ready);
    const columns = (page.viewportSize()?.width ?? 1440) <= 640 ? 1 : (page.viewportSize()?.width ?? 1440) <= 980 ? 2 : 3;
    expect(await page.locator(".plans-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests.every((path) => path === "/api/v1/public/subscription-plans")).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`public-plans-${locale}.png`), fullPage: true });
    await page.locator(".plans-card").nth(1).locator("summary").click();
    await expect(page.locator(".plans-card").nth(1).locator(".plans-addons")).toHaveAttribute("open", "");
    await page.locator(".plans-faq summary").first().click();
    await expect(page.locator(".plans-faq details").first()).toHaveAttribute("open", "");
    await page.locator(".plans-card").nth(1).locator(".plans-cta").click();
    await expect(page).toHaveURL(/\/#register\?plan=102$/);
    await expect(page.locator(".registration-form")).toBeVisible();
    await expect(page.locator(".public-plan-selection")).toBeVisible();
    await page.goto("/?qa=owner-after-registration#subscription");
    await expect(page.locator(".subscription-page")).toBeVisible();
    // The public choice (102) is absent from this authenticated catalog: never add a phantom option.
    await expect(page.locator(".subscription-page select").first()).toHaveValue("2101");
    expect(apiRequests.some((path) => path.includes("change-requests") || path.includes("checkout"))).toBe(false);
  });
}

test("public catalog handles empty, failed and timed-out responses with explicit retry", async ({ page }) => {
  await page.route("**/api/v1/public/subscription-plans?*", (route) => route.fulfill({ status: 200, json: { plans: [], meta: { page: 1, pageSize: 9, total: 0, totalPages: 0 } } }));
  await page.goto("/plans");
  await expect(page.locator(".plans-empty")).toBeVisible();
  await expect(page.locator(".plans-card")).toHaveCount(0);
  await page.unroute("**/api/v1/public/subscription-plans?*");
  await page.route("**/api/v1/public/subscription-plans?*", (route) => route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } }));
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
  await page.unroute("**/api/v1/public/subscription-plans?*");
  await page.getByRole("alert").getByRole("button").click();
  await expect(page.locator(".plans-card")).toHaveCount(3);
  await page.route("**/api/v1/public/subscription-plans?*", (route) => new Promise<void>((resolve) => {
    page.once("close", () => { void route.abort().catch(() => undefined); resolve(); });
  }));
  await page.clock.install();
  await page.reload();
  await expect(page.getByRole("status")).toBeVisible();
  await page.clock.fastForward(12_100);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("public pagination loads the next server page without inventing monthly equivalents", async ({ page }) => {
  const response = await page.request.get("/api/v1/public/subscription-plans?page=1");
  const fixture = await response.json();
  const requestedPages: string[] = [];
  await page.route("**/api/v1/public/subscription-plans?*", (route) => {
    const current = new URL(route.request().url()).searchParams.get("page")!;
    requestedPages.push(current);
    return route.fulfill({ json: {
      plans: current === "1" ? fixture.plans : [{ ...fixture.plans[0], id: "999", displayName: "Annual plan", billingCycle: "ANNUAL", recurringFee: "123.4567" }],
      meta: { page: Number(current), pageSize: 9, total: 10, totalPages: 2 },
    } });
  });
  await page.goto("/plans");
  await expect(page.locator(".plans-pager")).toBeVisible();
  await page.locator(".plans-pager button").last().click();
  await expect(page.locator(".plans-card h3")).toHaveText("Annual plan");
  await expect(page.locator(".plans-price strong")).toContainText("123.4567");
  await expect(page.locator(".plans-pager button").last()).toBeDisabled();
  expect(requestedPages).toContain("2");
});

test("operator explicitly shows and hides a published plan using versioned commands", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("mcap.csrf", "visual-qa-csrf"));
  const response = await page.request.get("/api/v1/subscription/catalog");
  const fixture = await response.json();
  const version = { ...fixture.plans[0], publiclyListed: false };
  const commands: unknown[] = [];
  await page.route("**/api/v1/platform/subscription-plans/1101", (route) => route.fulfill({ json: { plan: {
    id: "1101", code: "VISUAL_BASIC", active: true, version: 0, versions: [version],
  } } }));
  await page.route("**/api/v1/platform/subscription-plan-versions/2101/public-listing", (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    version.publiclyListed = command.publiclyListed;
    version.version += 1;
    return route.fulfill({ json: { version } });
  });
  await page.goto("/#platformSubscriptions");
  await page.locator(".platform-list-panel tbody tr").first().click();
  const controls = page.locator(".public-plan-listing-controls");
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("link")).toHaveAttribute("href", "/plans");
  await controls.getByRole("button").click();
  await expect(controls.getByRole("button")).toContainText("إخفاء");
  await controls.getByRole("button").click();
  await expect(controls.getByRole("button")).toContainText("إظهار");
  expect(commands).toEqual([{ publiclyListed: true, version: 1 }, { publiclyListed: false, version: 2 }]);
});

test("public hash alias keeps FAQ navigation public and supports keyboard links", async ({ page }) => {
  const paths: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/v1/")) paths.push(new URL(request.url()).pathname); });
  await page.goto("/#plans");
  await expect(page.locator(".plans-card")).toHaveCount(3);
  await page.keyboard.press("Tab");
  await expect(page.locator(".plans-skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".plans-card")).toHaveCount(3);
  expect(paths.every((path) => path === "/api/v1/public/subscription-plans")).toBe(true);
});
