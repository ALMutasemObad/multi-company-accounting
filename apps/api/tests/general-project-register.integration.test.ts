import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { GeneralProjectService } from "../src/general-projects/general-project-service.js";
import { GeneralProjectEmployeeAdapter } from "../src/hr/general-project-employee-adapter.js";
import { GeneralProjectCustomerAdapter } from "../src/sales/general-project-customer-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("general project register on isolated MySQL/MariaDB", () => {
  let service: GeneralProjectService;
  let organizationId: bigint;
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let userId: bigint;
  let managerId: string;
  let contributorId: string;
  let foreignEmployeeId: string;
  let projectId = "";
  const context = () => ({ companyId, userId });

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = admin.id;
    const seededCompany = await prisma!.company.findFirstOrThrow();
    organizationId = (await prisma!.organization.create({ data: { name: `IT-GPR-${randomUUID()}` } })).id;
    companyId = (await prisma!.company.create({ data: { organizationId, baseCurrencyId: seededCompany.baseCurrencyId, name: "IT-GPR-Primary", timezone: "Asia/Riyadh" } })).id;
    foreignCompanyId = (await prisma!.company.create({ data: { organizationId, baseCurrencyId: seededCompany.baseCurrencyId, name: "IT-GPR-Foreign", timezone: "Asia/Riyadh" } })).id;
    await prisma!.userCompany.create({ data: { userId, companyId } });
    await prisma!.userCompany.create({ data: { userId, companyId: foreignCompanyId } });
    const employeeData = { employmentType: "FULL_TIME" as const, hireDate: new Date("2059-01-01T00:00:00.000Z"), createdById: userId, updatedById: userId };
    managerId = (await prisma!.employee.create({ data: { ...employeeData, companyId, userId, employeeNumber: "IT-GPR-MANAGER", nameAr: "مدير مشروع اختباري" } })).publicId;
    contributorId = (await prisma!.employee.create({ data: { ...employeeData, companyId, employeeNumber: "IT-GPR-CONTRIBUTOR", nameAr: "مساهم اختباري" } })).publicId;
    foreignEmployeeId = (await prisma!.employee.create({ data: { ...employeeData, companyId: foreignCompanyId, employeeNumber: "IT-GPR-FOREIGN", nameAr: "موظف شركة أخرى" } })).publicId;
    service = new GeneralProjectService(prisma!, new GeneralProjectEmployeeAdapter(prisma!), new GeneralProjectCustomerAdapter(prisma!));
  });

  afterAll(async () => {
    if (!prisma) return;
    const companies = [companyId, foreignCompanyId].filter((value): value is bigint => value !== undefined);
    if (companies.length) {
      await prisma.idempotencyRecord.deleteMany({ where: { companyId: { in: companies }, operation: { in: ["CREATE_GENERAL_PROJECT", "UPDATE_GENERAL_PROJECT", "TRANSITION_GENERAL_PROJECT", "ASSIGN_GENERAL_PROJECT_MEMBER", "UNASSIGN_GENERAL_PROJECT_MEMBER", "CREATE_GENERAL_PROJECT_PHASE", "TRANSITION_GENERAL_PROJECT_PHASE", "CREATE_GENERAL_PROJECT_TASK", "ASSIGN_GENERAL_PROJECT_TASK_MEMBER", "UNASSIGN_GENERAL_PROJECT_TASK_MEMBER", "TRANSITION_GENERAL_PROJECT_TASK", "PROGRESS_GENERAL_PROJECT_TASK", "ADD_GENERAL_PROJECT_TASK_DEPENDENCY", "REMOVE_GENERAL_PROJECT_TASK_DEPENDENCY", "FOLLOW_GENERAL_PROJECT", "UNFOLLOW_GENERAL_PROJECT", "COMMENT_GENERAL_PROJECT"] } } });
      await prisma.auditLog.deleteMany({ where: { companyId: { in: companies }, entityType: "GENERAL_PROJECT" } });
      await prisma.generalProjectTaskAssignment.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectComment.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectTaskDependency.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectFollower.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectTask.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectPhase.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProjectMember.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.generalProject.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.employee.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.userCompany.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.company.deleteMany({ where: { id: { in: companies } } });
    }
    if (organizationId !== undefined) await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates a project once under replay, with an optional customer and GPR code", async () => {
    const input = { nameAr: "IT-GPR-مشروع عام", managerEmployeeId: managerId, idempotencyKey: "it-general-project-create-0001" };
    const [first, replay] = await Promise.all([service.createProject(context(), input), service.createProject(context(), input)]);
    expect(replay).toEqual(first);
    expect(first.project.code).toMatch(/^GPR-\d{6}$/u);
    expect(first.project.customer).toBeNull();
    projectId = first.project.id;
    expect(await prisma!.generalProject.count({ where: { companyId, publicId: projectId } })).toBe(1);
    await expect(service.createProject(context(), { ...input, nameAr: "Changed" })).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });

  it("isolates references and projects between companies", async () => {
    await expect(service.createProject(context(), { nameAr: "Foreign manager", managerEmployeeId: foreignEmployeeId, idempotencyKey: "it-general-project-foreign-0001" }))
      .rejects.toMatchObject({ reason: "EMPLOYEE_INACTIVE" });
    await expect(service.getProject({ companyId: foreignCompanyId, userId }, projectId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });

  it("keeps one active manager and enforces versioned transitions", async () => {
    const assigned = await service.assignMember(context(), projectId, { version: 0, employeeId: contributorId, role: "CONTRIBUTOR", idempotencyKey: "it-general-project-assign-0001" });
    expect(assigned.projectVersion).toBe(1);
    await expect(service.assignMember(context(), projectId, { version: 0, employeeId: contributorId, role: "MANAGER", idempotencyKey: "it-general-project-assign-stale-0001" }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    const active = await service.transition(context(), projectId, { version: 1, status: "ACTIVE", idempotencyKey: "it-general-project-active-0001" });
    expect(active.project.status).toBe("ACTIVE");
    const manager = (await service.getProject(context(), projectId)).members.find(member => member.role === "MANAGER")!;
    await expect(service.unassignMember(context(), projectId, manager.id, { version: 2, reason: "Project role handover", idempotencyKey: "it-general-project-unassign-last-0001" }))
      .rejects.toMatchObject({ reason: "LAST_MANAGER" });
    const managerTwo = await service.assignMember(context(), projectId, { version: 2, employeeId: contributorId, role: "MANAGER", idempotencyKey: "it-general-project-assign-manager-0001" });
    expect(managerTwo.projectVersion).toBe(3);
    const unassigned = await service.unassignMember(context(), projectId, manager.id, { version: 3, reason: "Project role handover", idempotencyKey: "it-general-project-unassign-manager-0001" });
    expect(unassigned.projectVersion).toBe(4);
    await expect(service.transition(context(), projectId, { version: 4, status: "ON_HOLD", idempotencyKey: "it-general-project-hold-no-reason-0001" }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("versions phase commands, isolates tenants, and keeps phase dates inside project dates", async () => {
    const created = await service.createProject(context(), { nameAr: "مشروع بمراحل", managerEmployeeId: managerId,
      plannedStartDate: "2059-02-01", targetEndDate: "2059-03-01", idempotencyKey: "it-general-project-plan-create-0001" });
    const planId = created.project.id;
    const input = { expectedPlanVersion: 0, title: "مرحلة تخطيط", plannedStartDate: "2059-02-05",
      targetEndDate: "2059-02-20", idempotencyKey: "it-general-project-phase-create-0001" };
    const phase = await service.createPhase(context(), planId, input);
    expect(await service.createPhase(context(), planId, input)).toEqual(phase);
    expect(phase.planVersion).toBe(1);
    expect((await service.listPhases(context(), planId, { page: 1, pageSize: 25 })).data).toHaveLength(1);
    await expect(service.listPhases({ companyId: foreignCompanyId, userId }, planId, { page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.createPhase(context(), planId, { ...input, expectedPlanVersion: 0,
      idempotencyKey: "it-general-project-phase-stale-0001" })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    await expect(service.createPhase(context(), planId, { ...input, expectedPlanVersion: 1,
      plannedStartDate: "2059-03-02", targetEndDate: null, idempotencyKey: "it-general-project-phase-outside-0001" }))
      .rejects.toMatchObject({ reason: "INVALID_DATE_RANGE" });
    await expect(service.updateProject(context(), planId, { version: 0, targetEndDate: "2059-02-15",
      idempotencyKey: "it-general-project-shrink-0001" })).rejects.toMatchObject({ reason: "INVALID_DATE_RANGE" });
    const taskInput = { expectedPlanVersion: 1, title: "مهمة الخطة", plannedStartDate: "2059-02-06",
      dueDate: "2059-02-19", idempotencyKey: "it-general-project-task-create-0001" };
    const task = await service.createTask(context(), planId, phase.phase.id, taskInput);
    expect(await service.createTask(context(), planId, phase.phase.id, taskInput)).toEqual(task);
    expect(task.planVersion).toBe(2);
    expect((await service.listTasks(context(), planId, phase.phase.id, { page: 1, pageSize: 25 })).data).toHaveLength(1);
    await expect(service.listTasks({ companyId: foreignCompanyId, userId }, planId, phase.phase.id, { page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.listTasks(context(), projectId, phase.phase.id, { page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.createTask(context(), projectId, phase.phase.id, { ...taskInput, expectedPlanVersion: 0,
      idempotencyKey: "it-general-project-task-cross-project-0001" })).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.createTask(context(), planId, phase.phase.id, { ...taskInput, expectedPlanVersion: 2,
      dueDate: "2059-02-21", idempotencyKey: "it-general-project-task-outside-0001" }))
      .rejects.toMatchObject({ reason: "INVALID_DATE_RANGE" });
    const active = await service.transition(context(), planId, { version: 0, status: "ACTIVE",
      idempotencyKey: "it-general-project-plan-active-0001" });
    expect(active.project.status).toBe("ACTIVE");
    const started = await service.transitionPhase(context(), planId, phase.phase.id, { expectedPlanVersion: 2,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-phase-start-0001" });
    expect(started.planVersion).toBe(3);
    const managerMember = (await service.getProject(context(), planId)).members.find(member => member.role === "MANAGER")!;
    const assignment = await service.assignTaskMember(context(), planId, task.task.id, { expectedPlanVersion: 3,
      memberId: managerMember.id, role: "RESPONSIBLE", idempotencyKey: "it-general-project-task-assign-0001" });
    expect(assignment.planVersion).toBe(4);
    expect((await service.listTaskAssignments(context(), planId, task.task.id, { page: 1, pageSize: 25 })).data)
      .toEqual([assignment.assignment]);
    await expect(service.assignTaskMember(context(), planId, task.task.id, { expectedPlanVersion: 4,
      memberId: "70fae73c-31f8-4eb7-a097-ade50f0a357e", role: "RESPONSIBLE",
      idempotencyKey: "it-general-project-task-foreign-member-0001" })).rejects.toMatchObject({ reason: "MEMBER_NOT_FOUND" });
    const taskStarted = await service.transitionTask(context(), planId, task.task.id, { expectedPlanVersion: 4,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-task-start-0001" });
    expect(taskStarted.planVersion).toBe(5);
    await expect(service.unassignTaskMember(context(), planId, task.task.id, assignment.assignment.id, {
      expectedPlanVersion: 5, expectedVersion: 0, reason: "Change task owner safely",
      idempotencyKey: "it-general-project-task-unassign-last-0001" })).rejects.toMatchObject({ reason: "ACTIVE_TASK_RESPONSIBILITY" });
    const secondMember = await service.assignMember(context(), planId, { version: 1,
      employeeId: contributorId, role: "CONTRIBUTOR", idempotencyKey: "it-general-project-plan-contributor-0001" });
    const secondAssignment = await service.assignTaskMember(context(), planId, task.task.id, {
      expectedPlanVersion: 5, memberId: secondMember.member.id, role: "RESPONSIBLE",
      idempotencyKey: "it-general-project-task-second-responsible-0001" });
    expect(secondAssignment.planVersion).toBe(6);
    await expect(service.unassignMember(context(), planId, secondMember.member.id, { version: 2,
      reason: "Switch project contributor", idempotencyKey: "it-general-project-unassign-active-0001" }))
      .rejects.toMatchObject({ reason: "ACTIVE_TASK_RESPONSIBILITY" });
    const removed = await service.unassignTaskMember(context(), planId, task.task.id, assignment.assignment.id, {
      expectedPlanVersion: 6, expectedVersion: 0, reason: "Moved responsibility safely",
      idempotencyKey: "it-general-project-task-unassign-first-0001" });
    expect(removed.assignment.isActive).toBe(false);
    expect(removed.planVersion).toBe(7);
    await expect(service.transitionPhase(context(), planId, phase.phase.id, { expectedPlanVersion: 1,
      expectedVersion: 0, to: "COMPLETED", idempotencyKey: "it-general-project-phase-stale-transition-0001" }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    await expect(service.transitionPhase(context(), planId, phase.phase.id, { expectedPlanVersion: 7,
      expectedVersion: 1, to: "COMPLETED", idempotencyKey: "it-general-project-phase-open-task-0001" }))
      .rejects.toMatchObject({ code: "PHASE_WORK_OPEN" });
    const taskFinished = await service.transitionTask(context(), planId, task.task.id, { expectedPlanVersion: 7,
      expectedVersion: 1, to: "COMPLETED", idempotencyKey: "it-general-project-task-complete-0001" });
    expect(taskFinished.planVersion).toBe(8);
    const finished = await service.transitionPhase(context(), planId, phase.phase.id, { expectedPlanVersion: 8,
      expectedVersion: 1, to: "COMPLETED", idempotencyKey: "it-general-project-phase-complete-0001" });
    expect(finished.phase.status).toBe("COMPLETED");
  });

  it("allows progress only for the active responsible employee, independently of project management", async () => {
    const project = await service.createProject(context(), { nameAr: "مشروع التقدم", managerEmployeeId: managerId,
      idempotencyKey: "it-general-project-progress-create-0001" });
    const id = project.project.id;
    const phase = await service.createPhase(context(), id, { expectedPlanVersion: 0, title: "مرحلة عمل",
      idempotencyKey: "it-general-project-progress-phase-0001" });
    const task = await service.createTask(context(), id, phase.phase.id, { expectedPlanVersion: 1, title: "مهمة مسؤول",
      idempotencyKey: "it-general-project-progress-task-0001" });
    await service.transition(context(), id, { version: 0, status: "ACTIVE",
      idempotencyKey: "it-general-project-progress-active-0001" });
    await service.transitionPhase(context(), id, phase.phase.id, { expectedPlanVersion: 2, expectedVersion: 0,
      to: "IN_PROGRESS", idempotencyKey: "it-general-project-progress-phase-start-0001" });
    const manager = (await service.getProject(context(), id)).members.find(member => member.role === "MANAGER")!;
    await service.assignTaskMember(context(), id, task.task.id, { expectedPlanVersion: 3, memberId: manager.id,
      role: "RESPONSIBLE", idempotencyKey: "it-general-project-progress-assign-0001" });
    expect((await service.listTasks(context(), id, phase.phase.id, { page: 1, pageSize: 25 })).data[0]?.canProgress).toBe(true);
    const started = await service.transitionTask(context(), id, task.task.id, { expectedPlanVersion: 4,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-progress-start-0001" }, "PROGRESS");
    expect(started.planVersion).toBe(5);
    await expect(service.transitionTask(context(), id, task.task.id, { expectedPlanVersion: 5,
      expectedVersion: 1, to: "CANCELLED", reason: "Cannot finish this work",
      idempotencyKey: "it-general-project-progress-cancel-0001" }, "PROGRESS"))
      .rejects.toMatchObject({ code: "TASK_MANAGE_REQUIRED" });
    const completed = await service.transitionTask(context(), id, task.task.id, { expectedPlanVersion: 5,
      expectedVersion: 1, to: "COMPLETED", idempotencyKey: "it-general-project-progress-complete-0001" }, "PROGRESS");
    expect(completed.task.status).toBe("COMPLETED");
    const unassigned = await service.createTask(context(), id, phase.phase.id, { expectedPlanVersion: 6,
      title: "مهمة غير مسندة", idempotencyKey: "it-general-project-progress-unassigned-0001" });
    expect((await service.listTasks(context(), id, phase.phase.id, { page: 1, pageSize: 25 })).data
      .find(row => row.id === unassigned.task.id)?.canProgress).toBe(false);
    await expect(service.transitionTask(context(), id, unassigned.task.id, { expectedPlanVersion: 7,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-progress-denied-0001" }, "PROGRESS"))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
  });

  it("blocks a successor, rejects cycles and recovers after a predecessor is cancelled", async () => {
    const created = await service.createProject(context(), { nameAr: "مشروع اعتمادية", managerEmployeeId: managerId,
      idempotencyKey: "it-general-project-dependency-create-0001" });
    const id = created.project.id;
    const phase = await service.createPhase(context(), id, { expectedPlanVersion: 0, title: "مرحلة مترابطة",
      idempotencyKey: "it-general-project-dependency-phase-0001" });
    const a = await service.createTask(context(), id, phase.phase.id, { expectedPlanVersion: 1,
      title: "السابقة", idempotencyKey: "it-general-project-dependency-a-0001" });
    const b = await service.createTask(context(), id, phase.phase.id, { expectedPlanVersion: 2,
      title: "التابعة", idempotencyKey: "it-general-project-dependency-b-0001" });
    await service.transition(context(), id, { version: 0, status: "ACTIVE",
      idempotencyKey: "it-general-project-dependency-active-0001" });
    await service.transitionPhase(context(), id, phase.phase.id, { expectedPlanVersion: 3,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-dependency-phase-start-0001" });
    const manager = (await service.getProject(context(), id)).members.find(member => member.role === "MANAGER")!;
    await service.assignTaskMember(context(), id, b.task.id, { expectedPlanVersion: 4,
      memberId: manager.id, role: "RESPONSIBLE", idempotencyKey: "it-general-project-dependency-assign-0001" });
    const link = await service.addDependency(context(), id, { expectedPlanVersion: 5,
      predecessorTaskId: a.task.id, successorTaskId: b.task.id,
      idempotencyKey: "it-general-project-dependency-link-0001" });
    expect(link.planVersion).toBe(6);
    expect((await service.listTasks(context(), id, phase.phase.id, { page: 1, pageSize: 25 })).data
      .find(row => row.id === b.task.id)?.dependencyBlocked).toBe(true);
    await expect(service.transitionTask(context(), id, b.task.id, { expectedPlanVersion: 6,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-dependency-blocked-0001" }, "PROGRESS"))
      .rejects.toMatchObject({ code: "DEPENDENCY_BLOCKED" });
    await expect(service.addDependency(context(), id, { expectedPlanVersion: 6,
      predecessorTaskId: b.task.id, successorTaskId: a.task.id,
      idempotencyKey: "it-general-project-dependency-cycle-0001" }))
      .rejects.toMatchObject({ code: "DEPENDENCY_CYCLE" });
    await service.transitionTask(context(), id, a.task.id, { expectedPlanVersion: 6, expectedVersion: 0,
      to: "CANCELLED", reason: "Previous work cancelled", idempotencyKey: "it-general-project-dependency-cancel-a-0001" });
    const removed = await service.removeDependency(context(), id, link.dependency.id, {
      expectedPlanVersion: 7, expectedVersion: 0, reason: "Recover after cancellation",
      idempotencyKey: "it-general-project-dependency-remove-0001" });
    expect(removed.dependency.isActive).toBe(false);
    expect(removed.planVersion).toBe(8);
    const started = await service.transitionTask(context(), id, b.task.id, { expectedPlanVersion: 8,
      expectedVersion: 0, to: "IN_PROGRESS", idempotencyKey: "it-general-project-dependency-start-b-0001" }, "PROGRESS");
    expect(started.task.status).toBe("IN_PROGRESS");
  });

  it("keeps following self-owned and comments scoped to a live project task", async () => {
    const created = await service.createProject(context(), { nameAr: "مشروع تعاون",
      managerEmployeeId: managerId, idempotencyKey: "it-general-project-collaboration-create-0001" });
    const id = created.project.id;
    const phase = await service.createPhase(context(), id, { expectedPlanVersion: 0,
      title: "مرحلة التعاون", idempotencyKey: "it-general-project-collaboration-phase-0001" });
    const task = await service.createTask(context(), id, phase.phase.id, { expectedPlanVersion: 1,
      title: "مهمة التعاون", idempotencyKey: "it-general-project-collaboration-task-0001" });
    expect((await service.getProject(context(), id)).isFollowing).toBe(false);
    expect(await service.followProject(context(), id, { idempotencyKey: "it-general-project-follow-0001" }))
      .toEqual({ isFollowing: true });
    expect(await service.followProject(context(), id, { idempotencyKey: "it-general-project-follow-0001" }))
      .toEqual({ isFollowing: true });
    expect((await service.listProjects(context(), { page: 1, pageSize: 25,
      scope: "FOLLOWING" })).data.some(project => project.id === id)).toBe(true);
    const comment = await service.addComment(context(), id, { taskId: task.task.id,
      body: "  Ready to coordinate  ", idempotencyKey: "it-general-project-comment-0001" });
    const replayed = await service.addComment(context(), id, { taskId: task.task.id,
      body: "  Ready to coordinate  ", idempotencyKey: "it-general-project-comment-0001" });
    expect(replayed.comment.id).toBe(comment.comment.id);
    const listed = await service.listComments(context(), id, { page: 1, pageSize: 25, taskId: task.task.id });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({ taskId: task.task.id, body: "Ready to coordinate" });
    const other = await service.createProject(context(), { nameAr: "مشروع تعاون آخر",
      managerEmployeeId: managerId, idempotencyKey: "it-general-project-collaboration-other-0001" });
    const otherPhase = await service.createPhase(context(), other.project.id, { expectedPlanVersion: 0,
      title: "مرحلة أخرى", idempotencyKey: "it-general-project-collaboration-other-phase-0001" });
    const otherTask = await service.createTask(context(), other.project.id, otherPhase.phase.id, {
      expectedPlanVersion: 1, title: "مهمة أخرى", idempotencyKey: "it-general-project-collaboration-other-task-0001" });
    await expect(service.addComment(context(), id, { taskId: otherTask.task.id,
      body: "Must not cross projects", idempotencyKey: "it-general-project-comment-cross-0001" }))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    await service.transition(context(), id, { version: 0, status: "ACTIVE",
      idempotencyKey: "it-general-project-collaboration-active-0001" });
    await service.transitionTask(context(), id, task.task.id, { expectedPlanVersion: 2,
      expectedVersion: 0, to: "CANCELLED", reason: "Task is no longer needed",
      idempotencyKey: "it-general-project-collaboration-task-cancel-0001" });
    await expect(service.addComment(context(), id, { taskId: task.task.id,
      body: "Cannot comment on final task", idempotencyKey: "it-general-project-comment-final-task-0001" }))
      .rejects.toMatchObject({ reason: "PROJECT_FINAL" });
    expect(await service.unfollowProject(context(), id, { idempotencyKey: "it-general-project-unfollow-0001" }))
      .toEqual({ isFollowing: false });
    expect((await service.getProject(context(), id)).isFollowing).toBe(false);
    await expect(service.listComments({ companyId: foreignCompanyId, userId }, id,
      { page: 1, pageSize: 25 })).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await service.followProject(context(), other.project.id,
      { idempotencyKey: "it-general-project-follow-final-0001" });
    await service.transition(context(), other.project.id, { version: 0, status: "CANCELLED",
      reason: "Project no longer needed", idempotencyKey: "it-general-project-cancel-final-0001" });
    await expect(service.addComment(context(), other.project.id, { body: "No new comments",
      idempotencyKey: "it-general-project-comment-final-project-0001" }))
      .rejects.toMatchObject({ reason: "PROJECT_FINAL" });
    await expect(service.followProject(context(), other.project.id,
      { idempotencyKey: "it-general-project-follow-again-final-0001" }))
      .rejects.toMatchObject({ reason: "PROJECT_FINAL" });
    expect(await service.unfollowProject(context(), other.project.id,
      { idempotencyKey: "it-general-project-unfollow-final-0001" }))
      .toEqual({ isFollowing: false });
  });

  it("refuses completion while a phase or task is open", async () => {
    const project = await prisma!.generalProject.findFirstOrThrow({ where: { companyId, publicId: projectId } });
    const phase = await prisma!.generalProjectPhase.create({ data: {
      companyId, projectId: project.id, sequence: 1, title: "مرحلة تنفيذ", createdById: userId, updatedById: userId,
    } });
    const task = await prisma!.generalProjectTask.create({ data: {
      companyId, projectId: project.id, phaseId: phase.id, sequence: 1, title: "مهمة تنفيذ", createdById: userId, updatedById: userId,
    } });
    const input = { version: project.version, status: "COMPLETED" as const, idempotencyKey: "it-general-project-complete-0001" };
    await expect(service.transition(context(), projectId, input)).rejects.toMatchObject({ code: "PROJECT_WORK_OPEN" });
    await prisma!.generalProjectTask.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
    await expect(service.transition(context(), projectId, { ...input, idempotencyKey: "it-general-project-complete-0002" }))
      .rejects.toMatchObject({ code: "PROJECT_WORK_OPEN" });
    await prisma!.generalProjectPhase.update({ where: { id: phase.id }, data: { status: "COMPLETED" } });
    const completed = await service.transition(context(), projectId, { ...input, idempotencyKey: "it-general-project-complete-0003" });
    expect(completed.project.status).toBe("COMPLETED");
  });
});
