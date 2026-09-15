import { expect, test, type Page } from "@playwright/test";

async function chooseContextValue(page: Page, label: string) {
  const dialog = page.getByRole("dialog", { name: "Prepare sale session" });
  await dialog.getByRole("button", { name: `Change ${label}` }).click();
  const picker = dialog.getByRole("combobox", { name: label });
  await picker.click();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await dialog.getByRole("listbox", { name: label }).getByRole("option").first().click();
}

async function expectDialogInsideViewport(page: Page) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const rect = dialog.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const offenders = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
          && (bounds.left < -1 || bounds.right > viewportWidth + 1);
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName);
    return {
      dialogFits: rect.left >= -1 && rect.right <= viewportWidth + 1 && rect.top >= -1 && rect.bottom <= viewportHeight + 1,
      documentFitsHorizontally: document.documentElement.scrollWidth <= viewportWidth + 1,
      offenders,
    };
  });
  expect(geometry).toEqual({ dialogFits: true, documentFitsHorizontally: true, offenders: [] });
}

test("POS session wizard navigates, blocks incomplete activation, and reviews without checkout", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/")) writes.push(new URL(request.url()).pathname);
  });
  await page.addInitScript(() => {
    localStorage.setItem("mcap.locale", "en");
    sessionStorage.setItem("mcap.csrf", "visual-qa-csrf");
  });
  await page.goto("/?qa=pos#pos");
  const dialog = page.getByRole("dialog", { name: "Prepare sale session" });
  await expect(dialog).toBeVisible();
  await expectDialogInsideViewport(page);

  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Sale & payment details" })).toBeFocused();
  await expectDialogInsideViewport(page);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Readiness review" })).toBeFocused();
  await expectDialogInsideViewport(page);
  await expect(dialog.getByRole("checkbox", { name: "Remember these settings for the next sale" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Enable selling session" })).toBeDisabled();
  const writesBeforeIncompleteAttempt = writes.length;
  await dialog.getByRole("button", { name: "Enable selling session" }).click({ force: true });
  expect(writes.slice(writesBeforeIncompleteAttempt)).not.toContain("/api/v1/pos/checkouts");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: /^1 Sale context$/ }).click();
  await chooseContextValue(page, "Warehouse");
  await chooseContextValue(page, "Cash account");
  await chooseContextValue(page, "Payment method");
  await chooseContextValue(page, "Currency");
  await dialog.getByRole("button", { name: /^2 Sale & payment details$/ }).click();
  await dialog.getByLabel("Description").fill("Walk-in sale");
  const customer = dialog.getByRole("combobox", { name: "Customer" });
  await customer.click();
  await dialog.getByRole("listbox", { name: "Customer" }).getByRole("option").first().click();
  await dialog.getByLabel("Exchange rate").fill("1");
  await dialog.getByRole("button", { name: /^3 Readiness review$/ }).click();
  const activate = dialog.getByRole("button", { name: "Enable selling session" });
  await expect(activate).toBeEnabled();
  const writesBeforeReview = writes.length;
  await activate.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Sale session summary")).toContainText("Session is ready to sell");
  // CashierContext is the source of the four references until review; applyReviewed
  // copies those validated IDs into PosSaleContext synchronously after review.
  expect(writes.slice(writesBeforeReview)).not.toContain("/api/v1/pos/checkouts");
});
