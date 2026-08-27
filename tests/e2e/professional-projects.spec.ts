import { expect, test } from "@playwright/test";

test("creates a legal matter and records personal professional time", async ({ page }) => {
  const projectId = "b1af217e-7c7b-43bb-b15f-61184df1d6b9";
  const entryId = "cbcc08ff-99bc-40c4-8757-bc90016584e3";
  const customer = { id: "41", code: "CUS-000041", nameAr: "شركة العميل التجريبية", nameEn: "Example Client" };
  const manager = { id: "7", displayName: "Project Manager", nameEn: "Project Manager" };
  let created = false;
  let timeRecorded = false;

  const project = () => ({
    id: projectId,
    code: "PRJ-000001",
    customer,
    nameAr: "مسألة قانونية تجريبية",
    nameEn: "Legal advisory matter",
    kind: "LEGAL_MATTER",
    billingModel: "TIME_AND_MATERIALS",
    status: "ACTIVE",
    startDate: "2026-08-27",
    targetEndDate: null,
    description: "Defined advisory scope",
    memberCount: 1,
    trackedMinutes: timeRecorded ? 90 : 0,
    billableMinutes: timeRecorded ? 90 : 0,
    version: 0,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  const timeEntry = () => ({
    id: entryId,
    project: { id: projectId, code: "PRJ-000001", nameAr: project().nameAr, nameEn: project().nameEn },
    user: manager,
    workDate: "2026-08-27",
    minutes: 90,
    isBillable: true,
    description: "Initial legal research",
    editable: true,
    version: 0,
    createdAt: "2026-08-27T12:05:00.000Z",
    updatedAt: "2026-08-27T12:05:00.000Z",
  });
  const meta = (total: number) => ({ page: 1, pageSize: 25, total, totalPages: total ? 1 : 0 });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [{ id: "1", name: "E2E Company" }] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/professional-projects/customer-options") return json({ data: [customer] });
    if (path === "/professional-projects/member-options") return json({ data: [manager] });
    if (path === "/professional-projects" && method === "POST") {
      created = true;
      return json({ project: project() }, 201);
    }
    if (path === "/professional-projects") return json({ data: created ? [project()] : [], meta: meta(created ? 1 : 0) });
    if (path === `/professional-projects/${projectId}`) return json({
      project: project(),
      members: [{ user: manager, role: "MANAGER", isActive: true, version: 0, assignedAt: "2026-08-27T12:00:00.000Z", unassignedAt: null }],
    });
    if (path === "/professional-time-entries" && method === "POST") {
      timeRecorded = true;
      return json({ timeEntry: timeEntry() }, 201);
    }
    if (path === "/professional-time-entries") return json({
      data: timeRecorded ? [timeEntry()] : [],
      meta: meta(timeRecorded ? 1 : 0),
      summary: { trackedMinutes: timeRecorded ? 90 : 0, billableMinutes: timeRecorded ? 90 : 0, nonBillableMinutes: 0 },
    });
    if (method === "GET") return json({ data: [], meta: meta(0) });
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/#professionalProjects");
  await expect(page.getByRole("heading", { name: "Professional projects and matters" })).toBeVisible();
  await page.getByRole("button", { name: "New project or matter" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Create professional project" });
  await dialog.getByLabel("Customer").selectOption(customer.id);
  await dialog.getByLabel("Arabic name").fill("مسألة قانونية تجريبية");
  await dialog.getByLabel("English name").fill("Legal advisory matter");
  await dialog.getByLabel("Scope description").fill("Defined advisory scope");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Legal advisory matter" })).toBeVisible();
  await expect(page.getByText("Project Manager").first()).toBeVisible();
  await page.getByLabel("Minutes").fill("90");
  await page.getByLabel("Work description").fill("Initial legal research");
  await page.getByRole("button", { name: "Log time" }).click();

  await expect(page.getByText("Initial legal research")).toBeVisible();
  await expect(page.getByText("1h 30m").first()).toBeVisible();
});
