import { expect, test, type Page } from "@playwright/test";

const account = {
  id: "account-1",
  accountTypeId: "asset-type",
  parentAccountId: null,
  code: "111000",
  nameAr: "حساب اختبار الصلاحيات",
  nameEn: "Permission fixture account",
  level: 1,
  allowsPosting: true,
  isControlAccount: false,
  isActive: true,
  sourceTemplateCode: null,
  sourceTemplateKey: null,
};

const costCenter = {
  id: "center-1",
  parentId: null,
  code: "CC-000001",
  nameAr: "مركز اختبار الصلاحيات",
  nameEn: "Permission fixture center",
  isActive: true,
};

async function installFixtures(page: Page) {
  let permissions: string[] = [];
  const reads: string[] = [];
  const writes: string[] = [];
  const relevantReads = new Set([
    "/api/v1/accounts",
    "/api/v1/account-types",
    "/api/v1/accounts/default-template",
    "/api/v1/cost-centers",
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

  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, modules: ["CORE_ACCOUNTING"], permissions } });
  });
  await page.route("**/api/v1/account-types", async (route) => {
    await route.fulfill({ json: { data: [{
      id: "asset-type",
      code: "ASSET",
      nameAr: "أصل",
      class: "ASSET",
      normalBalance: "DEBIT",
      statementSection: "BALANCE_SHEET",
    }] } });
  });
  await page.route("**/api/v1/accounts**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") return route.fulfill({ status: 204 });
    if (path === "/api/v1/accounts") return route.fulfill({ json: list([account]) });
    if (path === "/api/v1/accounts/default-template") {
      return route.fulfill({ json: {
        templateCode: "STANDARD_TRADING",
        version: 1,
        nameAr: "الدليل الافتراضي",
        total: 42,
        matched: 41,
        missing: 1,
        inactive: 0,
        conflicts: 0,
        canApply: true,
      } });
    }
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
  });
  await page.route("**/api/v1/cost-centers**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 204 });
    await route.fulfill({ json: list([costCenter]) });
  });

  return {
    use(next: string[]) {
      permissions = next;
      reads.length = 0;
      writes.length = 0;
    },
    reads,
    writes,
  };
}

function list(data: unknown[]) {
  return { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } };
}

async function openAccounts(page: Page, sequence: number) {
  await page.goto(`/?permission-case=${sequence}#accounts`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
}

const expectedAccountReads = [
  "/api/v1/account-types",
  "/api/v1/accounts",
  "/api/v1/accounts/default-template",
];

function sorted(values: string[]) {
  return [...new Set(values)].sort();
}

test("account reads and actions follow exact permissions without forbidden requests", async ({ page }) => {
  const fixture = await installFixtures(page);
  let sequence = 0;

  fixture.use([]);
  await page.goto(`/?permission-case=${++sequence}#accounts`);
  await expect(page.getByRole("button", { name: "Chart of accounts", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Chart of accounts", exact: true })).toHaveCount(0);
  expect(fixture.reads).toEqual([]);
  expect(fixture.writes).toEqual([]);

  fixture.use(["accounts.view"]);
  await openAccounts(page, ++sequence);
  await expect(page.locator(".section-tabs").getByRole("button", { name: "Chart of accounts", exact: true })).toBeVisible();
  await expect(page.locator(".section-tabs").getByRole("button", { name: "Cost centers", exact: true })).toHaveCount(0);
  await expect(page.getByText("Permission fixture account", { exact: true })).toBeVisible();
  for (const action of ["New account", "Complete default chart", "Edit", "Disable", "Delete"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  expect(sorted(fixture.reads)).toEqual(expectedAccountReads);
  expect(fixture.writes).toEqual([]);

  fixture.use(["accounts.view", "accounts.create"]);
  await openAccounts(page, ++sequence);
  await expect(page.getByRole("button", { name: "New account", exact: true })).toBeVisible();
  for (const action of ["Complete default chart", "Edit", "Disable", "Delete"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "New account", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(sorted(fixture.reads)).toEqual(expectedAccountReads);
  expect(fixture.writes).toEqual([]);

  fixture.use(["accounts.view", "accounts.update"]);
  await openAccounts(page, ++sequence);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  for (const action of ["New account", "Complete default chart", "Disable", "Delete"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(sorted(fixture.reads)).toEqual(expectedAccountReads);
  expect(fixture.writes).toEqual([]);

  for (const [permission, label] of [
    ["accounts.deactivate", "Disable"],
    ["accounts.delete", "Delete"],
    ["accounts.template.apply", "Complete default chart"],
  ] as const) {
    fixture.use(["accounts.view", permission]);
    await openAccounts(page, ++sequence);
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    for (const other of ["New account", "Complete default chart", "Edit", "Disable", "Delete"].filter((name) => name !== label)) {
      await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
    }
    expect(sorted(fixture.reads)).toEqual(expectedAccountReads);
    expect(fixture.writes).toEqual([]);
  }
});

test("cost center management is independently navigable and combines cleanly with account view", async ({ page }) => {
  const fixture = await installFixtures(page);
  let sequence = 20;

  fixture.use(["cost_centers.manage"]);
  await openAccounts(page, ++sequence);
  await expect(page.locator(".section-tabs").getByRole("button", { name: "Chart of accounts", exact: true })).toHaveCount(0);
  await expect(page.locator(".section-tabs").getByRole("button", { name: "Cost centers", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Permission fixture center", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New cost center", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete default chart", exact: true })).toHaveCount(0);
  expect(sorted(fixture.reads)).toEqual(["/api/v1/cost-centers"]);
  expect(fixture.writes).toEqual([]);
  await page.getByRole("button", { name: "New cost center", exact: true }).click();
  await expect(page.locator(".document-form")).toBeVisible();
  await page.keyboard.press("Escape");

  fixture.use(["accounts.view", "cost_centers.manage"]);
  await openAccounts(page, ++sequence);
  const tabs = page.locator(".section-tabs");
  await expect(tabs.getByRole("button", { name: "Chart of accounts", exact: true })).toBeVisible();
  await expect(tabs.getByRole("button", { name: "Cost centers", exact: true })).toBeVisible();
  await expect(page.getByText("Permission fixture account", { exact: true })).toBeVisible();
  for (const action of ["New account", "Complete default chart", "Edit", "Disable", "Delete"] as const) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  expect(sorted(fixture.reads)).toEqual(sorted([...expectedAccountReads, "/api/v1/cost-centers"]));
  expect(fixture.writes).toEqual([]);

  await tabs.getByRole("button", { name: "Cost centers", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Permission fixture center", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New cost center", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});
