import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type EmptyStateCase = {
  route: "suppliers" | "receipts" | "payments";
  viewPermission: string;
  actionPermission: string;
  headerAction: string;
  emptyAction: string;
  createDescription: string;
};

const cases: EmptyStateCase[] = [
  {
    route: "suppliers",
    viewPermission: "suppliers.view",
    actionPermission: "suppliers.manage",
    headerAction: "New supplier",
    emptyAction: "Add supplier",
    createDescription: "Add the first supplier to begin recording payment vouchers.",
  },
  {
    route: "receipts",
    viewPermission: "receipts.view",
    actionPermission: "receipts.create",
    headerAction: "New receipt voucher",
    emptyAction: "Create voucher",
    createDescription: "Create a voucher to record a customer collection or direct receipt to an account.",
  },
  {
    route: "payments",
    viewPermission: "payments.view",
    actionPermission: "payments.create",
    headerAction: "New payment voucher",
    emptyAction: "Create voucher",
    createDescription: "Create a new voucher to record a payment to a supplier or a direct disbursement to an account.",
  },
];

async function configure(context: BrowserContext) {
  let activePermissions: string[] = [];
  const writes: string[] = [];

  await context.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  context.on("request", (request) => {
    if (!new Set(["GET", "HEAD"]).has(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await context.route("**/api/v1/auth/me", (route) => route.fulfill({
    json: {
      user: { id: "permission-empty-state-user", displayName: "Permission test user" },
      selectedCompany: { id: "permission-empty-state-company", name: "Permission test company", timezone: "Asia/Riyadh" },
      modules: ["PURCHASES", "TREASURY"],
      permissions: activePermissions,
    },
  }));
  for (const endpoint of ["suppliers", "receipts", "payments"]) {
    await context.route(`**/api/v1/${endpoint}?*`, (route) => route.fulfill({
      json: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } },
    }));
  }

  return {
    writes,
    setPermissions(permissions: string[]) {
      activePermissions = permissions;
    },
  };
}

async function openCase(context: BrowserContext, emptyStateCase: EmptyStateCase): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/#${emptyStateCase.route}`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".empty-state")).toBeVisible();
  return page;
}

test("view-only users see neutral empty states and no create actions", async ({ page }) => {
  const context = page.context();
  const fixture = await configure(context);

  for (const emptyStateCase of cases) {
    fixture.setPermissions([emptyStateCase.viewPermission]);
    const scenarioPage = await openCase(context, emptyStateCase);
    const emptyState = scenarioPage.locator(".empty-state");

    await expect(emptyState.locator("p")).toHaveText("No matching results.");
    await expect(emptyState).not.toContainText(emptyStateCase.createDescription);
    await expect(scenarioPage.getByRole("button", { name: emptyStateCase.headerAction, exact: true })).toHaveCount(0);
    await expect(emptyState.getByRole("button", { name: emptyStateCase.emptyAction, exact: true })).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
    await scenarioPage.close();
  }

  expect(fixture.writes).toEqual([]);
});

test("the exact manage or create permission restores the existing guidance and actions", async ({ page }) => {
  const context = page.context();
  const fixture = await configure(context);

  for (const emptyStateCase of cases) {
    fixture.setPermissions([emptyStateCase.viewPermission, emptyStateCase.actionPermission]);
    const scenarioPage = await openCase(context, emptyStateCase);
    const emptyState = scenarioPage.locator(".empty-state");

    await expect(emptyState.locator("p")).toHaveText(emptyStateCase.createDescription);
    await expect(scenarioPage.getByRole("button", { name: emptyStateCase.headerAction, exact: true })).toBeVisible();
    await expect(emptyState.getByRole("button", { name: emptyStateCase.emptyAction, exact: true })).toBeVisible();
    expect(fixture.writes).toEqual([]);
    await scenarioPage.close();
  }

  expect(fixture.writes).toEqual([]);
});
