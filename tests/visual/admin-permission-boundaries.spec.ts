import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const user = {
  id: "user-1",
  email: "user@example.test",
  nameAr: "مستخدم الاختبار",
  nameEn: "Test User",
  status: "ACTIVE",
  lastLoginAt: "2026-09-08T08:00:00.000Z",
  createdAt: "2026-01-01T08:00:00.000Z",
  updatedAt: "2026-09-08T08:00:00.000Z",
  employee: null,
};
const role = {
  id: "role-1",
  code: "CUSTOM_ROLE",
  nameAr: "دور الاختبار",
  nameEn: "Test Role",
  isSystemRole: false,
  isActive: true,
  assignedUsers: 1,
  permissionIds: ["permission-1"],
  permissions: ["users.view"],
};
const permission = {
  id: "permission-1",
  code: "users.view",
  module: "users",
  descriptionAr: "عرض المستخدمين",
};
const employee = {
  id: "employee-1",
  employeeNumber: "EMP-0001",
  nameAr: "موظف الاختبار",
  nameEn: "Test Employee",
  status: "ACTIVE",
};
const session = {
  id: "session-1",
  createdAt: "2026-09-01T08:00:00.000Z",
  lastActivityAt: "2026-09-08T08:00:00.000Z",
  expiresAt: "2026-10-01T08:00:00.000Z",
  current: false,
  revoked: false,
};
const meta = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

async function configure(context: BrowserContext) {
  let activePermissions: string[] = [];
  const reads: string[] = [];
  const writes: string[] = [];

  await context.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/v1/")) return;
    const path = url.pathname.slice("/api/v1".length);
    if (!/^(\/users|\/roles|\/permissions|\/auth\/sessions)(\/|$)/u.test(path)) return;
    if (request.method() === "GET" || request.method() === "HEAD") reads.push(path);
    else writes.push(`${request.method()} ${path}`);
  });

  await context.route("**/api/v1/auth/me", (route) => route.fulfill({
    json: {
      user: { id: "permission-admin-user", displayName: "Permission test user" },
      selectedCompany: { id: "permission-admin-company", name: "Permission test company", timezone: "Asia/Riyadh" },
      modules: ["CORE_ACCOUNTING"],
      permissions: activePermissions,
    },
  }));
  await context.route("**/api/v1/users?*", (route) => route.fulfill({ json: { data: [user], meta } }));
  await context.route("**/api/v1/users/employee-options", (route) => route.fulfill({ json: { data: [employee] } }));
  await context.route("**/api/v1/users/user-1/roles", (route) => route.fulfill({ json: { data: [] } }));
  await context.route("**/api/v1/roles", (route) => route.fulfill({ json: { data: [role] } }));
  await context.route("**/api/v1/permissions", (route) => route.fulfill({ json: { data: [permission] } }));
  await context.route("**/api/v1/auth/sessions?*", (route) => route.fulfill({ json: { data: [session], meta } }));

  return {
    reads,
    writes,
    setPermissions(permissions: string[]) {
      activePermissions = permissions;
    },
  };
}

async function openAdmin(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#admin");
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users, roles and permissions" })).toBeVisible();
  const openNavigation = page.getByRole("button", { name: "Open navigation", exact: true });
  const mobileNavigation = await openNavigation.isVisible();
  if (mobileNavigation) await openNavigation.click();
  const navigationButton = page.getByRole("button", { name: "Users and permissions", exact: true });
  await expect(navigationButton).toBeVisible();
  if (mobileNavigation) await navigationButton.click();
  return page;
}

const pathsSince = (paths: string[], start: number) => new Set(paths.slice(start));
const expectOnlyReads = (paths: string[], start: number, expected: string[]) =>
  expect([...pathsSince(paths, start)].sort()).toEqual([...new Set(expected)].sort());

test("each administration view permission exposes only its tab and read endpoints", async ({ page }) => {
  const context = page.context();
  const fixture = await configure(context);
  const scenarios = [
    { permissions: ["users.view"], tab: "Users", reads: ["/users"], forbidden: ["/roles", "/permissions", "/users/employee-options", "/auth/sessions"] },
    { permissions: ["roles.view"], tab: "Roles and permissions", reads: ["/roles", "/permissions"], forbidden: ["/users", "/users/employee-options", "/auth/sessions"] },
    { permissions: ["auth.sessions.view"], tab: "My sessions", reads: ["/auth/sessions"], forbidden: ["/users", "/roles", "/permissions", "/users/employee-options"] },
  ];

  for (const scenario of scenarios) {
    const readStart = fixture.reads.length;
    fixture.setPermissions(scenario.permissions);
    const scenarioPage = await openAdmin(context);
    const tabs = scenarioPage.locator(".section-tabs");
    await expect(tabs.getByRole("button")).toHaveCount(1);
    await expect(tabs.getByRole("button", { name: scenario.tab, exact: true })).toBeVisible();
    await expect(scenarioPage.locator(".data-table-wrap, .empty-state")).toBeVisible();

    if (scenario.tab === "Users") {
      for (const action of ["New user", "Edit", "Link employee", "Roles", "Disable"]) {
        await expect(scenarioPage.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      }
    } else if (scenario.tab === "Roles and permissions") {
      for (const action of ["New role", "Edit", "Disable"]) {
        await expect(scenarioPage.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      }
    } else {
      await expect(scenarioPage.locator("tbody").getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    }

    const observed = pathsSince(fixture.reads, readStart);
    for (const expected of scenario.reads) expect(observed.has(expected)).toBe(true);
    for (const forbidden of scenario.forbidden) expect(observed.has(forbidden)).toBe(false);
    expect(fixture.writes).toEqual([]);
    await scenarioPage.close();
  }
});

test("write permissions reveal only their valid actions without issuing writes", async ({ page }) => {
  const context = page.context();
  const fixture = await configure(context);

  let readStart = fixture.reads.length;
  fixture.setPermissions(["users.view", "users.create"]);
  let scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "New user", exact: true })).toBeVisible();
  await expect(scenarioPage.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Link employee", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);
  await scenarioPage.getByRole("button", { name: "New user", exact: true }).click();
  await expect(scenarioPage.locator(".modal")).toBeVisible();
  await expect.poll(() => fixture.reads.includes("/users/employee-options")).toBe(true);
  await scenarioPage.locator(".modal").getByRole("button", { name: "Cancel", exact: true }).click();
  expectOnlyReads(fixture.reads, readStart, ["/users", "/users/employee-options"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["users.view", "users.update"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "New user", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(scenarioPage.getByRole("button", { name: "Link employee", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);
  expectOnlyReads(fixture.reads, readStart, ["/users"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["users.view", "users.disable"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "New user", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Link employee", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Roles", exact: true })).toHaveCount(0);
  await expect(scenarioPage.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  expectOnlyReads(fixture.reads, readStart, ["/users"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["users.view", "users.create", "users.update"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "Link employee", exact: true })).toBeVisible();
  await scenarioPage.getByRole("button", { name: "Link employee", exact: true }).click();
  await expect(scenarioPage.locator(".modal")).toBeVisible();
  await expect.poll(() => pathsSince(fixture.reads, readStart).has("/users/employee-options")).toBe(true);
  await scenarioPage.locator(".modal").getByRole("button", { name: "Cancel", exact: true }).click();
  expectOnlyReads(fixture.reads, readStart, ["/users", "/users/employee-options"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["users.view", "roles.view", "roles.manage"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "Roles", exact: true })).toBeVisible();
  await scenarioPage.getByRole("button", { name: "Roles", exact: true }).click();
  await expect.poll(() => pathsSince(fixture.reads, readStart).has("/users/user-1/roles")).toBe(true);
  await scenarioPage.locator(".modal").getByRole("button", { name: "Cancel", exact: true }).click();
  expectOnlyReads(fixture.reads, readStart, ["/users", "/roles", "/users/user-1/roles"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["roles.view", "roles.manage"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.getByRole("button", { name: "New role", exact: true })).toBeVisible();
  await expect(scenarioPage.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(scenarioPage.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  expectOnlyReads(fixture.reads, readStart, ["/roles", "/permissions"]);
  await scenarioPage.close();

  readStart = fixture.reads.length;
  fixture.setPermissions(["auth.sessions.view", "auth.sessions.revoke"]);
  scenarioPage = await openAdmin(context);
  await expect(scenarioPage.locator("tbody").getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  expectOnlyReads(fixture.reads, readStart, ["/auth/sessions"]);
  await scenarioPage.close();

  expect(fixture.writes).toEqual([]);
});
