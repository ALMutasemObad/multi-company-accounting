import { expect, test, type Page } from "@playwright/test";

const viewPermissions = [
  "warehouses.view",
  "inventory_catalog.view",
  "inventory_movements.view",
];

const movementDetail = {
  id: "movement-qa",
  movementNumber: "IMV-00000001",
  movementType: "RECEIPT",
  movementDate: "2026-08-24",
  description: "Permission fixture movement",
  externalReference: "PO-QA-1",
  status: "POSTED",
  version: 3,
  source: null,
  accounting: null,
  reversalOf: null,
  reversedBy: null,
  createdByName: "Permission fixture user",
  createdAt: "2026-08-24T12:00:00.000Z",
  lineCount: 1,
  lines: [{
    id: "movement-line-qa",
    lineNumber: 1,
    inventoryItemId: "item-qa",
    inventoryItemCode: "ITM-000001",
    inventoryItemName: "Sample item",
    unitOfMeasureCode: "EA",
    fromWarehouseId: null,
    fromWarehouseCode: null,
    fromWarehouseName: null,
    toWarehouseId: "warehouse-qa",
    toWarehouseCode: "WH-000001",
    toWarehouseName: "Main warehouse",
    quantity: "125.000000",
    unitCostBase: "10.00000000",
    totalCostBase: "1250.0000",
    isCostInitialized: true,
  }],
};

async function installPermissionFixture(page: Page) {
  let permissions = [...viewPermissions];
  const writes: string[] = [];
  const dialogs: string[] = [];

  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "en"));
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({
      response,
      json: { ...authorization, modules: ["INVENTORY"], permissions },
    });
  });
  await page.route("**/api/v1/inventory-movements/movement-qa", async (route) => {
    await route.fulfill({ json: movementDetail });
  });

  return {
    use(next: string[]) {
      permissions = next;
      writes.length = 0;
      dialogs.length = 0;
    },
    writes,
    dialogs,
  };
}

async function openSection(page: Page, section: "warehouses" | "units" | "items" | "balances" | "movements", sequence: number) {
  await page.goto(`/?qa=inventory&permission-case=${sequence}#inventory?section=${section}`);
  const workspace = page.locator(".workspace-page");
  await expect(workspace).toBeVisible();
  await expect(workspace.locator(".loading")).toHaveCount(0);
  await expect(workspace.getByRole("tab", { name: {
    warehouses: "Warehouses",
    units: "Units of measure",
    items: "Item catalog",
    balances: "Current balances",
    movements: "Stock movements",
  }[section], exact: true })).toHaveAttribute("aria-selected", "true");
  return workspace;
}

async function closeDialog(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("inventory view-only users can browse without actions, forms, prompts, or writes", async ({ page }) => {
  const fixture = await installPermissionFixture(page);
  fixture.use([...viewPermissions]);

  let workspace = await openSection(page, "warehouses", 1);
  await expect(workspace.locator(".data-table tbody tr").filter({ hasText: "WH-000001" })).toBeVisible();
  for (const action of ["Create warehouse", "Edit", "Disable"] as const) {
    await expect(workspace.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }

  workspace = await openSection(page, "units", 2);
  await expect(workspace.locator(".data-table tbody tr").filter({ hasText: "EA" })).toBeVisible();
  for (const action of ["Create unit of measure", "Edit", "Disable"] as const) {
    await expect(workspace.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }

  workspace = await openSection(page, "items", 3);
  await expect(workspace.locator(".data-table tbody tr").filter({ hasText: "ITM-000001" })).toBeVisible();
  for (const action of ["Create item", "Edit", "Disable"] as const) {
    await expect(workspace.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }

  workspace = await openSection(page, "balances", 4);
  await expect(workspace.locator(".data-table tbody tr").filter({ hasText: "ITM-000001" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Initialize valuation", exact: true })).toHaveCount(0);

  workspace = await openSection(page, "movements", 5);
  await expect(workspace.getByText("IMV-00000001", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Create stock movement", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "View details", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reverse movement", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page.locator(".document-form")).toHaveCount(0);
  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});

test("warehouse management reveals only warehouse mutations", async ({ page }) => {
  const fixture = await installPermissionFixture(page);
  fixture.use([...viewPermissions, "warehouses.manage"]);

  let workspace = await openSection(page, "warehouses", 10);
  await expect(workspace.getByRole("button", { name: "Create warehouse", exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Disable", exact: true }).first()).toBeVisible();
  await workspace.getByRole("button", { name: "Create warehouse", exact: true }).click();
  await closeDialog(page);
  await workspace.getByRole("button", { name: "Edit", exact: true }).first().click();
  await closeDialog(page);

  workspace = await openSection(page, "units", 11);
  await expect(workspace.getByRole("button", { name: "Create unit of measure", exact: true })).toHaveCount(0);
  workspace = await openSection(page, "items", 12);
  await expect(workspace.getByRole("button", { name: "Create item", exact: true })).toHaveCount(0);
  workspace = await openSection(page, "balances", 13);
  await expect(workspace.getByRole("button", { name: "Initialize valuation", exact: true })).toHaveCount(0);
  workspace = await openSection(page, "movements", 14);
  await expect(workspace.getByRole("button", { name: "Create stock movement", exact: true })).toHaveCount(0);

  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});

test("catalog management reveals unit and item mutations without warehouse or movement access", async ({ page }) => {
  const fixture = await installPermissionFixture(page);
  fixture.use([...viewPermissions, "inventory_catalog.manage"]);

  let workspace = await openSection(page, "warehouses", 20);
  await expect(workspace.getByRole("button", { name: "Create warehouse", exact: true })).toHaveCount(0);

  workspace = await openSection(page, "units", 21);
  await expect(workspace.getByRole("button", { name: "Create unit of measure", exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Disable", exact: true }).first()).toBeVisible();
  await workspace.getByRole("button", { name: "Create unit of measure", exact: true }).click();
  await closeDialog(page);

  workspace = await openSection(page, "items", 22);
  await expect(workspace.getByRole("button", { name: "Create item", exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Disable", exact: true }).first()).toBeVisible();
  await workspace.getByRole("button", { name: "Create item", exact: true }).click();
  await closeDialog(page);

  workspace = await openSection(page, "balances", 23);
  await expect(workspace.getByRole("button", { name: "Initialize valuation", exact: true })).toHaveCount(0);
  workspace = await openSection(page, "movements", 24);
  await expect(workspace.getByRole("button", { name: "Create stock movement", exact: true })).toHaveCount(0);

  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});

test("movement creation, valuation initialization, and reversal stay independent", async ({ page }) => {
  const fixture = await installPermissionFixture(page);
  fixture.use([...viewPermissions, "inventory_movements.create"]);

  let workspace = await openSection(page, "balances", 30);
  await workspace.getByRole("button", { name: "Initialize valuation", exact: true }).click();
  await closeDialog(page);

  workspace = await openSection(page, "movements", 31);
  await workspace.getByRole("button", { name: "Create stock movement", exact: true }).click();
  await closeDialog(page);
  await workspace.getByRole("button", { name: "View details", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reverse movement", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  fixture.use([...viewPermissions, "inventory_movements.reverse"]);
  workspace = await openSection(page, "balances", 32);
  await expect(workspace.getByRole("button", { name: "Initialize valuation", exact: true })).toHaveCount(0);
  workspace = await openSection(page, "movements", 33);
  await expect(workspace.getByRole("button", { name: "Create stock movement", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "View details", exact: true }).click();
  await page.getByRole("button", { name: "Reverse movement", exact: true }).click();
  await closeDialog(page);

  expect(fixture.dialogs).toEqual([]);
  expect(fixture.writes).toEqual([]);
});
