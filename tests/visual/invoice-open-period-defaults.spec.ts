import { expect, test } from "@playwright/test";

const invoiceScreens = [
  { name: "sales", path: "/?qa=sales-invoice#sales" },
  { name: "purchase", path: "/?qa=purchase-invoice#purchases" },
] as const;

for (const screen of invoiceScreens) {
  test(`${screen.name} invoice keeps its open period, document date and due date coherent`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "en"));
    await page.clock.setFixedTime(new Date("2026-09-08T12:00:00.000Z"));
    await page.goto(screen.path);
    await expect(page.locator(".workspace-page")).toBeVisible();
    await expect(page.locator(".workspace-page .loading")).toHaveCount(0);

    const opener = page.locator(".page-actions .button.primary");
    await expect(opener).toBeEnabled();
    await opener.click();

    const dialog = page.getByRole("dialog");
    const fiscalPeriod = dialog.locator('select[name="fiscalPeriodId"]');
    const documentDate = dialog.locator('input[name="documentDate"]');
    const dueDate = dialog.locator('input[name="dueDate"]');
    await expect(dialog).toBeVisible();
    await expect(fiscalPeriod).toHaveValue("1001");
    await expect(documentDate).toHaveValue("2026-12-01");
    await expect(dueDate).toHaveValue("2026-12-01");

    await documentDate.fill("2026-12-15");
    await expect(dueDate).toHaveValue("2026-12-15");
    await dueDate.fill("2026-12-20");
    await documentDate.fill("2026-12-16");
    await expect(dueDate).toHaveValue("2026-12-20");
  });
}
