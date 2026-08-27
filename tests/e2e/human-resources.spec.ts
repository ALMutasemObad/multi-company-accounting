import { expect, test } from "@playwright/test";

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
  const meta = (total: number) => ({ page: 1, pageSize: 10, total, totalPages: total ? 1 : 0 });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [{ id: "1", name: "E2E Company" }] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/hr/departments") return json({ data: [department] });
    if (path === "/hr/positions") return json({ data: [position] });
    if (path === "/hr/user-options") return json({ data: [] });
    if (path === "/hr/employees" && method === "POST") {
      employeeCreated = true;
      return json({ employee: employee() }, 201);
    }
    if (path === "/hr/employees") return json({ data: employeeCreated ? [employee()] : [], meta: meta(employeeCreated ? 1 : 0) });
    if (path === `/hr/employees/${employeeId}`) return json({ employee: employee() });
    if (path === `/hr/employees/${employeeId}/contracts` && method === "POST") {
      contractCreated = true;
      return json({ contract: contract() }, 201);
    }
    if (path === `/hr/employees/${employeeId}/contracts`) return json({ data: contractCreated ? [contract()] : [] });
    if (method === "GET") return json({ data: [], meta: meta(0) });
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/#humanResources");
  await expect(page.getByRole("heading", { name: "Human resources foundation" })).toBeVisible();
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
});
