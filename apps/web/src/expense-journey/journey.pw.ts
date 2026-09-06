import { arEmployeeExpenses as labels } from "../i18n/locales/employee-expenses";
import { expect, test, type Page } from "@playwright/test";
const claim = (purpose: string) => ({ id: purpose, purpose, version: 1, status: "DRAFT", ownedByCurrentUser: true,
  employee: { nameAr: "Employee", employeeNumber: "1" }, currency: { code: "SAR", decimals: 2 }, totalAmount: "15", lines: [] });
const list = (purpose: string) => ({ data: [claim(purpose)], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } });
async function setup(page: Page) {
  await page.route("**/api/v1/employee-expense-cost-centers", route => route.fulfill({ json: { data: [{ id: "cc", code: "CC", nameAr: "Center" }] } }));
  await page.route("**/api/v1/employee-expense-claims?**", route => route.fulfill({ json: list("Current claim") }));
  await page.goto("/src/expense-journey/browser-fixture.html");
}
async function fill(page: Page) {
  await page.getByLabel(labels["employeeExpenses.purpose"]).fill("Client visit");
  await page.getByLabel(labels["employeeExpenses.merchant"]).fill("Merchant");
  await page.getByLabel(labels["employeeExpenses.lineDescription"]).fill("Travel costs");
  await page.getByRole("combobox", { name: labels["employeeExpenses.costCenter"], exact: true }).selectOption("cc");
  await page.getByLabel(labels["employeeExpenses.amount"], { exact: true }).fill("15");
}
test("native disabled controls, retained input, stable retry and correct filters", async ({ page }) => {
  await setup(page); await fill(page);
  await page.getByRole("combobox", { name: labels["employeeExpenses.statusFilter"], exact: true }).selectOption("READY_FOR_PAYMENT");
  const requests: { key: string | undefined; body: string | null }[] = [];
  let finish!: () => void;
  await page.route("**/api/v1/employee-expense-claims", async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill(requests.length === 1 ? { status: 503, json: {} } : { json: { claim: claim("Saved claim") } });
  });
  await page.getByRole("button", { name: labels["employeeExpenses.saveDraft"] }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toBeDisabled();
  await expect(page.getByLabel(labels["employeeExpenses.amount"], { exact: true })).toBeDisabled();
  finish(); await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toBeEnabled();
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toHaveValue("Client visit");
  await page.route("**/api/v1/employee-expense-claims?**", route => route.fulfill({ json: list("Saved claim") }));
  await page.getByRole("button", { name: labels["employeeExpenses.saveDraft"] }).click();
  await expect.poll(() => requests.length).toBe(2); finish();
  await expect(page.getByRole("combobox", { name: labels["employeeExpenses.scope"], exact: true })).toHaveValue("mine");
  await expect(page.getByRole("combobox", { name: labels["employeeExpenses.statusFilter"], exact: true })).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Saved claim" })).toBeVisible();
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toHaveValue("");
  expect(requests[0]).toEqual(requests[1]);
  await expect(page.getByText(labels["employeeExpenses.summary.page"])).toBeVisible();
});
test("company change discards old draft and ignores pending create completion", async ({ page }) => {
  await setup(page); await fill(page);
  let finish!: () => void;
  await page.route("**/api/v1/employee-expense-claims", async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { claim: claim("old company") } });
  });
  await page.getByRole("button", { name: labels["employeeExpenses.saveDraft"] }).click();
  await expect.poll(() => !!finish).toBe(true);
  await page.getByTestId("switch").click();
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toHaveValue("");
  await page.getByLabel(labels["employeeExpenses.purpose"]).fill("New company draft"); finish();
  await expect(page.getByTestId("notice")).toBeEmpty();
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toHaveValue("New company draft");
  await page.getByTestId("readonly").click();
  await expect(page.getByLabel(labels["employeeExpenses.purpose"])).toHaveCount(0);
  await expect(page.getByRole("button", { name: labels["employeeExpenses.submit"] })).toHaveCount(0);
});
test("late list and cost center failures after unmount stay silent", async ({ page }) => {
  let finishList!: () => void; let finishCenters!: () => void;
  await page.route("**/api/v1/employee-expense-claims?**", async route => {
    await new Promise<void>(resolve => { finishList = resolve; }); await route.fulfill({ status: 500, json: {} });
  });
  await page.route("**/api/v1/employee-expense-cost-centers", async route => {
    await new Promise<void>(resolve => { finishCenters = resolve; }); await route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/src/expense-journey/browser-fixture.html");
  await expect.poll(() => !!finishList && !!finishCenters).toBe(true);
  await page.getByTestId("unmount").click(); finishList(); finishCenters();
  await expect(page.getByTestId("notice")).toBeEmpty();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("latest filter wins when an older request fails later", async ({ page }) => {
  await setup(page);
  let finish!: () => void;
  await page.route("**/api/v1/employee-expense-claims?**", async route => {
    if (route.request().url().includes("status=DRAFT")) {
      await new Promise<void>(resolve => { finish = resolve; });
      await route.fulfill({ status: 500, json: {} });
    } else await route.fulfill({ json: list("Latest filter claim") });
  });
  const status = page.getByRole("combobox", { name: labels["employeeExpenses.statusFilter"], exact: true });
  await status.selectOption("DRAFT"); await expect.poll(() => !!finish).toBe(true);
  await status.selectOption("READY_FOR_PAYMENT");
  await expect(page.getByRole("heading", { name: "Latest filter claim" })).toBeVisible();
  const settled = page.waitForResponse(response => response.url().includes("status=DRAFT"));
  finish(); await settled;
  await expect(page.getByRole("heading", { name: "Latest filter claim" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
