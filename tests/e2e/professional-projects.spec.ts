import { expect, test } from "@playwright/test";

test("creates a legal matter, approves time, configures rates, and posts professional billing", async ({ page }) => {
  const projectId = "b1af217e-7c7b-43bb-b15f-61184df1d6b9";
  const entryId = "cbcc08ff-99bc-40c4-8757-bc90016584e3";
  const customer = { id: "41", code: "CUS-000041", nameAr: "شركة العميل التجريبية", nameEn: "Example Client" };
  const manager = { id: "7", displayName: "Project Manager", nameEn: "Project Manager" };
  let created = false;
  let timeRecorded = false;
  let timesheetCreated = false;
  let timesheetSubmitted = false;
  let timesheetApproved = false;
  let contractCreated = false;
  let rateCreated = false;
  let billingCreated = false;
  const contractId = "7f31e91e-38fd-4b0c-9acb-4481e533cf41";
  const rateId = "9c6bb86d-8c9d-437e-9774-74584f425163";
  const billingRunId = "a4bb7408-9423-4fa3-81d5-3d34ea7f6a12";
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

    if (path === "/auth/companies") return json({ data: [{ id: "1", name: "E2E Company" }] });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/professional-projects/customer-options") return json({ data: [customer] });
    if (path === "/professional-projects/member-options") return json({ data: [manager] });
    if (path === "/professional-billing/currency-options") return json({ data: [currency] });
    if (path === "/fiscal-periods") return json({ data: [{ id: "3", fiscalYearId: "1", periodNumber: 8, name: "August 2026", startDate: "2026-08-01", endDate: "2026-08-31", status: "OPEN", closedAt: null, reopenedAt: null, reopenReason: null, version: 0 }], meta: meta(1) });
    if (path === "/accounts") return json({ data: [{ id: "9", accountTypeId: "5", parentAccountId: null, code: "4100", nameAr: "إيراد خدمات", nameEn: "Service revenue", level: 1, allowsPosting: true, isControlAccount: false, isActive: true, sourceTemplateCode: null, sourceTemplateKey: null }], meta: meta(1) });
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
  await page.getByLabel("Minutes").fill("90");
  await page.getByLabel("Work description").fill("Initial legal research");
  await page.getByRole("button", { name: "Log time" }).click();

  await expect(page.getByText("Initial legal research")).toBeVisible();
  await expect(page.getByText("1h 30m").first()).toBeVisible();

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
