import { expect, test } from "@playwright/test";

test("manages an independent project plan, dependencies, comments and self-following on an isolated database", async ({ page }) => {
  test.skip(process.env.E2E_GENERAL_PROJECT_DB !== "true", "Requires an explicitly prepared local project acceptance database");
  const password = process.env.E2E_GENERAL_PROJECT_PASSWORD;
  expect(password, "A test-only seeded password is required").toBeTruthy();
  const suffix = Date.now().toString(36);
  const projectName = `General project ${suffix}`;
  const phaseName = `Delivery ${suffix}`;
  const editedPhaseName = `Delivery revised ${suffix}`;
  const firstTitle = `Prepare ${suffix}`;
  const editedFirstTitle = `Prepare revised ${suffix}`;
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
  const phaseEditor = page.locator("form").filter({ has: page.getByRole("heading", { name: "Edit phase" }) });
  await phaseEditor.getByLabel("Phase title").fill(editedPhaseName);
  await phaseEditor.getByLabel("Phase target date").fill("2059-03-10");
  await phaseEditor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: new RegExp(editedPhaseName) })).toBeVisible();
  const taskCreator = page.locator("form").filter({ has: page.getByRole("button", { name: "Add task" }) });
  await taskCreator.getByLabel("Task title").fill(firstTitle);
  await taskCreator.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("button", { name: new RegExp(firstTitle) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(firstTitle) }).click();
  const taskEditor = page.locator("form").filter({ has: page.getByRole("heading", { name: "Edit task" }) });
  await taskEditor.getByLabel("Task title").fill(editedFirstTitle);
  await taskEditor.getByLabel("Priority").selectOption("HIGH");
  await taskEditor.getByLabel("Task due date").fill("2059-03-02");
  await taskEditor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: new RegExp(editedFirstTitle) })).toBeVisible();
  await taskCreator.getByLabel("Task title").fill(secondTitle);
  await taskCreator.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("button", { name: new RegExp(secondTitle) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(secondTitle) }).click();
  await page.getByLabel("Search — Predecessor task").fill(editedFirstTitle);
  const predecessor = page.getByRole("combobox", { name: "Predecessor task", exact: true });
  const firstOption = predecessor.locator("option").filter({ hasText: editedFirstTitle });
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

test("rejects a stale project edit from a second browser session", async ({ page, browser }) => {
  test.skip(process.env.E2E_GENERAL_PROJECT_DB !== "true", "Requires an explicitly prepared local project acceptance database");
  const password = process.env.E2E_GENERAL_PROJECT_PASSWORD;
  expect(password, "A test-only seeded password is required").toBeTruthy();
  const projectName = `Concurrent project ${Date.now().toString(36)}`;
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const login = async (target: typeof page) => {
    await target.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
    await target.goto("/");
    const card = target.locator(".login-card");
    await card.locator('[name="email"]').fill("admin@mcap.local");
    await card.locator('[name="password"]').fill(password!);
    await card.getByRole("button", { name: "Secure sign in" }).click();
    await expect(target.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await target.goto("/#generalProjects");
    await expect(target.getByRole("heading", { name: "Project management" }).first()).toBeVisible();
  };
  try {
    await login(page);
    const creator = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "New project" }) });
    await creator.getByLabel("Project name").fill(projectName);
    const employeesResponse = page.waitForResponse(response => response.url().includes("/general-projects/employee-options")
      && response.url().includes("GPM-BROWSER-001"));
    await creator.getByLabel("Search — Project manager").fill("GPM-BROWSER-001");
    expect((await employeesResponse).status()).toBe(200);
    const manager = creator.getByRole("combobox", { name: "Project manager", exact: true });
    const option = manager.locator("option").filter({ hasText: "GPM-BROWSER-001" });
    await expect(option).toHaveCount(1);
    await manager.selectOption((await option.getAttribute("value"))!);
    await creator.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(projectName) })).toBeVisible();
    await login(secondPage);
    await expect(secondPage.getByRole("heading", { name: new RegExp(projectName) })).toBeVisible();

    const firstDetail = page.locator("section.card").filter({ has: page.getByRole("heading", { name: new RegExp(projectName) }) });
    const secondDetail = secondPage.locator("section.card").filter({ has: secondPage.getByRole("heading", { name: new RegExp(projectName) }) });
    await firstDetail.getByLabel("Project name").fill(`${projectName} A`);
    await secondDetail.getByLabel("Project name").fill(`${projectName} B`);
    const isProjectEdit = (response: import("@playwright/test").Response) => response.request().method() === "PATCH"
      && /\/general-projects\/[0-9a-f-]{36}$/u.test(new URL(response.url()).pathname);
    const firstResponse = page.waitForResponse(isProjectEdit);
    const secondResponse = secondPage.waitForResponse(isProjectEdit);
    await Promise.all([firstDetail.getByRole("button", { name: "Save" }).click(),
      secondDetail.getByRole("button", { name: "Save" }).click()]);
    const responses = await Promise.all([firstResponse, secondResponse]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    const winner = responses.find(response => response.status() === 200)!;
    const body = await winner.json() as { project: { nameAr: string } };
    await page.reload();
    await secondPage.reload();
    await expect(page.getByRole("heading", { name: new RegExp(body.project.nameAr) })).toBeVisible();
    await expect(secondPage.getByRole("heading", { name: new RegExp(body.project.nameAr) })).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
