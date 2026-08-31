import { expect, test, type Page, type Route } from "@playwright/test";
import { arPos, enPos, hiPos, urPos } from "../../apps/web/src/i18n/locales/pos";

const dictionary = { ar: arPos, en: enPos, hi: hiPos, ur: urPos };
async function open(page: Page, locale: keyof typeof dictionary = "en") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".language-switcher select").selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator(".pos-experience-product")).toHaveCount(4);
}
async function operatingContext(page: Page) {
  await page.getByRole("combobox", { name: enPos["pos.period"], exact: true }).selectOption("1");
  await page.getByLabel(enPos["pos.descriptionLabel"], { exact: true }).fill("Local checkout test");
  for (const label of [enPos["pos.customer"], enPos["pos.warehouse"], enPos["pos.cashAccount"], enPos["pos.paymentMethod"]]) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
  }
}
const milk = (page: Page) => page.locator(".pos-experience-product").filter({ hasText: "ITM-TEST-1" });
const checkout = (page: Page) => page.getByRole("button", { name: enPos["pos.checkout"], exact: true });

test("typography stays at two sizes with a compact heading and readable scanner on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, "ar");
  await page.locator(".pos-experience-context > summary").click();
  await milk(page).click();
  const sizes = await page.locator(".pos-experience").evaluate((root) => [...new Set([...root.querySelectorAll("h1,h2,h3,p,span,strong,label,input,button,summary")].filter((element) => element.getClientRects().length).map((element) => getComputedStyle(element).fontSize))]);
  expect(sizes.sort()).toEqual(["16px", "20px"]);
  expect(await page.locator(".pos-experience h1").evaluate((element) => getComputedStyle(element).fontSize)).toBe("20px");
  expect(await page.locator(".pos-barcode-copy span").evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("pos-mobile-ar.png"), fullPage: true });
});

for (const locale of ["ar", "en", "hi", "ur"] as const) {
  for (const width of [390, 768, 1440]) {
    test(`four-language retail/tiles basket, keyboard and fit: ${locale} ${width}`, async ({ page }) => {
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 950 }); await open(page, locale);
      const t = dictionary[locale];
      await page.locator(".pos-experience-context > summary").click();
      await milk(page).focus(); await page.keyboard.press("Enter");
      await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
      await page.getByRole("button", { name: t["pos.tiles"], exact: true }).click();
      await milk(page).click();
      await expect(page.getByTestId("pos-cart-line").locator(".pos-experience-quantity input")).toHaveValue("2.000000");
      await expect(page.locator(".pos-experience-summary")).toContainText("4.20");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator("html").getAttribute("dir")).toBe(["ar", "ur"].includes(locale) ? "rtl" : "ltr");
      expect(await page.locator(".pos-experience").evaluate((root) => [...root.querySelectorAll("input,button")].filter((element) => element.getClientRects().length).every((element) => element.getBoundingClientRect().height >= 43))).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("FIFO scanner preserves leading zeros and waits for profile as well as resolve", async ({ page }) => {
  await open(page); await operatingContext(page);
  const scans: string[] = [];
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/inventory-barcodes/resolve", async (route) => { scans.push(route.request().postDataJSON().value); await route.fallback(); });
  await page.route("**/sales/catalog/items/1", async (route) => { await delayed; await route.fallback(); });
  const scanner = page.locator(".pos-barcode-scanner input");
  await scanner.fill("0001"); await scanner.press("Enter");
  await scanner.fill("0002"); await scanner.press("Enter");
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(2);
  await expect(page.getByTestId("pos-cart-line").first().getByText(enPos["pos.profileLoading"], { exact: true })).toBeVisible();
  await expect(checkout(page)).toBeDisabled();
  expect(scans).toEqual(["0001", "0002"]);
  release();
  await expect(checkout(page)).toBeEnabled();
  await scanner.fill("0001"); await scanner.press("Enter");
  await expect(page.getByTestId("pos-cart-line").first().locator(".pos-experience-quantity input")).toHaveValue("2.000000");
});

test("late profile cannot overwrite a manually edited line or leak into a changed company", async ({ page }) => {
  await open(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/sales/catalog/items/1", async (route) => { await delayed; await route.fallback(); });
  const scanner = page.locator(".pos-barcode-scanner input");
  await scanner.fill("0001"); await scanner.press("Enter");
  const line = page.getByTestId("pos-cart-line");
  await expect(page.getByText(enPos["pos.profileLoading"], { exact: true })).toBeVisible();
  await line.locator(".pos-experience-quantity input").fill("3");
  await line.getByLabel("Unit price Test milk", { exact: true }).fill("7.1234");
  release();
  await expect(line.getByLabel("Unit price Test milk", { exact: true })).toHaveValue("7.1234");
  await page.getByLabel("Test company", { exact: true }).selectOption("2");
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(0);
  await expect(page.getByLabel(enPos["pos.customer"], { exact: true })).toHaveValue("");
});

test("unknown checkout locks duplicates, survives remount, retries exact key/body, and starts fresh only after confirmation", async ({ page }) => {
  await open(page); await operatingContext(page); await milk(page).click();
  const sent: { key: string; body: string }[] = [];
  let fail = true;
  await page.route("**/pos/checkouts", async (route) => {
    sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData()! });
    expect(route.request().headers()["x-csrf-token"]).toBe("r1-local-test-token");
    if (fail) return route.abort("internetdisconnected");
    return route.fallback();
  });
  await checkout(page).click();
  await expect(page.getByText(enPos["pos.unknownTitle"], { exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  await expect(checkout(page)).toBeDisabled();
  await expect(page.getByTestId("pos-cart-line").locator("input").first()).toBeDisabled();
  await page.getByRole("button", { name: "Toggle POS mount" }).click();
  await page.getByRole("button", { name: "Toggle POS mount" }).click();
  await expect(page.getByText(enPos["pos.unknownTitle"], { exact: true })).toBeVisible();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
  await page.getByLabel("Test company", { exact: true }).selectOption("2");
  await expect(page.getByText(enPos["pos.unknownTitle"], { exact: true })).toHaveCount(0);
  await page.getByLabel("Test company", { exact: true }).selectOption("1");
  fail = false;
  await page.getByRole("button", { name: enPos["pos.retrySameSale"] }).click();
  await expect(page.locator(".pos-experience-outcome.completed")).toBeVisible();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  const payload = JSON.parse(sent[0].body);
  expect(payload.lines[0].unitPrice).toBe("2.1000"); expect(payload.lines[0].quantity).toBe("1.000000");
  expect(payload).not.toHaveProperty("total");
  await expect(page.getByRole("link", { name: enPos["pos.openSalesList"] })).toHaveAttribute("href", "#sales");
  await expect(page.getByRole("link", { name: enPos["pos.openReceiptsList"] })).toHaveAttribute("href", "#receipts");
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
  await page.getByRole("button", { name: enPos["pos.newSale"], exact: true }).click();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(0);
});

test("zero price is explicit, missing profile stays blank and currency changes invalidate price", async ({ page }) => {
  await open(page);
  await page.locator(".pos-experience-product").filter({ hasText: "ITM-TEST-4" }).click();
  await expect(page.getByTestId("pos-cart-line").getByLabel("Unit price Explicit zero", { exact: true })).toHaveValue("0.0000");
  await page.locator(".pos-experience-product").filter({ hasText: "ITM-TEST-3" }).click();
  await expect(page.getByTestId("pos-cart-line").last().getByLabel("Unit price Missing profile", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("pos-cart-line").last().locator(".pos-experience-line-fields")).toBeVisible();
  await page.getByRole("combobox", { name: enPos["pos.currency"], exact: true }).selectOption("2");
  await expect(page.getByTestId("pos-cart-line").first().getByLabel("Unit price Explicit zero", { exact: true })).toHaveValue("");
  await expect(page.getByText(enPos["pos.profileCurrencyMismatch"], { exact: true })).toHaveCount(2);
});

test("display mode is isolated by user/company and permission denial sends no catalog reads", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: "Tiles", exact: true }).click();
  await page.getByLabel("Test company", { exact: true }).selectOption("2");
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Test company", { exact: true }).selectOption("1");
  await expect(page.getByRole("button", { name: "Tiles", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Test user", { exact: true }).selectOption("2");
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const role of ["viewer", "no-catalog", "no-sales-module"]) {
    const requests: string[] = [];
    await page.route("**/sales/catalog**", (route) => { requests.push(route.request().url()); return route.fallback(); });
    await page.getByLabel("Test role", { exact: true }).selectOption(role);
    await expect(page.getByText(enPos["pos.catalogPermission"], { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.unroute("**/sales/catalog**");
  }
});

test("bounded search cancels stale response; error retry does not clear basket", async ({ page }) => {
  await open(page); await milk(page).click();
  let oldRoute: Route | undefined;
  await page.route("**/sales/catalog?**", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    expect(new URL(route.request().url()).searchParams.get("pageSize")).toBe("24");
    if (search === "old") { oldRoute = route; return; }
    if (search === "error") return route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
    return route.fallback();
  });
  await page.getByLabel(enPos["pos.search"], { exact: true }).fill("old");
  await expect.poll(() => Boolean(oldRoute)).toBe(true);
  await page.getByLabel(enPos["pos.search"], { exact: true }).fill("rice");
  await expect(page.locator(".pos-experience-product")).toHaveCount(1);
  await oldRoute!.fulfill({ json: { data: [], meta: { page: 1, pageSize: 24, total: 0, totalPages: 0 } } }).catch(() => {});
  await expect(page.locator(".pos-experience-product")).toContainText("Test rice");
  await page.getByLabel(enPos["pos.search"], { exact: true }).fill("error");
  await expect(page.getByText(enPos["pos.catalogError"], { exact: true })).toBeVisible();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
});
