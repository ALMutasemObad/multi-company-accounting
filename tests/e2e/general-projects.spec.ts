import { expect, test } from "@playwright/test";

test("manages an independent project plan, dependencies, comments and self-following on an isolated database", async ({ page }) => {
  test.skip(process.env.E2E_GENERAL_PROJECT_DB !== "true", "Requires an explicitly prepared local project acceptance database");
  const password = process.env.E2E_GENERAL_PROJECT_PASSWORD;
  expect(password, "A test-only seeded password is required").toBeTruthy();
  const suffix = Date.now().toString(36);
  const projectName = `General project ${suffix}`;
  const phaseName = `Delivery ${suffix}`;
  const firstTitle = `Prepare ${suffix}`;
  const secondTitle = `Review ${suffix}`;

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.goto("/");
  const login = page.locator(".login-card");
  await login.locator('[name="email"]').fill("admin@mcap.local");
  await login.locator('[name="password"]').fill(password!);
  await login.getByRole("button", { name: "Secure sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

  await page.goto("/#generalProjects");
  await expect(page.getByRole("heading", { name: "Project management" }).first()).toBeVisible();
  const create = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "New project" }) });
  await create.getByLabel("Project name").fill(projectName);
  const employeesResponse = page.waitForResponse(response => response.url().includes("/general-projects/employee-options")
    && response.url().includes("GPM-BROWSER-001"));
  await create.getByLabel("Search — Project manager").fill("GPM-BROWSER-001");
  const employees = await employeesResponse;
  expect(employees.status()).toBe(200);
  expect((await employees.json() as { data: unknown[] }).data).toHaveLength(1);
  const manager = create.getByRole("combobox", { name: "Project manager", exact: true });
  const managerOption = manager.locator("option").filter({ hasText: "GPM-BROWSER-001" });
  await expect(managerOption).toHaveCount(1);
  await manager.selectOption((await managerOption.getAttribute("value"))!);
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(projectName) })).toBeVisible();

  await page.getByRole("button", { name: "Follow project" }).click();
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();
  await page.getByLabel("Comment", { exact: true }).fill(`Project note ${suffix}`);
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByText(`Project note ${suffix}`)).toBeVisible();

  await page.getByLabel("Phase title").fill(phaseName);
  const phaseResponse = page.waitForResponse(response => response.url().includes("/phases") && response.request().method() === "POST", { timeout: 5000 });
  await page.getByRole("button", { name: "Add phase" }).click();
  expect((await phaseResponse).status()).toBe(201);
  await page.getByRole("button", { name: new RegExp(phaseName) }).click();
  await page.getByLabel("Task title").fill(firstTitle);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("button", { name: new RegExp(firstTitle) })).toBeVisible();
  await page.getByLabel("Task title").fill(secondTitle);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("button", { name: new RegExp(secondTitle) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(secondTitle) }).click();
  await page.getByLabel("Search — Predecessor task").fill(firstTitle);
  const predecessor = page.getByRole("combobox", { name: "Predecessor task", exact: true });
  const firstOption = predecessor.locator("option").filter({ hasText: firstTitle });
  await expect(firstOption).toHaveCount(1);
  await predecessor.selectOption((await firstOption.getAttribute("value"))!);
  await page.getByRole("button", { name: "Add dependency" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`${secondTitle}.*Waiting for a predecessor`) })).toBeVisible();

  await page.getByLabel("Comment on").selectOption({ label: secondTitle });
  await page.getByLabel("Comment", { exact: true }).fill(`Task note ${suffix}`);
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByText(`Task note ${suffix}`)).toBeVisible();
  await page.getByLabel("Project scope").selectOption("FOLLOWING");
  await expect(page.getByRole("button", { name: new RegExp(projectName) })).toBeVisible();
  await page.getByRole("button", { name: "Unfollow" }).click();
  await expect(page.getByRole("button", { name: new RegExp(projectName) })).toHaveCount(0);
});
