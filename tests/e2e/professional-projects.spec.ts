import { expect, test } from "@playwright/test";
import { authMeResponse, e2eCompany } from "./auth-me-mock.js";

const permissions = [
  "professional_projects.view",
  "professional_projects.manage",
  "professional_access.manage",
  "professional_planning.view",
  "professional_planning.manage",
  "professional_time.view",
  "professional_time.log",
  "professional_timesheets.view",
  "professional_timesheets.submit",
  "professional_contracts.view",
  "professional_contracts.manage",
  "professional_rates.view",
  "professional_rates.manage",
  "professional_billing.view",
  "professional_billing.execute",
  "fiscal_periods.view",
  "accounts.view",
  "sales_invoices.create",
  "sales_invoices.post",
];

test("creates a legal matter, approves time, configures rates, and posts professional billing", async ({ page }) => {
  const projectId = "b1af217e-7c7b-43bb-b15f-61184df1d6b9";
  const entryId = "cbcc08ff-99bc-40c4-8757-bc90016584e3";
  const customer = { id: "41", code: "CUS-000041", nameAr: "شركة العميل التجريبية", nameEn: "Example Client" };
  const manager = { id: "7", displayName: "Project Manager", nameEn: "Project Manager" };
  const consultant = { id: "8", displayName: "External Consultant", nameEn: "External Consultant" };
  let created = false;
  let timeRecorded = false;
  let timesheetCreated = false;
  let timesheetSubmitted = false;
  let timesheetApproved = false;
  let contractCreated = false;
  let rateCreated = false;
  let billingCreated = false;
  let accessMode: "COMPANY" | "RESTRICTED" = "COMPANY";
  let accessVersion = 0;
  let accessGrantActive = false;
  let timeBudgetMinutes: number | null = null;
  let planningVersion = 0;
  let stageCreated = false;
  let createdTaskCount = 0;
  let dependencyCreated = false;
  let loggedTaskId: string | null = null;
  let stageNameEn = "Analysis and advice";
  let stageVersion = 0;
  let researchTaskTitleEn = "Initial research";
  let researchTaskEstimatedMinutes = 180;
  let researchTaskVersion = 0;
  const contractId = "7f31e91e-38fd-4b0c-9acb-4481e533cf41";
  const rateId = "9c6bb86d-8c9d-437e-9774-74584f425163";
  const billingRunId = "a4bb7408-9423-4fa3-81d5-3d34ea7f6a12";
  const stageId = "44b23a51-b68c-4e35-a252-d577c3021c2a";
  const researchTaskId = "49e2bc47-bf40-4bf7-a40a-3408b77cfba5";
  const draftingTaskId = "8ff14e20-5f22-4e6e-909b-bc0385144d49";
  const dependencyId = "6c2d61ed-8e4e-4b0c-baa9-7997145394b1";
  const accessGrantId = "74d5c65e-3381-4aba-a3ae-0b61409375f6";
  const currency = { id: "2", code: "SAR", nameAr: "الريال السعودي", decimals: 2 };
  const contract = () => ({
    id: contractId,
    projectId,
    currency,
    contractReference: "RET-2026-001",
    effectiveFrom: "2026-08-27",
    effectiveTo: null,
    paymentTermsDays: 30,
    status: "ACTIVE",
    endReason: null,
    endedAt: null,
    version: 0,
    createdAt: "2026-08-27T12:20:00.000Z",
    updatedAt: "2026-08-27T12:20:00.000Z",
  });
  const rate = () => ({
    id: rateId,
    contractId,
    userId: manager.id,
    hourlyRate: "450.0000",
    effectiveFrom: "2026-08-27",
    effectiveTo: null,
    status: "ACTIVE",
    endReason: null,
    endedAt: null,
    version: 0,
    createdAt: "2026-08-27T12:21:00.000Z",
    updatedAt: "2026-08-27T12:21:00.000Z",
  });
  const billingRun = () => ({
    id: billingRunId,
    project: { id: projectId, code: "PRJ-000001", nameAr: project().nameAr, nameEn: project().nameEn },
    contract: { id: contractId, contractReference: "RET-2026-001" },
    contractVersion: 0,
    sourceDateFrom: "2026-08-27",
    sourceDateTo: "2026-08-27",
    sourceEntryCount: 1,
    sourceMinutes: 90,
    invoice: { id: "81", documentId: "91", documentNumber: "SINV-000001", status: "POSTED", currency, total: "675.0000", baseTotal: "675.0000" },
    createdAt: "2026-08-27T12:25:00.000Z",
  });

  const project = () => ({
    id: projectId,
    code: "PRJ-000001",
    customer,
    nameAr: "مسألة قانونية تجريبية",
    nameEn: "Legal advisory matter",
    kind: "LEGAL_MATTER",
    billingModel: "TIME_AND_MATERIALS",
    status: "ACTIVE",
    accessMode,
    accessVersion,
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
  const task = (id: string, sequence: number, titleAr: string, titleEn: string) => ({
    id,
    stageId,
    sequence,
    titleAr,
    titleEn: id === researchTaskId ? researchTaskTitleEn : titleEn,
    description: null,
    status: "TODO",
    assigneeUserId: manager.id,
    estimatedMinutes: id === researchTaskId ? researchTaskEstimatedMinutes : 240,
    plannedStartDate: null,
    dueDate: null,
    completedAt: null,
    version: id === researchTaskId ? researchTaskVersion : 0,
    actualMinutes: id === loggedTaskId && timeRecorded ? 90 : 0,
    approvedMinutes: id === loggedTaskId && timesheetApproved ? 90 : 0,
  });
  const stage = () => {
    const tasks = [
      ...(createdTaskCount >= 1 ? [task(researchTaskId, 1, "بحث أولي", "Initial research")] : []),
      ...(createdTaskCount >= 2 ? [task(draftingTaskId, 2, "صياغة الرأي", "Draft advice")] : []),
    ];
    return {
      id: stageId,
      sequence: 1,
      nameAr: "التحليل والمشورة",
      nameEn: stageNameEn,
      description: null,
      status: "PLANNED",
      plannedStartDate: null,
      targetEndDate: null,
      version: stageVersion,
      summary: {
        estimatedMinutes: tasks.reduce((sum, item) => sum + item.estimatedMinutes, 0),
        actualMinutes: timeRecorded ? 90 : 0,
        approvedMinutes: timesheetApproved ? 90 : 0,
        taskCounts: { TODO: tasks.length, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 },
      },
      tasks,
    };
  };
  const plan = () => {
    const stages = stageCreated ? [stage()] : [];
    const estimatedMinutes = stages.reduce((sum, item) => sum + item.summary.estimatedMinutes, 0);
    const actualMinutes = timeRecorded ? 90 : 0;
    return {
      projectId,
      planningVersion,
      summary: {
        timeBudgetMinutes,
        estimatedMinutes,
        actualMinutes,
        approvedMinutes: timesheetApproved ? actualMinutes : 0,
        allocatedActualMinutes: loggedTaskId ? actualMinutes : 0,
        unallocatedActualMinutes: loggedTaskId ? 0 : actualMinutes,
        remainingBudgetMinutes: timeBudgetMinutes === null ? null : Math.max(0, timeBudgetMinutes - actualMinutes),
        overBudgetMinutes: timeBudgetMinutes === null ? 0 : Math.max(0, actualMinutes - timeBudgetMinutes),
        taskCounts: { TODO: createdTaskCount, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 },
      },
      stages,
      dependencies: dependencyCreated ? [{ id: dependencyId, predecessorTaskId: researchTaskId, successorTaskId: draftingTaskId, isActive: true, version: 0 }] : [],
    };
  };
  const timeEntry = () => ({
    id: entryId,
    project: { id: projectId, code: "PRJ-000001", nameAr: project().nameAr, nameEn: project().nameEn },
    task: loggedTaskId ? { id: loggedTaskId, titleAr: "بحث أولي", titleEn: researchTaskTitleEn, status: "TODO" } : null,
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
  const timesheet = () => ({
    id: "f3b5105d-c2f9-4b62-84ee-4e5bfb59b249",
    employee: { id: "f5c6c0a0-824d-45f8-8c37-b24f15c8bff6", employeeNumber: "EMP-000001", nameAr: "مدير المشروع", nameEn: "Project Manager", status: "ACTIVE" },
    periodStart: "2026-08-23",
    periodEnd: "2026-08-29",
    status: timesheetApproved ? "APPROVED" : timesheetSubmitted ? "AWAITING_APPROVAL" : "OPEN",
    entryCount: timeRecorded ? 1 : 0,
    trackedMinutes: timeRecorded ? 90 : 0,
    billableMinutes: timeRecorded ? 90 : 0,
    nonBillableMinutes: 0,
    activeSubmissionNumber: timesheetSubmitted ? 1 : null,
    activeSnapshotHashSha256: timesheetSubmitted ? "a".repeat(64) : null,
    submittedAt: timesheetSubmitted ? "2026-08-27T12:10:00.000Z" : null,
    editable: !timesheetSubmitted,
    version: timesheetApproved ? 2 : timesheetSubmitted ? 1 : 0,
    createdAt: "2026-08-27T12:08:00.000Z",
    updatedAt: "2026-08-27T12:08:00.000Z",
  });
  const meta = (total: number) => ({ page: 1, pageSize: 25, total, totalPages: total ? 1 : 0 });

  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/companies") return json({ data: [e2eCompany] });
    if (path === "/auth/me") return json(authMeResponse(permissions));
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/professional-projects/customer-options") return json({ data: [customer] });
    if (path === "/professional-projects/member-options") return json({ data: [manager, consultant] });
    if (path === "/professional-billing/currency-options") return json({ data: [currency] });
    if (path === "/fiscal-periods") return json({ data: [{ id: "3", fiscalYearId: "1", periodNumber: 8, name: "August 2026", startDate: "2026-08-01", endDate: "2026-08-31", status: "OPEN", closedAt: null, reopenedAt: null, reopenReason: null, version: 0 }], meta: meta(1) });
    if (path === "/accounts") return json({ data: [{ id: "9", accountTypeId: "5", parentAccountId: null, code: "4100", nameAr: "إيراد خدمات", nameEn: "Service revenue", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: null, sourceTemplateKey: null }], meta: meta(1) });
    if (path === "/professional-projects" && method === "POST") {
      created = true;
      return json({ project: project() }, 201);
    }
    if (path === "/professional-projects") return json({ data: created ? [project()] : [], meta: meta(created ? 1 : 0) });
    if (path === `/professional-projects/${projectId}/access` && method === "PATCH") {
      const body = request.postDataJSON() as { accessMode: "COMPANY" | "RESTRICTED" };
      accessMode = body.accessMode;
      accessVersion += 1;
      return json({ projectId, accessMode, accessVersion, grants: [] });
    }
    if (path === `/professional-projects/${projectId}/access-grants` && method === "POST") {
      accessGrantActive = true;
      accessVersion += 1;
      return json({ grant: { id: accessGrantId }, accessVersion }, 201);
    }
    if (path === `/professional-projects/${projectId}/access-grants/${accessGrantId}/revoke` && method === "POST") {
      accessGrantActive = false;
      accessVersion += 1;
      return json({ revoked: true, accessVersion, grantVersion: 1 });
    }
    if (path === `/professional-projects/${projectId}/access`) return json({
      projectId,
      accessMode,
      accessVersion,
      grants: accessVersion >= 2 ? [{
        id: accessGrantId,
        user: consultant,
        isActive: accessGrantActive,
        version: accessGrantActive ? 0 : 1,
        grantReason: "Matter consultation",
        grantedAt: "2026-08-27T12:02:00.000Z",
        revocationReason: accessGrantActive ? null : "Engagement ended",
        revokedAt: accessGrantActive ? null : "2026-08-27T12:03:00.000Z",
      }] : [],
    });
    if (path === `/professional-projects/${projectId}/plan`) return json(plan());
    if (path === `/professional-projects/${projectId}/time-budget` && method === "PATCH") {
      const body = request.postDataJSON() as { timeBudgetMinutes: number | null };
      timeBudgetMinutes = body.timeBudgetMinutes;
      planningVersion += 1;
      return json({ project: { projectId, timeBudgetMinutes }, planningVersion });
    }
    if (path === `/professional-projects/${projectId}/stages` && method === "POST") {
      stageCreated = true;
      planningVersion += 1;
      return json({ stage: stage(), planningVersion }, 201);
    }
    if (path === `/professional-project-stages/${stageId}` && method === "PATCH") {
      const body = request.postDataJSON() as { planningVersion: number; version: number; nameEn: string | null };
      expect(body).toMatchObject({ planningVersion, version: stageVersion });
      stageNameEn = body.nameEn ?? stageNameEn;
      stageVersion += 1;
      planningVersion += 1;
      return json({ stage: stage(), planningVersion });
    }
    if (path === `/professional-project-stages/${stageId}/tasks` && method === "POST") {
      createdTaskCount += 1;
      planningVersion += 1;
      const createdTask = createdTaskCount === 1
        ? task(researchTaskId, 1, "بحث أولي", "Initial research")
        : task(draftingTaskId, 2, "صياغة الرأي", "Draft advice");
      return json({ task: createdTask, planningVersion }, 201);
    }
    if (path === `/professional-project-tasks/${researchTaskId}` && method === "PATCH") {
      const body = request.postDataJSON() as { planningVersion: number; version: number; titleEn: string | null; estimatedMinutes: number };
      expect(body).toMatchObject({ planningVersion, version: researchTaskVersion });
      researchTaskTitleEn = body.titleEn ?? researchTaskTitleEn;
      researchTaskEstimatedMinutes = body.estimatedMinutes;
      researchTaskVersion += 1;
      planningVersion += 1;
      return json({ task: task(researchTaskId, 1, "بحث أولي", researchTaskTitleEn), planningVersion });
    }
    if (path === "/professional-project-task-dependencies" && method === "POST") {
      dependencyCreated = true;
      planningVersion += 1;
      return json({ dependency: { id: dependencyId, predecessorTaskId: researchTaskId, successorTaskId: draftingTaskId, isActive: true, version: 0 }, planningVersion }, 201);
    }
    if (path === `/professional-projects/${projectId}`) return json({
      project: project(),
      members: [{ user: manager, role: "MANAGER", isActive: true, version: 0, assignedAt: "2026-08-27T12:00:00.000Z", unassignedAt: null }],
    });
    if (path === "/professional-time-entries" && method === "POST") {
      const body = request.postDataJSON() as { taskId: string | null };
      loggedTaskId = body.taskId;
      timeRecorded = true;
      return json({ timeEntry: timeEntry() }, 201);
    }
    if (path === "/professional-time-entries") return json({
      data: timeRecorded ? [timeEntry()] : [],
      meta: meta(timeRecorded ? 1 : 0),
      summary: { trackedMinutes: timeRecorded ? 90 : 0, billableMinutes: timeRecorded ? 90 : 0, nonBillableMinutes: 0 },
    });
    if (path === "/professional-timesheets" && method === "POST") {
      timesheetCreated = true;
      return json({ timesheet: timesheet() }, 201);
    }
    if (path === "/professional-timesheets") return json({ data: timesheetCreated ? [timesheet()] : [], meta: meta(timesheetCreated ? 1 : 0) });
    if (path === "/approval-requests" && method === "POST") {
      timesheetSubmitted = true;
      return json({ approvalRequest: { id: crypto.randomUUID() } }, 201);
    }
    if (path === "/professional-service-contracts" && method === "POST") {
      contractCreated = true;
      return json({ contract: contract() }, 201);
    }
    if (path === "/professional-service-contracts") return json({ data: contractCreated ? [contract()] : [] });
    if (path === "/professional-service-rates" && method === "POST") {
      rateCreated = true;
      return json({ rate: rate() }, 201);
    }
    if (path === "/professional-service-rates") return json({ data: rateCreated ? [rate()] : [] });
    if (path === "/professional-billing-runs" && method === "POST") {
      billingCreated = true;
      return json({ run: billingRun() }, 201);
    }
    if (path === "/professional-billing-runs") return json({ data: billingCreated ? [billingRun()] : [] });
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

  const accessPanel = page.locator(".professional-access-panel");
  await expect(accessPanel.getByRole("heading", { name: "Matter ethical wall" })).toBeVisible();
  await accessPanel.getByLabel("Access scope").selectOption("RESTRICTED");
  await accessPanel.getByLabel("Change reason").fill("Confidential legal matter");
  await accessPanel.getByRole("button", { name: "Save policy" }).click();
  await expect(accessPanel.getByText("Matter team and grants only").first()).toBeVisible();
  await accessPanel.getByLabel("Member").selectOption(consultant.id);
  await accessPanel.getByLabel("Grant reason").fill("Matter consultation");
  await accessPanel.getByRole("button", { name: "Grant access" }).click();
  await expect(accessPanel.getByRole("cell", { name: /External Consultant/u })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Engagement ended"));
  await accessPanel.getByRole("button", { name: "Revoke access" }).click();
  await expect(accessPanel.getByText("Revoked")).toBeVisible();

  const planPanel = page.locator(".professional-plan-panel");
  await expect(planPanel.getByRole("heading", { name: "Project plan" })).toBeVisible();
  await planPanel.getByLabel("Budget in minutes").fill("1200");
  await planPanel.getByRole("button", { name: "Save budget" }).click();
  await expect(planPanel.getByText("20h 0m").first()).toBeVisible();

  await planPanel.getByLabel("Arabic name").fill("التحليل والمشورة");
  await planPanel.getByLabel("English name").fill("Analysis and advice");
  await planPanel.getByRole("button", { name: "Add stage" }).click();
  await expect(planPanel.locator(".professional-stage-row")).toContainText("Analysis and advice");

  await planPanel.locator(".professional-stage-row").getByRole("button", { name: "Edit" }).click();
  const stageDialog = page.getByRole("dialog", { name: "Edit stage" });
  await stageDialog.getByLabel("English name").fill("Advisory analysis");
  await stageDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(planPanel.locator(".professional-stage-row")).toContainText("Advisory analysis");

  await planPanel.getByLabel("Task title in Arabic").fill("بحث أولي");
  await planPanel.getByLabel("Task title in English").fill("Initial research");
  await planPanel.getByLabel("Assignee").selectOption(manager.id);
  await planPanel.getByLabel("Estimate in minutes").fill("180");
  await planPanel.getByRole("button", { name: "Add task" }).click();
  await expect(planPanel.locator(".professional-task-row")).toContainText("Initial research");

  await planPanel.locator(".professional-task-row").getByRole("button", { name: "Edit" }).click();
  const taskDialog = page.getByRole("dialog", { name: "Edit task" });
  await taskDialog.getByLabel("Task title in English").fill("Legal research");
  await taskDialog.getByLabel("Estimate in minutes").fill("200");
  await taskDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(planPanel.locator(".professional-task-row")).toContainText("Legal research");

  await planPanel.getByLabel("Task title in Arabic").fill("صياغة الرأي");
  await planPanel.getByLabel("Task title in English").fill("Draft advice");
  await planPanel.getByLabel("Assignee").selectOption(manager.id);
  await planPanel.getByLabel("Estimate in minutes").fill("240");
  await planPanel.getByRole("button", { name: "Add task" }).click();
  await expect(planPanel.locator(".professional-task-row")).toHaveCount(2);

  await planPanel.getByLabel("Predecessor task").selectOption(researchTaskId);
  await planPanel.getByLabel("Successor task").selectOption(draftingTaskId);
  await planPanel.getByRole("button", { name: "Add dependency" }).click();
  await expect(planPanel.getByText("Legal research → Draft advice", { exact: true })).toBeVisible();

  const timePanel = page.locator(".professional-time-panel");
  await timePanel.getByLabel("Minutes").fill("90");
  await timePanel.getByLabel("Task (optional)").selectOption(researchTaskId);
  await timePanel.getByLabel("Work description").fill("Initial legal research");
  await timePanel.getByRole("button", { name: "Log time" }).click();

  await expect(timePanel.getByText("Initial legal research")).toBeVisible();
  await expect(timePanel.getByRole("cell", { name: "Legal research", exact: true })).toBeVisible();
  await expect(timePanel.getByText("1h 30m").first()).toBeVisible();

  await page.getByLabel("Week start (Sunday)").fill("2026-08-23");
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByText("2026-08-23")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting approval")).toBeVisible();

  timesheetApproved = true;
  const contractSection = page.locator(".professional-commercial-section").first();
  await contractSection.getByLabel("Contract currency").selectOption(currency.id);
  await contractSection.getByLabel("Contract reference").fill("RET-2026-001");
  await contractSection.getByRole("button", { name: "Create contract" }).click();
  await expect(contractSection.getByText("RET-2026-001")).toBeVisible();

  const rateSection = page.locator(".professional-commercial-section").nth(1);
  await rateSection.getByLabel("Member").selectOption(manager.id);
  await rateSection.getByLabel("Hourly rate").fill("450");
  await rateSection.getByRole("button", { name: "Add rate" }).click();
  await expect(rateSection.getByText("450")).toBeVisible();

  const billingForm = page.locator(".professional-billing-form");
  await billingForm.getByLabel("Fiscal period").selectOption("3");
  await billingForm.getByLabel("Time from").fill("2026-08-27");
  await billingForm.getByLabel("Time to").fill("2026-08-27");
  await billingForm.getByLabel("Revenue account").click();
  await page.getByRole("option", { name: /4100/u }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await billingForm.getByRole("button", { name: "Create and post invoice" }).click();
  await expect(page.getByText("SINV-000001")).toBeVisible();
  await expect(page.getByText("675.00 SAR")).toBeVisible();
});
