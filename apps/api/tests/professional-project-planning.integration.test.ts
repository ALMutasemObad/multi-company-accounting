import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import {
  ProfessionalProjectPlanningService,
} from "../src/projects/professional-project-planning-service.js";
import { ProfessionalProjectService } from "../src/projects/professional-project-service.js";
import { ProfessionalCustomerAdapter } from "../src/sales/professional-customer-adapter.js";
import { ProfessionalPeopleAdapter } from "../src/users/professional-people-adapter.js";
import { ProfessionalEmployeeAdapter } from "../src/hr/professional-employee-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
const testAccountCode = "IT-PLAN-AR";
const testCustomerCode = "IT-PLAN-CUSTOMER";

describe.runIf(enabled)("professional project planning with MariaDB", () => {
  let planning: ProfessionalProjectPlanningService;
  let projects: ProfessionalProjectService;
  let companyId: bigint;
  let userId: bigint;
  let projectInternalId: bigint;
  let projectId: string;
  let stageId: string;
  let firstTaskId: string;
  let secondTaskId: string;
  let dependencyId: string;

  const context = () => ({ companyId, userId });
  const operations = [
    "CREATE_PROFESSIONAL_PROJECT_STAGE",
    "CREATE_PROFESSIONAL_PROJECT_TASK",
    "TRANSITION_PROFESSIONAL_PROJECT_STAGE",
    "TRANSITION_PROFESSIONAL_PROJECT_TASK",
    "ADD_PROFESSIONAL_TASK_DEPENDENCY",
    "REMOVE_PROFESSIONAL_TASK_DEPENDENCY",
    "CREATE_PROFESSIONAL_TIME_ENTRY",
  ];

  async function cleanup() {
    if (!prisma || !companyId) return;
    const projects = await prisma.professionalProject.findMany({
      where: { companyId, code: { startsWith: "IT-PLAN-" } },
      select: { id: true },
    });
    const projectIds = projects.map((row) => row.id);
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: operations } } });
    await prisma.auditLog.deleteMany({
      where: {
        companyId,
        entityType: { in: ["PROFESSIONAL_PROJECT", "PROFESSIONAL_PROJECT_STAGE", "PROFESSIONAL_PROJECT_TASK", "PROFESSIONAL_TASK_DEPENDENCY"] },
      },
    });
    if (projectIds.length) {
      await prisma.professionalTimeEntry.deleteMany({ where: { companyId, projectId: { in: projectIds } } });
      await prisma.professionalTimesheet.deleteMany({
        where: { companyId, userId, periodStart: new Date("2061-02-06T00:00:00.000Z") },
      });
      await prisma.professionalTaskDependency.deleteMany({ where: { companyId, projectId: { in: projectIds } } });
      await prisma.professionalProjectTask.deleteMany({ where: { companyId, projectId: { in: projectIds } } });
      await prisma.professionalProjectStage.deleteMany({ where: { companyId, projectId: { in: projectIds } } });
      await prisma.professionalProjectMember.deleteMany({ where: { companyId, projectId: { in: projectIds } } });
      await prisma.professionalProject.deleteMany({ where: { companyId, id: { in: projectIds } } });
    }
    await prisma.customer.deleteMany({ where: { companyId, code: testCustomerCode } });
    await prisma.account.deleteMany({ where: { companyId, code: testAccountCode } });
  }

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = admin.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    await cleanup();
    const assetType = await prisma!.accountType.findUniqueOrThrow({ where: { code: "ASSET" } });
    const receivableAccount = await prisma!.account.create({
      data: {
        companyId,
        accountTypeId: assetType.id,
        code: testAccountCode,
        nameAr: "ذمم عميل تخطيط المشاريع الاختبارية",
        level: 1,
        allowsPosting: true,
      },
    });
    const customer = await prisma!.customer.create({
      data: {
        companyId,
        receivableAccountId: receivableAccount.id,
        code: testCustomerCode,
        nameAr: "عميل تخطيط المشاريع الاختباري",
      },
    });
    const project = await prisma!.professionalProject.create({
      data: {
        companyId,
        customerId: customer.id,
        code: `IT-PLAN-${Date.now()}`,
        nameAr: "IT-PLAN-خطة مشروع اختباري",
        kind: "CONSULTING_ENGAGEMENT",
        billingModel: "TIME_AND_MATERIALS",
        startDate: new Date("2061-01-01T00:00:00.000Z"),
        targetEndDate: new Date("2061-12-31T00:00:00.000Z"),
        createdById: userId,
        updatedById: userId,
      },
    });
    projectInternalId = project.id;
    projectId = project.publicId;
    await prisma!.professionalProjectMember.create({
      data: {
        companyId,
        projectId: project.id,
        userId,
        role: "MANAGER",
        assignedById: userId,
        updatedById: userId,
      },
    });
    planning = new ProfessionalProjectPlanningService(prisma!);
    projects = new ProfessionalProjectService(
      prisma!,
      new ProfessionalCustomerAdapter(prisma!),
      new ProfessionalPeopleAdapter(prisma!),
      new ProfessionalEmployeeAdapter(prisma!),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a stage once under retry and separates planning concurrency", async () => {
    const input = {
      planningVersion: 0,
      nameAr: "التحضير والتحليل",
      plannedStartDate: "2061-02-01",
      targetEndDate: "2061-02-28",
      idempotencyKey: "it-professional-plan-stage-0001",
    };
    const [created, replayed] = await Promise.all([
      planning.createStage(context(), projectId, input),
      planning.createStage(context(), projectId, input),
    ]);
    expect(replayed).toEqual(created);
    expect(created.planningVersion).toBe(1);
    expect(created.stage).toMatchObject({ sequence: 1, status: "PLANNED" });
    stageId = created.stage.id;
    expect(await prisma!.professionalProjectStage.count({ where: { companyId, projectId: projectInternalId } })).toBe(1);
    await expect(planning.createStage(context(), projectId, { ...input, nameAr: "حمولة مختلفة" }))
      .rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });

    const budget = await planning.updateTimeBudget(context(), projectId, { planningVersion: 1, timeBudgetMinutes: 600 });
    expect(budget).toEqual({ project: { projectId, timeBudgetMinutes: 600 }, planningVersion: 2 });
    await expect(planning.updateTimeBudget(context(), projectId, { planningVersion: 1, timeBudgetMinutes: 900 }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
  });

  it("builds an acyclic dependency graph and gates task progress", async () => {
    const first = await planning.createTask(context(), stageId, {
      planningVersion: 2,
      titleAr: "جمع المتطلبات",
      assigneeUserId: userId,
      estimatedMinutes: 180,
      plannedStartDate: "2061-02-06",
      dueDate: "2061-02-10",
      idempotencyKey: "it-professional-plan-task-0001",
    });
    firstTaskId = first.task.id;
    const second = await planning.createTask(context(), stageId, {
      planningVersion: 3,
      titleAr: "إعداد المذكرة",
      assigneeUserId: userId,
      estimatedMinutes: 240,
      plannedStartDate: "2061-02-11",
      dueDate: "2061-02-20",
      idempotencyKey: "it-professional-plan-task-0002",
    });
    secondTaskId = second.task.id;
    const dependency = await planning.addDependency(context(), {
      planningVersion: 4,
      predecessorTaskId: firstTaskId,
      successorTaskId: secondTaskId,
      idempotencyKey: "it-professional-plan-dependency-0001",
    });
    dependencyId = dependency.dependency.id;
    expect(dependency.planningVersion).toBe(5);

    await expect(planning.addDependency(context(), {
      planningVersion: 5,
      predecessorTaskId: secondTaskId,
      successorTaskId: firstTaskId,
      idempotencyKey: "it-professional-plan-cycle-0001",
    })).rejects.toMatchObject({ reason: "DEPENDENCY_CYCLE" });

    const stage = await planning.transitionStage(context(), stageId, {
      planningVersion: 5,
      version: 0,
      status: "IN_PROGRESS",
      reason: "بدأ التنفيذ الاختباري",
      idempotencyKey: "it-professional-plan-stage-start-0001",
    });
    expect(stage.planningVersion).toBe(6);
    await expect(planning.transitionTask(context(), secondTaskId, {
      planningVersion: 6,
      version: 0,
      status: "IN_PROGRESS",
      reason: "محاولة قبل السابقة",
      idempotencyKey: "it-professional-plan-successor-early",
    })).rejects.toMatchObject({ reason: "TASK_DEPENDENCIES_INCOMPLETE" });

    const firstStarted = await planning.transitionTask(context(), firstTaskId, {
      planningVersion: 6,
      version: 0,
      status: "IN_PROGRESS",
      reason: "بدء جمع المتطلبات",
      idempotencyKey: "it-professional-plan-first-start",
    });
    const firstCompleted = await planning.transitionTask(context(), firstTaskId, {
      planningVersion: firstStarted.planningVersion,
      version: firstStarted.task.version,
      status: "COMPLETED",
      reason: "اكتملت المتطلبات",
      idempotencyKey: "it-professional-plan-first-complete",
    });
    const secondStarted = await planning.transitionTask(context(), secondTaskId, {
      planningVersion: firstCompleted.planningVersion,
      version: 0,
      status: "IN_PROGRESS",
      reason: "بدأ إعداد المذكرة",
      idempotencyKey: "it-professional-plan-second-start",
    });
    expect(secondStarted.task.status).toBe("IN_PROGRESS");
  });

  it("derives allocated, unallocated, and approved time without storing actuals", async () => {
    const linked = await projects.createTimeEntry(context(), {
      projectId,
      taskId: secondTaskId,
      workDate: "2061-02-11",
      minutes: 60,
      isBillable: true,
      description: "وقت مرتبط بالمهمة الجارية",
      idempotencyKey: "it-professional-plan-time-linked",
    });
    expect(linked.timeEntry.task?.id).toBe(secondTaskId);
    const invalidTime = {
      projectId,
      workDate: "2061-02-11",
      minutes: 15,
      isBillable: true,
      description: "وقت يجب رفضه",
    };
    await expect(projects.createTimeEntry(context(), {
      ...invalidTime,
      taskId: firstTaskId,
      idempotencyKey: "it-professional-plan-time-completed-task",
    })).rejects.toMatchObject({ reason: "TASK_INACTIVE" });
    await expect(projects.createTimeEntry(context(), {
      ...invalidTime,
      taskId: "00000000-0000-4000-8000-000000000000",
      idempotencyKey: "it-professional-plan-time-missing-task",
    })).rejects.toMatchObject({ reason: "TASK_NOT_FOUND" });
    await prisma!.professionalTimeEntry.create({
      data: {
        companyId,
        projectId: projectInternalId,
        userId,
        workDate: new Date("2061-02-08T00:00:00.000Z"),
        minutes: 30,
        isBillable: false,
        description: "وقت عام غير مخطط",
      },
    });
    await prisma!.professionalTimesheet.create({
      data: {
        companyId,
        userId,
        periodStart: new Date("2061-02-06T00:00:00.000Z"),
        periodEnd: new Date("2061-02-12T00:00:00.000Z"),
        status: "APPROVED",
        lastSubmissionNumber: 1,
        activeSubmissionNumber: 1,
        activeSnapshotHashSha256: new Uint8Array(32),
        submittedAt: new Date("2061-02-12T12:00:00.000Z"),
      },
    });
    const plan = await planning.getPlan(context(), projectId);
    expect(plan.summary).toMatchObject({
      timeBudgetMinutes: 600,
      estimatedMinutes: 420,
      actualMinutes: 90,
      approvedMinutes: 90,
      allocatedActualMinutes: 60,
      unallocatedActualMinutes: 30,
      remainingBudgetMinutes: 510,
      overBudgetMinutes: 0,
    });
    expect(plan.stages[0]!.tasks.find((task) => task.id === secondTaskId)).toMatchObject({ actualMinutes: 60, approvedMinutes: 60 });
    await expect(planning.getPlan({ companyId: 9_223_372_036_854_775_000n, userId }, projectId))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    const taskColumns = Object.keys(await prisma!.professionalProjectTask.findFirstOrThrow({ where: { publicId: secondTaskId } }));
    expect(taskColumns).not.toContain("actualMinutes");
  });

  it("retains dependency history and closes the work breakdown explicitly", async () => {
    const current = await planning.getPlan(context(), projectId);
    const second = current.stages[0]!.tasks.find((task) => task.id === secondTaskId)!;
    const removed = await planning.removeDependency(context(), dependencyId, {
      planningVersion: current.planningVersion,
      version: 0,
      reason: "لم تعد السابقة مطلوبة",
      idempotencyKey: "it-professional-plan-dependency-remove",
    });
    expect(removed.dependency).toMatchObject({ isActive: false, version: 1 });
    expect(await prisma!.professionalTaskDependency.count({ where: { publicId: dependencyId, companyId } })).toBe(1);
    await expect(planning.transitionStage(context(), stageId, {
      planningVersion: removed.planningVersion,
      version: 1,
      status: "COMPLETED",
      reason: "محاولة إغلاق مبكرة",
      idempotencyKey: "it-professional-plan-stage-early-complete",
    })).rejects.toMatchObject({ reason: "STAGE_TASKS_INCOMPLETE" });

    const completed = await planning.transitionTask(context(), secondTaskId, {
      planningVersion: removed.planningVersion,
      version: second.version,
      status: "COMPLETED",
      reason: "اكتملت المذكرة",
      idempotencyKey: "it-professional-plan-second-complete",
    });
    const stage = await planning.transitionStage(context(), stageId, {
      planningVersion: completed.planningVersion,
      version: 1,
      status: "COMPLETED",
      reason: "اكتملت المرحلة",
      idempotencyKey: "it-professional-plan-stage-complete",
    });
    expect(stage.stage.status).toBe("COMPLETED");
    expect(stage.stage.summary.taskCounts).toMatchObject({ COMPLETED: 2 });
  });
});
