import { expect, test, type Page, type Route } from "@playwright/test";
import { authMeResponse, e2eCompany } from "./auth-me-mock.js";

const permissions = [
  "hr.structure.view",
  "hr.employees.view",
  "hr.employees.manage",
  "hr.contracts.view",
  "hr.contracts.manage",
];

test("creates an independent employee record and a non-financial contract", async ({ page }) => {
  const employeeId = "f219c95d-f972-4943-badc-9a84aa78c0a3";
  const departmentId = "97259274-b795-4c1e-a6df-6ffcf06fe9b5";
  const positionId = "c0d151ec-5973-4118-ab5e-d21a9945a489";
  const contractId = "d913db4a-c391-44be-ab0d-846a2d0bb0b5";
  const department = { id: departmentId, code: "DEP-000001", nameAr: "الشؤون القانونية", nameEn: "Legal affairs", description: null, isActive: true, version: 0, createdAt: "2026-08-27T12:00:00.000Z", updatedAt: "2026-08-27T12:00:00.000Z" };
  const position = { id: positionId, code: "JOB-000001", nameAr: "مستشار قانوني", nameEn: "Legal counsel", description: null, isActive: true, version: 0, createdAt: "2026-08-27T12:00:00.000Z", updatedAt: "2026-08-27T12:00:00.000Z" };
  let employeeCreated = false;
  let contractCreated = false;

  const employee = () => ({
    id: employeeId,
    employeeNumber: "EMP-000001",
    nameAr: "ليان المستشار",
    nameEn: "Layan Counsel",
    employmentType: "FULL_TIME",
    status: "ACTIVE",
    hireDate: "2026-08-27",
    terminationDate: null,
    terminationReason: null,
    workLocation: "Riyadh",
    department,
    position,
    manager: null,
    linkedUser: null,
    hasActiveContract: contractCreated,
    version: 0,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  const contract = () => ({
    id: contractId,
    contractType: "PERMANENT",
    titleAr: "عقد مستشار قانوني",
    titleEn: "Legal counsel contract",
    startDate: "2026-08-27",
    endDate: null,
    status: "ACTIVE",
    notes: "Non-financial employment terms",
    endReason: null,
    endedAt: null,
    version: 0,
    createdAt: "2026-08-27T12:05:00.000Z",
    updatedAt: "2026-08-27T12:05:00.000Z",
  });
  const requestedPageSizes: number[] = [];
  const meta = (total: number, pageSize: number) => ({ page: 1, pageSize, total, totalPages: total ? 1 : 0 });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(permissions, ["HUMAN_RESOURCES"]));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/hr/departments") return json({ data: [department] });
    if (path === "/hr/positions") return json({ data: [position] });
    if (path === "/hr/employees" && method === "POST") {
      employeeCreated = true;
      return json({ employee: employee() }, 201);
    }
    if (path === "/hr/employees") {
      const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
      requestedPageSizes.push(pageSize);
      const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? "";
      const status = url.searchParams.get("status");
      const departmentFilter = url.searchParams.get("departmentId");
      const rows = employeeCreated && (!search || ["EMP-000001", "ليان المستشار", "Layan Counsel"].some((value) => value.toLocaleLowerCase().includes(search)))
        && (!status || status === "ACTIVE") && (!departmentFilter || departmentFilter === departmentId) ? [employee()] : [];
      return json({ data: rows, meta: meta(rows.length, pageSize) });
    }
    if (path === `/hr/employees/${employeeId}`) return json({ employee: employee() });
    if (path === `/hr/employees/${employeeId}/contracts` && method === "POST") {
      contractCreated = true;
      return json({ contract: contract() }, 201);
    }
    if (path === `/hr/employees/${employeeId}/contracts`) return json({ data: contractCreated ? [contract()] : [] });
    if (method === "GET") return json({ data: [], meta: meta(0, Number(url.searchParams.get("pageSize") ?? 25)) });
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/#humanResources");
  await expect(page.getByRole("heading", { name: "Human resources workspace" })).toBeVisible();
  const employeesTab = page.getByRole("tab", { name: "Employees and contracts" });
  const structureTab = page.getByRole("tab", { name: "Organization structure" });
  await expect(employeesTab).toHaveAttribute("aria-selected", "true");
  await expect(employeesTab).toHaveAttribute("tabindex", "0");
  await expect(structureTab).toHaveAttribute("tabindex", "-1");
  await employeesTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(structureTab).toBeFocused();
  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#hr-structure-panel")).toHaveAttribute("aria-labelledby", "hr-structure-tab");
  await page.keyboard.press("Home");
  await expect(employeesTab).toBeFocused();
  await expect(page.locator("#hr-employees-panel")).toHaveAttribute("aria-labelledby", "hr-employees-tab");
  expect(requestedPageSizes).toContain(12);
  expect(requestedPageSizes).toContain(1);
  await page.getByRole("button", { name: "New employee" }).first().click();

  const employeeDialog = page.getByRole("dialog", { name: "Create employee" });
  await employeeDialog.getByLabel("Arabic name").fill("ليان المستشار");
  await employeeDialog.getByLabel("English name").fill("Layan Counsel");
  await employeeDialog.getByLabel("Department").selectOption(departmentId);
  await employeeDialog.getByLabel("Position").selectOption(positionId);
  await employeeDialog.getByLabel("Work location").fill("Riyadh");
  await employeeDialog.getByRole("button", { name: "New employee" }).click();

  await expect(page.getByText("EMP-000001").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Layan Counsel" })).toBeVisible();
  await page.getByRole("button", { name: "Add contract" }).click();

  const contractDialog = page.getByRole("dialog", { name: "Add contract" });
  await contractDialog.getByLabel("Contract title").fill("عقد مستشار قانوني");
  await contractDialog.getByLabel("English name").fill("Legal counsel contract");
  await contractDialog.getByLabel("Notes").fill("Non-financial employment terms");
  await contractDialog.getByRole("button", { name: "Add contract" }).click();

  await expect(page.getByText("Legal counsel contract")).toBeVisible();
  await expect(page.getByText("Active contract").first()).toBeVisible();

  const search = page.getByRole("search");
  await search.getByRole("searchbox", { name: "Search" }).fill("not present");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.locator(".hr-no-results")).toContainText("No matching employees");

  await search.getByRole("searchbox", { name: "Search" }).fill("EMP-000001");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("button", { name: /Layan Counsel EMP-000001/u })).toBeVisible();

  await structureTab.click();
  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Positions" })).toBeVisible();
});

for (const scenario of [
  { name: "employees-only", permissions: ["hr.employees.view"], tab: "Employees and contracts" },
  { name: "structure-only", permissions: ["hr.structure.view"], tab: "Organization structure" },
] as const) {
  test(`${scenario.name} permission opens only its HR workspace`, async ({ page }) => {
    const requestedHrPaths: string[] = [];
    await installShellMocks(page, scenario.permissions, async (route, url, path) => {
      requestedHrPaths.push(path);
      if (path === "/hr/departments" || path === "/hr/positions") return respond(route, { data: [] });
      if (path === "/hr/employees") return respond(route, emptyEmployeePage(url));
      return respond(route, { code: "FORBIDDEN" }, 403);
    });

    await page.goto("/#humanResources");
    await expect(page.getByRole("heading", { name: "Human resources workspace" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab", { name: scenario.tab })).toHaveAttribute("tabindex", "0");
    if (scenario.name === "employees-only") {
      expect(requestedHrPaths.some((path) => path === "/hr/departments" || path === "/hr/positions")).toBe(false);
      await expect(page.getByLabel("Department")).toHaveCount(0);
    } else {
      expect(requestedHrPaths.some((path) => path === "/hr/employees")).toBe(false);
      await expect(page.locator("#hr-structure-panel")).toHaveAttribute("aria-labelledby", "hr-structure-tab");
    }
  });
}

test("no HR read permission rejects a direct HR route without making HR requests", async ({ page }) => {
  let hrRequests = 0;
  await installShellMocks(page, [], async (route) => {
    hrRequests += 1;
    await respond(route, { code: "FORBIDDEN" }, 403);
  });

  await page.goto("/#humanResources");

  await expect(page).toHaveURL(/#home$/u);
  await expect(page.getByRole("heading", { name: "Human resources workspace" })).toHaveCount(0);
  expect(hrRequests).toBe(0);
});

test("a 403 summary failure does not block the employee register", async ({ page }) => {
  const employee = employeeFixture("a0a1778f-b690-49c2-b790-43a086e3ca7c", "EMP-000071", "موظف متاح", "Available Employee", "ACTIVE");
  await installShellMocks(page, ["hr.employees.view"], async (route, url, path) => {
    if (path === "/hr/employees" && url.searchParams.has("status")) return respond(route, { code: "FORBIDDEN" }, 403);
    if (path === "/hr/employees") return respond(route, employeePage(url, [employee]));
    if (path === `/hr/employees/${employee.id}`) return respond(route, { employee });
    return respond(route, { code: "NOT_FOUND" }, 404);
  });

  await page.goto("/#humanResources");

  await expect(page.getByRole("button", { name: /Available Employee EMP-000071/u })).toBeVisible();
  await expect(page.locator(".hr-summary-error")).toContainText("Status totals could not be loaded");
  await expect(page.locator(".hr-layout")).toBeVisible();
  await expect(page.locator(".hr-employee-list .error-panel")).toHaveCount(0);
});

test("a 403 employee response stays retryable and exposes no stale register", async ({ page }) => {
  const recovered = employeeFixture("f201d065-f6e2-476b-80dc-d588ccb73916", "EMP-000075", "موظف مستعاد", "Recovered Employee", "ACTIVE");
  let denyListReads = true;
  await installShellMocks(page, ["hr.employees.view"], async (route, url, path) => {
    if (path === "/hr/employees" && url.searchParams.has("status")) return respond(route, { code: "FORBIDDEN" }, 403);
    if (path === "/hr/employees" && denyListReads) return respond(route, { code: "FORBIDDEN" }, 403);
    if (path === "/hr/employees") return respond(route, employeePage(url, [recovered]));
    if (path === `/hr/employees/${recovered.id}`) return respond(route, { employee: recovered });
    return respond(route, { code: "NOT_FOUND" }, 404);
  });

  await page.goto("/#humanResources");

  await expect(page.locator(".hr-tab-panel > .error-panel")).toBeVisible();
  await expect(page.locator(".hr-person-card")).toHaveCount(0);
  denyListReads = false;
  await page.locator(".hr-tab-panel > .error-panel").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /Recovered Employee EMP-000075/u })).toBeVisible();
  await expect(page.locator(".hr-person-card")).toHaveCount(1);
});

test("late employee and filter responses cannot restore a stale actionable record", async ({ page }) => {
  const active = employeeFixture("b50c177d-c975-462d-9c36-87d562af54c1", "EMP-000081", "الموظف النشط", "Active Employee", "ACTIVE");
  const onLeave = employeeFixture("6113959f-8e73-4915-9737-a7ca78f0bb05", "EMP-000082", "الموظف المجاز", "Leave Employee", "ON_LEAVE");
  await installShellMocks(page, ["hr.employees.view", "hr.employees.manage"], async (route, url, path) => {
    if (path === "/hr/employees") {
      const status = url.searchParams.get("status");
      const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
      const rows = status === "ACTIVE" ? [active] : status === "ON_LEAVE" ? [onLeave] : status === "TERMINATED" ? [] : [active, onLeave];
      if (pageSize === 12 && status === "ON_LEAVE") {
        await pause(650);
        return safelyRespond(route, employeePage(url, rows));
      }
      return respond(route, employeePage(url, rows));
    }
    if (path === `/hr/employees/${active.id}`) {
      await pause(650);
      return safelyRespond(route, { employee: active });
    }
    if (path === `/hr/employees/${onLeave.id}`) return respond(route, { employee: onLeave });
    return respond(route, { code: "NOT_FOUND" }, 404);
  });

  await page.goto("/#humanResources");
  const activeCard = page.getByRole("button", { name: /Active Employee EMP-000081/u });
  const leaveCard = page.getByRole("button", { name: /Leave Employee EMP-000082/u });
  await expect(activeCard).toBeVisible();
  await leaveCard.click();
  await expect(page.getByRole("heading", { name: "Leave Employee" })).toBeVisible();
  await pause(700);
  await expect(page.getByRole("heading", { name: "Leave Employee" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Employee" })).toHaveCount(0);

  await activeCard.click();
  await expect(page.getByRole("button", { name: "Edit employee" })).toHaveCount(0);
  await leaveCard.click();
  await expect(page.getByRole("heading", { name: "Leave Employee" })).toBeVisible();
  await pause(700);
  await expect(page.getByRole("heading", { name: "Leave Employee" })).toBeVisible();

  const status = page.getByLabel("Employee status");
  await status.selectOption("ON_LEAVE");
  await expect(page.getByRole("button", { name: "Edit employee" })).toHaveCount(0);
  await status.selectOption("ACTIVE");
  await expect(activeCard).toBeVisible();
  await expect(leaveCard).toHaveCount(0);
  await pause(700);
  await expect(activeCard).toBeVisible();
  await expect(leaveCard).toHaveCount(0);
});

type HrHandler = (route: Route, url: URL, path: string) => Promise<void> | void;

async function installShellMocks(page: Page, grantedPermissions: readonly string[], handleHr: HrHandler) {
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/u, "");
    if (path === "/auth/companies") return respond(route, { data: [e2eCompany] });
    if (path === "/auth/me") return respond(route, authMeResponse(grantedPermissions, ["HUMAN_RESOURCES"]));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/platform/capabilities") return respond(route, { platformOperations: false });
    if (path === "/organizations/workspaces") return respond(route, { data: [] });
    if (path.startsWith("/hr/")) return handleHr(route, url, path);
    return respond(route, { data: [] });
  });
}

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function safelyRespond(route: Route, body: unknown, status = 200) {
  try {
    await respond(route, body, status);
  } catch {
    // The browser may have honored AbortController before this intentionally late response.
  }
}

function emptyEmployeePage(url: URL) {
  return employeePage(url, []);
}

function employeePage(url: URL, data: ReturnType<typeof employeeFixture>[]) {
  const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
  return { data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length ? 1 : 0 } };
}

function employeeFixture(id: string, employeeNumber: string, nameAr: string, nameEn: string, status: "ACTIVE" | "ON_LEAVE" | "TERMINATED") {
  return {
    id,
    employeeNumber,
    nameAr,
    nameEn,
    employmentType: "FULL_TIME",
    status,
    hireDate: "2026-01-01",
    terminationDate: null,
    terminationReason: null,
    workLocation: "Riyadh",
    department: null,
    position: null,
    manager: null,
    linkedUser: null,
    hasActiveContract: false,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
