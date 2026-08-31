import { expect, test, type Page } from "@playwright/test";
import type { ElectronicPayment, SubscriptionBillingInvoice } from "../../apps/web/src/electronic-payments";

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

test("concurrent checkout and cancel cannot start two writes", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route("**/api/v1/subscription/billing/**", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    writes++;
    await new Promise<void>((resolve) => page.once("close", resolve));
    await route.abort().catch(() => undefined);
  });
  await page.goto("/tests/track-e/");
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeVisible();
  await panel(page).evaluate((root) => {
    const buttons = [...root.querySelectorAll("button")];
    buttons.find((button) => button.textContent === "Pay now")!.click();
    buttons.find((button) => button.textContent === "Cancel attempt")!.click();
  });
  await expect.poll(() => writes).toBe(1);
  await expect(panel(page).getByRole("button", { name: "Cancel attempt", exact: true })).toBeDisabled();
});
