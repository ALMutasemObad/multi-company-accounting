import { expect, test } from "@playwright/test";

test("creates a user by selecting an existing employee without re-entering names", async ({ page }) => {
  const employee = {
    id: "359b29e7-d502-4b75-af16-757b7609c990",
    employeeNumber: "EMP-000042",
    nameAr: "ريم المستشارة",
    nameEn: "Reem Consultant",
    status: "ACTIVE",
  };
  let created = false;
  let submitted: Record<string, unknown> | null = null;
  let idempotencyHeader = "";
  const user = () => ({
    id: "42",
    email: "reem@example.com",
    nameAr: employee.nameAr,
    nameEn: employee.nameEn,
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-08-28T08:00:00.000Z",
    updatedAt: "2026-08-28T08:00:00.000Z",
    employee,
  });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [{ id: "1", name: "E2E Company" }] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/roles") return json({ data: [] });
    if (path === "/users/employee-options") return json({ data: created ? [] : [employee] });
    if (path === "/users" && method === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      idempotencyHeader = request.headers()["idempotency-key"] ?? "";
      created = true;
      return json(user(), 201);
    }
    if (path === "/users") return json({ data: created ? [user()] : [], meta: { page: 1, pageSize: 20, total: created ? 1 : 0, totalPages: created ? 1 : 0 } });
    if (method === "GET") return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/#admin");
  await expect(page.getByRole("heading", { name: "Users, roles and permissions" })).toBeVisible();
  await page.getByRole("button", { name: "New user" }).click();

  const dialog = page.getByRole("dialog", { name: "New user" });
  await expect(dialog.getByText("Select an existing employee", { exact: false })).toBeVisible();
  await dialog.getByLabel("Linked employee").selectOption(employee.id);
  await dialog.getByLabel("Email address").fill("reem@example.com");
  await dialog.getByLabel("Temporary password").fill("Reem-Temporary-2026!");
  await expect(dialog.getByLabel("Arabic name")).toHaveCount(0);
  await dialog.getByRole("button", { name: /save/iu }).click();

  const createdRow = page.getByRole("row").filter({ hasText: "EMP-000042" });
  await expect(createdRow).toContainText("Reem Consultant");
  await expect(createdRow).toContainText("reem@example.com");
  expect(submitted).toEqual({ employeeId: employee.id, email: "reem@example.com", temporaryPassword: "Reem-Temporary-2026!" });
  expect(idempotencyHeader.length).toBeGreaterThanOrEqual(16);
});
