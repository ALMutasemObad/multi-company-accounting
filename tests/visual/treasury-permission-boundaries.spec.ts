import { expect, test, type Page } from "@playwright/test";

const rawLedgerId = "ledger-internal-raw-secret";

const cashAccount = {
  id: "cash-account-1",
  ledgerAccountId: rawLedgerId,
  code: "CB-000001",
  nameAr: "حساب خزينة تجريبي",
  nameEn: "Permission fixture treasury account",
  accountType: "CASH",
  bankName: null,
  accountNumberMasked: null,
  ibanMasked: null,
  isActive: true,
  version: 1,
};

const paymentMethod = {
  id: "payment-method-1",
  code: "PM-000001",
  nameAr: "طريقة دفع تجريبية",
  nameEn: "Permission fixture payment method",
  requiresReference: false,
  isActive: true,
  scope: "COMPANY",
  version: 1,
};

async function installFixtures(page: Page) {
  let permissions: string[] = [];
  const reads: string[] = [];
  const writes: string[] = [];
  const dialogs: string[] = [];
  const relevantReads = new Set([
    "/api/v1/cash-bank-accounts",
    "/api/v1/payment-methods",
    "/api/v1/accounts",
  ]);

  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "en"));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["GET", "HEAD"].includes(request.method())) {
      if (relevantReads.has(path)) reads.push(path);
    } else {
      writes.push(`${request.method()} ${path}`);
    }
  });
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });

  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, modules: ["TREASURY"], permissions } });
  });
  await page.route("**/api/v1/cash-bank-accounts**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 204 });
    await route.fulfill({ json: list([cashAccount]) });
  });
  await page.route("**/api/v1/payment-methods**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 204 });
    await route.fulfill({ json: { data: [paymentMethod] } });
  });
  await page.route("**/api/v1/accounts**", async (route) => {
    await route.fulfill({ json: list([]) });
  });

  return {
    use(next: string[]) {
      permissions = next;
      reads.length = 0;
      writes.length = 0;
      dialogs.length = 0;
    },
    reads,
    writes,
    dialogs,
  };
}

function list(data: unknown[]) {
  return { data, meta: { page: 1, pageSize: 10, total: data.length, totalPages: 1 } };
}

async function openTreasury(page: Page, sequence: number) {
  await page.goto(`/?permission-case=${sequence}#treasury`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

test("treasury view-only stays readable without actions, writes, or raw ledger ids", async ({ page }) => {
  const fixture = await installFixtures(page);
  fixture.use(["cash_bank_accounts.view"]);
  await openTreasury(page, 1);

  await expect(page.getByText("Permission fixture treasury account", { exact: true })).toBeVisible();
  const cashRow = page.locator(".data-table tbody tr").filter({ hasText: "CB-000001" });
  await expect(cashRow.locator("td").nth(2)).toHaveText("—");
  await expect(page.getByText(rawLedgerId, { exact: true })).toHaveCount(0);
  for (const action of ["New treasury account", "Edit", "Disable"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }

  await page.getByRole("tab", { name: "Payment methods", exact: true }).click();
  await expect(page.getByText("Permission fixture payment method", { exact: true })).toBeVisible();
  for (const action of ["New payment method", "Edit", "Disable"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.locator(".document-form")).toHaveCount(0);
  expect(uniqueSorted(fixture.reads)).toEqual([
    "/api/v1/cash-bank-accounts",
    "/api/v1/payment-methods",
  ]);
  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});

test("treasury manage reveals existing account and payment-method actions without cross-permission writes", async ({ page }) => {
  const fixture = await installFixtures(page);
  fixture.use(["cash_bank_accounts.view", "cash_bank_accounts.manage"]);
  await openTreasury(page, 2);

  await expect(page.getByRole("button", { name: "New treasury account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New treasury account", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Payment methods", exact: true }).click();
  await expect(page.getByRole("button", { name: "New payment method", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New payment method", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  expect(uniqueSorted(fixture.reads)).toEqual([
    "/api/v1/cash-bank-accounts",
    "/api/v1/payment-methods",
  ]);
  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});
