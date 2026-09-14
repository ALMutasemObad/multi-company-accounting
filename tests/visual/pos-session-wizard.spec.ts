import { expect, test, type Page } from "@playwright/test";

async function chooseContextValue(page: Page, label: string) {
  const dialog = page.getByRole("dialog", { name: "Prepare sale session" });
  await dialog.getByRole("button", { name: `Change ${label}` }).click();
  const picker = dialog.getByRole("combobox", { name: label });
  await picker.click();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await dialog.getByRole("listbox", { name: label }).getByRole("option").first().click();
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

  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Sale & payment details" })).toBeFocused();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Readiness review" })).toBeFocused();
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
