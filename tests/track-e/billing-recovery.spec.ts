import { expect, test, type Page } from "@playwright/test";
import type { ElectronicPayment, SubscriptionBillingInvoice } from "../../apps/web/src/electronic-payments";
import { arBillingRecovery, enBillingRecovery, urBillingRecovery, hiBillingRecovery } from "../../apps/web/src/i18n/locales/billing-recovery";

const invoice: SubscriptionBillingInvoice = { id: "4b5ec818-6f77-44f8-973f-fdf2df39ac47", invoiceNumber: "SUB-TEST-1", status: "ISSUED", issueDate: "2026-08-29T09:00:00.000Z", dueDate: "2026-09-05T09:00:00.000Z", currencyCode: "SAR", totalAmount: "100.0000", paidAmount: "0.0000", refundedAmount: "0.0000", balance: "100.0000", version: 1, latestPaymentState: "CHECKOUT" };
const payment: ElectronicPayment = { id: "73fa19cc-474f-4a07-92a3-0376b406968a", companyId: "1", invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, state: "CHECKOUT", provider: "DEVELOPMENT_SIMULATOR", environment: "DEVELOPMENT", currencyCode: "SAR", amount: "100.0000", amountMinor: "10000", checkoutUrl: null, version: 1, lastFailureCode: null, createdAt: "2026-08-29T09:01:00.000Z", updatedAt: "2026-08-29T09:01:00.000Z" };
const provider = { available: true, provider: "DEVELOPMENT_SIMULATOR", environment: "DEVELOPMENT", developmentOnly: true };
const list = (items: unknown[]) => ({ provider, items, meta: { page: 1, pageSize: 10, total: items.length, totalPages: 1 } });
async function setup(page: Page, locale = "en") {
  await page.addInitScript((locale) => localStorage.setItem("mcap.locale", locale), locale);
  await page.route("**/api/v1/subscription/billing/invoices?*", (route) => route.fulfill({ json: list([invoice]) }));
  await page.route("**/api/v1/subscription/billing/payments?*", (route) => route.fulfill({ json: list([payment]) }));
}
const panel = (page: Page) => page.locator(".subscription-billing-center");

test("lost response retains the attempt across reload; recovery reads never replay writes", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/invoices/*/checkout", (route) => { writes++; return route.fulfill({ status: 201, contentType: "application/json", body: "{" }); });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Pay now", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("does not mean");
  await page.reload();
  await expect(panel(page).getByRole("alert")).toContainText("does not mean");
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("does not mean");
  expect(writes).toBe(1);
});

test("confirmed command survives a failing list reload and recovery is GET only", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/payments/*/cancel", async (route) => {
    writes++;
    await page.route("**/api/v1/subscription/billing/invoices?*", (read) => read.fulfill({ status: 500, json: { code: "INTERNAL_ERROR" } }));
    await route.fulfill({ json: { payment: { ...payment, state: "CANCELLED", version: 2 } } });
  });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Cancel attempt", exact: true }).click();
  await expect(panel(page).locator(".billing-recovery-notice")).toContainText("confirmed");
  await expect(panel(page).getByRole("alert")).toContainText("list");
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  expect(writes).toBe(1);
});

test("double click and concurrent checkout/cancel cannot start two writes", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/**", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    writes++;
    await new Promise<void>((resolve) => page.once("close", () => resolve()));
    await route.abort().catch(() => undefined);
  });
  await page.goto("/tests/track-e/");
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeVisible();
  await panel(page).evaluate((root) => {
    const buttons = [...root.querySelectorAll("button")];
    buttons.find((button) => button.textContent === "Pay now")!.click();
    buttons.find((button) => button.textContent === "Pay now")!.click();
    buttons.find((button) => button.textContent === "Cancel attempt")!.click();
  });
  await expect.poll(() => writes).toBe(1);
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeDisabled();
});

const dictionaries = { ar: arBillingRecovery, en: enBillingRecovery, ur: urBillingRecovery, hi: hiBillingRecovery };
for (const locale of ["ar", "en", "ur", "hi"] as const) {
  test(`uncertain billing recovery is translated and usable with keyboard and touch in ${locale}`, async ({ page }, testInfo) => {
    await setup(page, locale);
    let writes = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/subscription/billing/invoices/*/checkout", (route) => { writes++; return route.abort("failed"); });
    await page.goto("/tests/track-e/");
    await panel(page).locator(".data-table button").click();
    await expect(panel(page).getByRole("alert")).toContainText(dictionaries[locale]["billingRecovery.unknown"]);
    await expect(panel(page)).not.toContainText("billingRecovery.");
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
    const read = panel(page).getByRole("button", { name: dictionaries[locale]["billingRecovery.readCurrent"] });
    await read.focus();
    await expect(read).toBeFocused();
    await read.press("Enter");
    await expect(panel(page).locator(".data-table button")).toBeDisabled();
    const bounds = await read.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(writes).toBe(1);
    expect(errors).toEqual([]);
    if (process.env.TRACK_E_SCREENSHOTS === "1") {
      await page.evaluate(() => document.fonts.ready);
      await panel(page).screenshot({ path: testInfo.outputPath(`billing-recovery-${locale}.png`) });
    }
  });
}

for (const command of ["checkout", "retry"] as const) {
  test(`${command} success uses the saved key and version and may open the current checkout`, async ({ page }) => {
    await setup(page);
    if (command === "retry") await page.route("**/api/v1/subscription/billing/payments?*", (route) => route.fulfill({ json: list([{ ...payment, state: "FAILED" }]) }));
    const writes: { key: string; body: string | null; csrf: string }[] = [];
    await page.route(`**/api/v1/subscription/billing/${command === "checkout" ? "invoices" : "payments"}/*/${command}`, (route) => {
      const request = route.request();
      writes.push({ key: request.headers()["idempotency-key"]!, body: request.postData(), csrf: request.headers()["x-csrf-token"]! });
      return route.fulfill({ status: 201, json: { payment: { ...payment, checkoutUrl: "/tests/track-e/#checkout-open" } } });
    });
    await page.goto("/tests/track-e/");
    await panel(page).getByRole("button", { name: command === "checkout" ? "Pay now" : "Retry", exact: true }).click();
    await expect(page).toHaveURL(/#checkout-open$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key.length).toBeLessThanOrEqual(100);
    expect(writes[0]!.body).toBe(command === "checkout" ? '{"invoiceVersion":1}' : '{"version":1}');
    expect(writes[0]!.csrf).toBe("test-csrf-only");
  });
}

for (const leave of ["unmount", "activity", "route", "permission"] as const) {
  test(`late checkout cannot navigate after ${leave}; an uncertain attempt is retained`, async ({ page }) => {
    await setup(page);
    let finish: (() => void) | undefined;
    let writes = 0;
    await page.route("**/api/v1/subscription/billing/invoices/*/checkout", async (route) => {
      writes++;
      await new Promise<void>((resolve) => { finish = resolve; });
      await route.fulfill({ status: 201, json: { payment: { ...payment, checkoutUrl: "/tests/track-e/#must-not-open" } } }).catch(() => undefined);
    });
    await page.goto("/tests/track-e/");
    await panel(page).getByRole("button", { name: "Pay now", exact: true }).click();
    await expect.poll(() => Boolean(finish)).toBe(true);
    if (leave === "unmount") await page.getByRole("button", { name: "Toggle billing" }).click();
    if (leave === "permission") {
      await page.getByRole("button", { name: "Toggle manage permission" }).click();
      await expect(panel(page).getByRole("button", { name: "Pay now", exact: true })).toHaveCount(0);
    }
    if (leave === "activity") {
      await page.route("**/api/v1/subscription/billing/payments?*", (route) => route.fulfill({ json: list([{ ...payment, companyId: "2", invoiceNumber: "ACTIVITY-2" }]) }));
      await page.getByRole("button", { name: "Switch activity" }).click();
      await expect(panel(page)).toContainText("ACTIVITY-2");
    }
    if (leave === "route") {
      await page.evaluate(() => { location.hash = "other"; });
      await expect(panel(page).getByRole("alert")).toContainText("does not mean");
    }
    finish!();
    await expect(page.locator("output")).toBeEmpty();
    expect(new URL(page.url()).hash).not.toBe("#must-not-open");
    const record = await page.evaluate(() => JSON.parse(sessionStorage.getItem("mcap.billing-recovery.v1.7:1")!));
    expect(record.outcome).toBe("unknown");
    expect(record.body).toBe('{"invoiceVersion":1}');
    expect(writes).toBe(1);
  });
}

test("409 retains the original body/key even when the next page omits the payment and changes the invoice version", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/payments/*/cancel", (route) => { writes++; return route.fulfill({ status: 409, json: { code: "CONFLICT", reason: "VERSION_CONFLICT" } }); });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Cancel attempt", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("conflict");
  const before = await page.evaluate(() => sessionStorage.getItem("mcap.billing-recovery.v1.7:1"));
  await page.route("**/api/v1/subscription/billing/invoices?*", (route) => route.fulfill({ json: list([{ ...invoice, version: 99 }]) }));
  await page.route("**/api/v1/subscription/billing/payments?*", (route) => route.fulfill({ json: list([]) }));
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  await expect(panel(page).getByRole("button", { name: "Pay now", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => sessionStorage.getItem("mcap.billing-recovery.v1.7:1"))).toBe(before);
  expect(writes).toBe(1);
});

test("429 waits for a successful state read and explicit review before allowing a new command", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/invoices/*/checkout", (route) => { writes++; return route.fulfill({ status: 429, json: { code: "TOO_MANY_REQUESTS", reason: "private server data" } }); });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Pay now", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("too many requests");
  await expect(panel(page)).not.toContainText("private server data");
  await expect(panel(page).getByRole("button", { name: "I reviewed the state after rejection" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  await panel(page).getByRole("button", { name: "I reviewed the state after rejection" }).click();
  await expect(panel(page).getByRole("button", { name: "Pay now", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});

test("storage failure stops the command before sending and still allows safe reads", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("mcap.billing-recovery.")) throw new Error("disabled"); original.call(this, key, value); };
  });
  let writes = 0;
  page.on("request", (request) => { if (request.method() === "POST") writes++; });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Pay now", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("could not be safely saved");
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  await expect(panel(page).getByRole("button", { name: "Pay now", exact: true })).toBeDisabled();
  expect(writes).toBe(0);
});

test("confirmed success stays clear if saving its acknowledgement fails; the retained attempt remains locked", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("mcap.billing-recovery.") && JSON.parse(value).outcome === "confirmed") throw new Error("quota");
      original.call(this, key, value);
    };
  });
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/payments/*/cancel", (route) => { writes++; return route.fulfill({ json: { payment: { ...payment, state: "CANCELLED", version: 2 } } }); });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Cancel attempt", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("confirmed");
  await expect(panel(page).getByRole("alert")).toContainText("could not be safely saved");
  await expect(panel(page).getByRole("alert")).not.toContainText("result is uncertain");
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
});

test("stopping the write wait keeps its unknown identity and disables fresh commands", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/payments/*/cancel", async (route) => {
    writes++;
    await new Promise<void>((resolve) => page.once("close", () => resolve()));
    await route.abort().catch(() => undefined);
  });
  await page.goto("/tests/track-e/");
  await panel(page).getByRole("button", { name: "Cancel attempt", exact: true }).click();
  await expect(panel(page)).toContainText("does not cancel the server command");
  await panel(page).getByRole("button", { name: "Stop waiting for response" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("does not mean");
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
});

test("late list from a previous activity cannot replace current activity data", async ({ page }) => {
  await setup(page);
  await page.goto("/tests/track-e/");
  await expect(panel(page)).toContainText("SUB-TEST-1");
  let finish: (() => void) | undefined;
  let currentCompany = "1";
  await page.route("**/api/v1/subscription/billing/payments?*", async (route) => {
    const company = currentCompany;
    if (company === "1") await new Promise<void>((resolve) => { finish = resolve; });
    await route.fulfill({ json: list([{ ...payment, companyId: company, invoiceNumber: `ACTIVITY-${company}` }]) }).catch(() => undefined);
  });
  await panel(page).getByRole("button", { name: "Read current billing state" }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  currentCompany = "2";
  await page.getByRole("button", { name: "Switch activity" }).click();
  await expect(panel(page)).toContainText("ACTIVITY-2");
  finish!();
  await expect(panel(page)).not.toContainText("ACTIVITY-1");
  await expect(panel(page)).toContainText("ACTIVITY-2");
});

test("slow list read times out without retries and never displays an empty list as a confirmed result", async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/v1/subscription/billing/invoices?*", async (route) => {
    reads++;
    await new Promise<void>((resolve) => page.once("close", () => resolve()));
    await route.abort().catch(() => undefined);
  });
  await page.clock.install();
  await page.goto("/tests/track-e/");
  await expect(panel(page).getByRole("button", { name: "Stop waiting for lists" })).toBeVisible();
  await page.clock.fastForward(12_100);
  await expect(panel(page).getByRole("alert")).toContainText("longer than expected");
  await expect(panel(page).locator(".empty-state")).toHaveCount(0);
  const timedOut = reads;
  await page.clock.fastForward(60_000);
  expect(reads).toBe(timedOut);
  expect(reads).toBeLessThanOrEqual(2); // StrictMode mount/cleanup; not an automatic retry.
});
