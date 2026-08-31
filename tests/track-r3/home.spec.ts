import { expect, test, type Page } from "@playwright/test";

const modules = ["SALES", "INVENTORY", "TREASURY", "POS", "REPORTING", "CORE_ACCOUNTING", "PURCHASES"];
const permissions = ["warehouses.view", "inventory_catalog.view", "inventory_movements.view", "inventory_barcodes.view", "cash_bank_accounts.view", "pos.view", "pos.checkout", "settings.manage", "companies.view", "currencies.view", "fiscal_periods.view", "sales_invoices.view", "receipts.view", "reports.cash_flow.view", "purchase_invoices.view", "suppliers.view"];
const company = { id: "1", name: "R3 Test Grocery · بقالة اختبار", timezone: "Asia/Riyadh" };
const evidencePaths = ["/warehouses", "/units-of-measure", "/inventory-items", "/inventory-balances", "/cash-bank-accounts"];
const labels = {
  ar: { check: "فحص البيانات المتاحة", catalog: "الأصناف والباركود والأسعار", review: "يحتاج مراجعة" },
  en: { check: "Check available data", catalog: "Products, barcodes and prices", review: "Needs review" },
  ur: { check: "دستیاب ڈیٹا جانچیں", catalog: "اشیا، بارکوڈ اور قیمتیں", review: "جائزہ درکار" },
  hi: { check: "उपलब्ध डेटा जाँचें", catalog: "वस्तुएँ, बारकोड और कीमतें", review: "समीक्षा आवश्यक" },
};

async function setup(page: Page, options: { locale?: keyof typeof labels; permissions?: string[]; modules?: string[]; empty?: boolean; error?: number; malformed?: boolean } = {}) {
  const evidence: string[] = [];
  const commands: string[] = [];
  await page.addInitScript((locale) => localStorage.setItem("mcap.locale", locale), options.locale ?? "en");
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() !== "GET") { commands.push(`${request.method()} ${path}`); return route.fulfill({ status: 405, json: {} }); }
    if (path === "/auth/companies") return route.fulfill({ json: { data: [company] } });
    if (path === "/auth/me") return route.fulfill({ json: { user: { id: "1", displayName: "R3 Test" }, selectedCompany: company, modules: options.modules ?? modules, permissions: options.permissions ?? permissions } });
    if (path === "/platform/capabilities") return route.fulfill({ json: { platformOperations: false } });
    if (evidencePaths.includes(path) && url.searchParams.get("pageSize") === "1") {
      evidence.push(`${path}${url.search}`);
      if (options.error) return route.fulfill({ status: options.error, json: { code: "INTERNAL_ERROR", reason: "private raw details" } });
      if (options.malformed) return route.fulfill({ json: { data: [] } });
      const data = options.empty ? [] : [{ id: "1", isActive: true, accountType: "CASH", onHand: "2.000000" }];
      return route.fulfill({ json: { data, meta: { page: 1, pageSize: 1, total: data.length, totalPages: data.length } } });
    }
    return route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
  });
  return { evidence, commands };
}

for (const locale of ["ar", "en", "ur", "hi"] as const) {
  for (const width of [390, 768, 1440]) {
    test(`${locale} ${width}: real home, two type sizes, review not completion`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const { commands, evidence } = await setup(page, { locale });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/#home");
      const home = page.locator(".retail-home");
      const guide = page.locator(".retail-onboarding");
      await expect(home).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", ["ar", "ur"].includes(locale) ? "rtl" : "ltr");
      await expect(guide.locator(".retail-step-list button")).toHaveCount(6);
      expect(evidence).toEqual([]);
      await guide.getByRole("button", { name: labels[locale].catalog, exact: true }).click();
      await expect(guide.locator("[data-fact=items]")).toHaveAttribute("data-state", "notChecked");
      await guide.getByRole("button", { name: labels[locale].check }).click();
      await expect(guide.locator("[data-fact=items]")).toHaveAttribute("data-state", "found");
      await expect(guide.locator(".retail-review-label")).toHaveText(labels[locale].review);
      expect(evidence).toHaveLength(5);
      expect(commands).toEqual([]);
      expect(errors).toEqual([]);
      await expect(home).not.toContainText(/home\.(setup|fact)|undefined|NaN/u);
      const fontSizes = await home.locator("h1, h2, h3, p, button, small, strong").evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).fontSize))].sort());
      expect(fontSizes).toEqual(["16px", "20px"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const undersized = await guide.locator("button").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().height < 44).length);
      expect(undersized).toBe(0);
      await guide.locator(".retail-next").focus();
      await guide.locator(".retail-next").press("Enter");
      await expect(guide.locator(".retail-step-detail")).toHaveAttribute("data-step", "stock");
      await expect(guide.locator("h3")).toBeFocused();
      // Only two retained screenshots across the whole matrix.
      if (locale === "ar" && (width === 390 || width === 1440)) {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: testInfo.outputPath(`home-ar-${width}.png`), fullPage: true });
      }
    });
  }
}

test("cashier-only and POS viewer do not see or request protected setup resources", async ({ page }) => {
  const { commands, evidence } = await setup(page, { permissions: ["pos.view"] });
  await page.goto("/#home");
  const home = page.locator(".retail-home");
  await expect(home.locator(".retail-cashier")).toHaveText("Review POS sales");
  await expect(home.locator(".retail-quick-links button")).toHaveCount(0);
  await expect(home.getByRole("button", { name: "Check available data" })).toHaveCount(0);
  await home.locator(".retail-step-list button").nth(1).click();
  await expect(home.locator("[data-setup-action]")).toHaveCount(0);
  await expect(home.locator("[data-fact=items]")).toHaveAttribute("data-state", "unavailable");
  await expect(home).toContainText("No action is available");
  expect(commands).toEqual([]); expect(evidence).toEqual([]);
});

test("hidden modules remove their shortcuts and reads even with stale RBAC grants", async ({ page }) => {
  const { evidence } = await setup(page, { modules: ["POS"] });
  await page.goto("/#home");
  await expect(page.locator(".retail-cashier")).toBeVisible();
  await expect(page.locator(".retail-quick-links")).toHaveCount(0);
  await expect(page.locator(".retail-guide-header button")).toHaveCount(0);
  expect(evidence).toEqual([]);
});

test("an empty authorized workspace explains access without showing platform actions", async ({ page }) => {
  const { evidence } = await setup(page, { modules: [], permissions: [] });
  await page.goto("/#home");
  await expect(page.locator(".retail-empty")).toContainText("No operating screens");
  await expect(page.locator(".retail-onboarding")).toHaveCount(0);
  await expect(page.locator(".system-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Platform operations", exact: true })).toHaveCount(0);
  expect(evidence).toEqual([]);
});

test("empty evidence is explicitly scoped to the last check; revisiting never completes a stage", async ({ page }) => {
  const { commands } = await setup(page, { empty: true });
  await page.goto("/#home");
  await page.getByRole("button", { name: "Check available data" }).click();
  await page.locator(".retail-step-list button").nth(1).click();
  await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "empty");
  await page.locator("[data-setup-action=items]").click();
  await expect(page).toHaveURL(/#inventory$/u);
  await expect(page.getByRole("tab", { name: "Warehouses", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goto("/#home");
  await page.locator(".retail-step-list button").nth(1).click();
  await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "notChecked");
  await expect(page.locator(".retail-price-review")).toContainText("Selling prices need review");
  expect(commands).toEqual([]);
});

for (const status of [403, 429, 500]) {
  test(`read failure ${status} is review, not missing or ready`, async ({ page }) => {
    const { commands, evidence } = await setup(page, { error: status });
    await page.goto("/#home");
    await page.getByRole("button", { name: "Check available data" }).click();
    await expect(page.locator(".retail-onboarding [role=alert]")).toContainText("does not mean it is missing");
    await page.locator(".retail-step-list button").nth(1).click();
    await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "error");
    await expect(page.locator(".retail-onboarding")).not.toContainText("private raw details");
    expect(evidence).toHaveLength(5); expect(commands).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await setup(page, { empty: true });
    await page.getByRole("button", { name: "Check available data" }).click();
    await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "empty");
  });
}

test("malformed responses never create a positive indicator", async ({ page }) => {
  await setup(page, { malformed: true });
  await page.goto("/#home");
  await page.getByRole("button", { name: "Check available data" }).click();
  await expect(page.locator(".retail-onboarding [role=alert]")).toBeVisible();
  await page.locator(".retail-step-list button").nth(3).click();
  await expect(page.locator("[data-fact=cash]")).toHaveAttribute("data-state", "error");
});

test("slow reads time out and are not replayed automatically", async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route("**/api/v1/inventory-items?**", async (route) => {
    requests++;
    await new Promise<void>((resolve) => page.once("close", () => resolve()));
    await route.abort().catch(() => undefined);
  });
  await page.clock.install();
  await page.goto("/#home");
  await page.locator(".retail-step-list button").nth(1).click();
  await page.getByRole("button", { name: "Check available data" }).click();
  await expect(page.getByRole("status")).toContainText("Checking permitted");
  await page.clock.fastForward(10_100);
  await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "error");
  await page.clock.fastForward(30_000);
  expect(requests).toBe(1);
});
