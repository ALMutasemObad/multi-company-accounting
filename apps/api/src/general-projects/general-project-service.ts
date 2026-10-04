import { Prisma, type GeneralProject, type GeneralProjectMember, type GeneralProjectPhase, type GeneralProjectTask, type GeneralProjectTaskAssignment, type GeneralProjectTaskDependency, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { transitionPhase, transitionProject, transitionTask, validateDependencyAddition, validateDependencyRemoval } from "./general-project-policy.js";
import type { GeneralProjectCustomerPort, GeneralProjectCustomerReference, GeneralProjectEmployeePort, GeneralProjectEmployeeReference } from "./general-project-reference-ports.js";

export type GeneralProjectFailureReason = "NOT_FOUND" | "CUSTOMER_NOT_FOUND" | "CUSTOMER_INACTIVE" | "EMPLOYEE_NOT_FOUND" | "EMPLOYEE_INACTIVE" | "INVALID_DATE_RANGE" | "INVALID_REASON" | "PROJECT_FINAL" | "LAST_MANAGER" | "MEMBER_NOT_FOUND" | "ASSIGNMENT_NOT_FOUND" | "ACTIVE_TASK_RESPONSIBILITY" | "VERSION_CONFLICT" | "IDEMPOTENCY_MISMATCH" | "IDEMPOTENCY_IN_PROGRESS";
export class GeneralProjectError extends Error {
  constructor(readonly reason: GeneralProjectFailureReason) { super(reason); }
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const customerJson = (row: GeneralProjectCustomerReference) => ({ id: row.id.toString(), code: row.code, nameAr: row.nameAr, nameEn: row.nameEn, isActive: row.isActive });
const employeeJson = (row: GeneralProjectEmployeeReference) => ({ id: row.publicId, employeeNumber: row.employeeNumber, nameAr: row.nameAr, nameEn: row.nameEn, status: row.status });
const projectJson = (row: GeneralProject, customer: GeneralProjectCustomerReference | null, memberCount: number) => ({
  id: row.publicId, code: row.code, nameAr: row.nameAr, nameEn: row.nameEn, description: row.description,
  status: row.status, priority: row.priority, customer: customer ? customerJson(customer) : null,
  plannedStartDate: dateOnly(row.plannedStartDate), targetEndDate: dateOnly(row.targetEndDate),
  memberCount, version: row.version, planVersion: row.planVersion,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const memberJson = (row: GeneralProjectMember, employee: GeneralProjectEmployeeReference) => ({
  id: row.publicId, employee: employeeJson(employee), role: row.role, isActive: row.isActive,
  version: row.version, assignedAt: row.assignedAt.toISOString(), unassignedAt: row.unassignedAt?.toISOString() ?? null,
});
const phaseJson = (row: GeneralProjectPhase) => ({
  id: row.publicId, sequence: row.sequence, title: row.title, description: row.description,
  plannedStartDate: dateOnly(row.plannedStartDate), targetEndDate: dateOnly(row.targetEndDate),
  status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const taskJson = (row: GeneralProjectTask) => ({
  id: row.publicId, sequence: row.sequence, title: row.title, description: row.description,
  priority: row.priority, plannedStartDate: dateOnly(row.plannedStartDate), dueDate: dateOnly(row.dueDate),
  status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const assignmentJson = (row: GeneralProjectTaskAssignment, memberPublicId: string) => ({
  id: row.publicId, memberId: memberPublicId, role: row.role, isActive: row.isActive,
  version: row.version, assignedAt: row.assignedAt.toISOString(), unassignedAt: row.unassignedAt?.toISOString() ?? null,
});
const dependencyJson = (row: GeneralProjectTaskDependency, predecessorTaskId: string, successorTaskId: string,
  predecessorTitle: string, successorTitle: string) => ({
  id: row.publicId, predecessorTaskId, successorTaskId, predecessorTitle, successorTitle,
  isActive: row.isActive, version: row.version,
  createdAt: row.createdAt.toISOString(), removedAt: row.removedAt?.toISOString() ?? null,
  removalReason: row.removalReason,
});
const mutable = (status: GeneralProject["status"]) => status !== "COMPLETED" && status !== "CANCELLED";

export class GeneralProjectService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(private readonly prisma: PrismaClient, private readonly employees: GeneralProjectEmployeePort, private readonly customers: GeneralProjectCustomerPort) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async listProjects(context: ActorContext, input: { page: number; pageSize: number; search?: string | undefined; status?: GeneralProject["status"] | undefined; priority?: GeneralProject["priority"] | undefined; customerId?: bigint | undefined; scope?: "ALL" | "MINE" | undefined }) {
    const where: Prisma.GeneralProjectWhereInput = { companyId: context.companyId,
      ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
      ...(input.status ? { status: input.status } : {}), ...(input.priority ? { priority: input.priority } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
    };
    if (input.scope === "MINE") {
      const employee = await this.employees.findByUserInCompany(context.companyId, context.userId);
      if (!employee) return { data: [], meta: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 } };
      where.members = { some: { companyId: context.companyId, employeeId: employee.id, isActive: true } };
    }
    const { rows, total, counts } = await this.prisma.$transaction(async tx => {
      const [rows, total] = await Promise.all([
        tx.generalProject.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        tx.generalProject.count({ where }),
      ]);
      const counts = rows.length ? await tx.generalProjectMember.groupBy({ by: ["projectId"], where: { companyId: context.companyId, projectId: { in: rows.map(row => row.id) }, isActive: true }, _count: { _all: true } }) : [];
      return { rows, total, counts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const customerMap = await this.customerMap(context.companyId, rows.flatMap(row => row.customerId === null ? [] : [row.customerId]));
    const countMap = new Map(counts.map(row => [row.projectId, row._count._all]));
    return { data: rows.map(row => projectJson(row, row.customerId === null ? null : customerMap.get(row.customerId) ?? null, countMap.get(row.id) ?? 0)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  async getProject(context: ActorContext, publicId: string) {
    const result = await this.prisma.$transaction(async tx => {
      const project = await tx.generalProject.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!project) throw new GeneralProjectError("NOT_FOUND");
      const members = await tx.generalProjectMember.findMany({ where: { companyId: context.companyId, projectId: project.id }, orderBy: [{ isActive: "desc" }, { role: "asc" }, { id: "asc" }] });
      return { project, members };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const [customers, employees] = await Promise.all([
      this.customerMap(context.companyId, result.project.customerId === null ? [] : [result.project.customerId]),
      this.employeeMap(context.companyId, result.members.map(row => row.employeeId)),
    ]);
    return { project: projectJson(result.project, result.project.customerId === null ? null : customers.get(result.project.customerId) ?? null, result.members.filter(row => row.isActive).length),
      members: result.members.map(row => { const employee = employees.get(row.employeeId); if (!employee) throw new GeneralProjectError("EMPLOYEE_NOT_FOUND"); return memberJson(row, employee); }) };
  }

  async listCustomerOptions(context: ActorContext, search?: string) { return { data: (await this.customers.listActiveInCompany(context.companyId, search)).map(customerJson) }; }
  async listEmployeeOptions(context: ActorContext, search?: string) { return { data: (await this.employees.listActiveInCompany(context.companyId, search)).map(employeeJson) }; }

  async listPhases(context: ActorContext, projectPublicId: string, input: { page: number; pageSize: number }) {
    const { project, rows, total } = await this.prisma.$transaction(async tx => {
      const project = await tx.generalProject.findFirst({ where: { companyId: context.companyId, publicId: projectPublicId }, select: { id: true, planVersion: true } });
      if (!project) throw new GeneralProjectError("NOT_FOUND");
      const where: Prisma.GeneralProjectPhaseWhereInput = { companyId: context.companyId, projectId: project.id };
      const [rows, total] = await Promise.all([
        tx.generalProjectPhase.findMany({ where, orderBy: [{ sequence: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        tx.generalProjectPhase.count({ where }),
      ]);
      return { project, rows, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: rows.map(phaseJson), planVersion: project.planVersion,
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  createPhase(context: ActorContext, projectPublicId: string, input: { expectedPlanVersion: number; title: string; description?: string | null;
    plannedStartDate?: string | null; targetEndDate?: string | null; idempotencyKey: string }) {
    return this.command(context, "CREATE_GENERAL_PROJECT_PHASE", input.idempotencyKey, { projectPublicId, ...input }, 201, async tx => {
      const project = await this.lockProject(tx, context, projectPublicId);
      if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
      if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
      this.validatePlanDates(input.plannedStartDate ?? null, input.targetEndDate ?? null,
        dateOnly(project.plannedStartDate), dateOnly(project.targetEndDate));
      const last = await tx.generalProjectPhase.aggregate({ where: { companyId: context.companyId, projectId: project.id }, _max: { sequence: true } });
      const sequence = (last._max.sequence ?? 0) + 1;
      const row = await tx.generalProjectPhase.create({ data: { companyId: context.companyId, projectId: project.id,
        sequence, title: input.title, description: input.description ?? null,
        plannedStartDate: input.plannedStartDate ? day(input.plannedStartDate) : null,
        targetEndDate: input.targetEndDate ? day(input.targetEndDate) : null,
        createdById: context.userId, updatedById: context.userId } });
      await this.bumpPlanVersion(tx, context, project);
      await this.audit(tx, context, "GENERAL_PROJECT_PHASE_CREATED", projectPublicId,
        { phaseId: row.publicId, expectedPlanVersion: input.expectedPlanVersion, nextPlanVersion: project.planVersion + 1 });
      return { phase: phaseJson(row), planVersion: project.planVersion + 1 };
    });
  }

  transitionPhase(context: ActorContext, projectPublicId: string, phasePublicId: string, input: {
    expectedPlanVersion: number; expectedVersion: number; to: GeneralProjectPhase["status"]; reason?: string; idempotencyKey: string;
  }) {
    return this.command(context, "TRANSITION_GENERAL_PROJECT_PHASE", input.idempotencyKey,
      { projectPublicId, phasePublicId, ...input }, 200, async tx => {
        const project = await this.lockProject(tx, context, projectPublicId);
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const current = await tx.generalProjectPhase.findFirst({ where: { companyId: context.companyId, projectId: project.id, publicId: phasePublicId } });
        if (!current) throw new GeneralProjectError("NOT_FOUND");
        if (current.version !== input.expectedVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const tasks = await tx.generalProjectTask.findMany({ where: { companyId: context.companyId, projectId: project.id, phaseId: current.id }, select: { status: true } });
        const next = transitionPhase({ projectStatus: project.status, from: current.status, to: input.to,
          taskStatuses: tasks.map(row => row.status), ...(input.reason === undefined ? {} : { reason: input.reason }) });
        const changed = await tx.generalProjectPhase.updateMany({ where: { id: current.id, companyId: context.companyId,
          projectId: project.id, version: input.expectedVersion, status: current.status },
        data: { status: next, version: { increment: 1 }, updatedById: context.userId } });
        if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
        await this.bumpPlanVersion(tx, context, project);
        const row = await tx.generalProjectPhase.findUniqueOrThrow({ where: { id: current.id } });
        await this.audit(tx, context, "GENERAL_PROJECT_PHASE_TRANSITIONED", projectPublicId,
          { phaseId: row.publicId, from: current.status, to: next, reason: input.reason ?? null,
            expectedPlanVersion: input.expectedPlanVersion, nextPlanVersion: project.planVersion + 1 });
        return { phase: phaseJson(row), planVersion: project.planVersion + 1 };
      });
  }

  async listTasks(context: ActorContext, projectPublicId: string, phasePublicId: string, input: { page: number; pageSize: number }) {
    const { project, rows, total, assignedTaskIds, dependencyBlockedIds } = await this.prisma.$transaction(async tx => {
      const project = await tx.generalProject.findFirst({ where: { companyId: context.companyId, publicId: projectPublicId },
        select: { id: true, planVersion: true } });
      if (!project) throw new GeneralProjectError("NOT_FOUND");
      const phase = await tx.generalProjectPhase.findFirst({ where: { companyId: context.companyId, projectId: project.id,
        publicId: phasePublicId }, select: { id: true } });
      if (!phase) throw new GeneralProjectError("NOT_FOUND");
      const where: Prisma.GeneralProjectTaskWhereInput = { companyId: context.companyId, projectId: project.id, phaseId: phase.id };
      const [rows, total] = await Promise.all([
        tx.generalProjectTask.findMany({ where, orderBy: [{ sequence: "asc" }, { id: "asc" }],
          skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        tx.generalProjectTask.count({ where }),
      ]);
      const actorEmployee = await this.employees.findByUserInCompanyTx(tx, context.companyId, context.userId);
      const assignedTaskIds = actorEmployee?.status === "ACTIVE" && rows.length
        ? (await tx.generalProjectTaskAssignment.findMany({ where: { companyId: context.companyId,
          projectId: project.id, taskId: { in: rows.map(row => row.id) }, role: "RESPONSIBLE", isActive: true,
          member: { companyId: context.companyId, projectId: project.id,
            employeeId: actorEmployee.id, isActive: true } }, select: { taskId: true } })).map(row => row.taskId)
        : [];
      const dependencyBlockedIds = rows.length
        ? (await tx.generalProjectTaskDependency.findMany({ where: { companyId: context.companyId,
          projectId: project.id, successorTaskId: { in: rows.map(row => row.id) }, isActive: true,
          predecessorTask: { status: { not: "COMPLETED" } } }, select: { successorTaskId: true } }))
          .map(row => row.successorTaskId)
        : [];
      return { project, rows, total, assignedTaskIds, dependencyBlockedIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const assigned = new Set(assignedTaskIds);
    const blocked = new Set(dependencyBlockedIds);
    return { data: rows.map(row => ({ ...taskJson(row), canProgress: assigned.has(row.id),
      dependencyBlocked: blocked.has(row.id) })), planVersion: project.planVersion,
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  async listTaskOptions(context: ActorContext, projectPublicId: string, search?: string) {
    const project = await this.prisma.generalProject.findFirst({ where: { companyId: context.companyId,
      publicId: projectPublicId }, select: { id: true } });
    if (!project) throw new GeneralProjectError("NOT_FOUND");
    const rows = await this.prisma.generalProjectTask.findMany({ where: { companyId: context.companyId,
      projectId: project.id, ...(search ? { title: { contains: search } } : {}) },
      select: { publicId: true, title: true, status: true, sequence: true,
        phase: { select: { title: true, sequence: true } } },
      orderBy: [{ phase: { sequence: "asc" } }, { sequence: "asc" }, { id: "asc" }], take: 100 });
    return { data: rows.map(row => ({ id: row.publicId, title: row.title, status: row.status,
      sequence: row.sequence, phaseTitle: row.phase.title, phaseSequence: row.phase.sequence })) };
  }

  createTask(context: ActorContext, projectPublicId: string, phasePublicId: string, input: { expectedPlanVersion: number;
    title: string; description?: string | null; priority?: GeneralProjectTask["priority"];
    plannedStartDate?: string | null; dueDate?: string | null; idempotencyKey: string }) {
    return this.command(context, "CREATE_GENERAL_PROJECT_TASK", input.idempotencyKey,
      { projectPublicId, phasePublicId, ...input }, 201, async tx => {
        const project = await this.lockProject(tx, context, projectPublicId);
        if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const phase = await tx.generalProjectPhase.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, publicId: phasePublicId } });
        if (!phase) throw new GeneralProjectError("NOT_FOUND");
        if (phase.status === "COMPLETED" || phase.status === "CANCELLED") throw new GeneralProjectError("PROJECT_FINAL");
        this.validatePlanDates(input.plannedStartDate ?? null, input.dueDate ?? null,
          dateOnly(project.plannedStartDate), dateOnly(project.targetEndDate));
        this.validatePlanDates(input.plannedStartDate ?? null, input.dueDate ?? null,
          dateOnly(phase.plannedStartDate), dateOnly(phase.targetEndDate));
        const last = await tx.generalProjectTask.aggregate({ where: { companyId: context.companyId,
          projectId: project.id, phaseId: phase.id }, _max: { sequence: true } });
        const row = await tx.generalProjectTask.create({ data: { companyId: context.companyId, projectId: project.id,
          phaseId: phase.id, sequence: (last._max.sequence ?? 0) + 1, title: input.title,
          description: input.description ?? null, priority: input.priority ?? "NORMAL",
          plannedStartDate: input.plannedStartDate ? day(input.plannedStartDate) : null,
          dueDate: input.dueDate ? day(input.dueDate) : null,
          createdById: context.userId, updatedById: context.userId } });
        await this.bumpPlanVersion(tx, context, project);
        await this.audit(tx, context, "GENERAL_PROJECT_TASK_CREATED", projectPublicId,
          { phaseId: phasePublicId, taskId: row.publicId, nextPlanVersion: project.planVersion + 1 });
        return { task: taskJson(row), planVersion: project.planVersion + 1 };
      });
  }

  async listTaskAssignments(context: ActorContext, projectPublicId: string, taskPublicId: string,
    input: { page: number; pageSize: number }) {
    const { project, rows, total } = await this.prisma.$transaction(async tx => {
      const project = await tx.generalProject.findFirst({ where: { companyId: context.companyId, publicId: projectPublicId },
        select: { id: true, planVersion: true } });
      if (!project) throw new GeneralProjectError("NOT_FOUND");
      const task = await tx.generalProjectTask.findFirst({ where: { companyId: context.companyId, projectId: project.id,
        publicId: taskPublicId }, select: { id: true } });
      if (!task) throw new GeneralProjectError("NOT_FOUND");
      const where: Prisma.GeneralProjectTaskAssignmentWhereInput = { companyId: context.companyId, projectId: project.id,
        taskId: task.id };
      const [rows, total] = await Promise.all([
        tx.generalProjectTaskAssignment.findMany({ where, include: { member: { select: { publicId: true } } },
          orderBy: [{ assignedAt: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        tx.generalProjectTaskAssignment.count({ where }),
      ]);
      return { project, rows, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: rows.map(row => assignmentJson(row, row.member.publicId)), planVersion: project.planVersion,
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  assignTaskMember(context: ActorContext, projectPublicId: string, taskPublicId: string, input: {
    expectedPlanVersion: number; memberId: string; role: GeneralProjectTaskAssignment["role"]; idempotencyKey: string;
  }) {
    return this.command(context, "ASSIGN_GENERAL_PROJECT_TASK_MEMBER", input.idempotencyKey,
      { projectPublicId, taskPublicId, ...input }, 200, async tx => {
        const projectReference = await tx.generalProject.findFirst({ where: { companyId: context.companyId,
          publicId: projectPublicId }, select: { id: true } });
        if (!projectReference) throw new GeneralProjectError("NOT_FOUND");
        const memberReference = await tx.generalProjectMember.findFirst({ where: { companyId: context.companyId,
          projectId: projectReference.id, publicId: input.memberId }, select: { id: true, employeeId: true } });
        if (!memberReference) throw new GeneralProjectError("MEMBER_NOT_FOUND");
        const employeeReference = await this.employees.findByInternalIdInCompany(tx, context.companyId,
          memberReference.employeeId);
        if (!employeeReference || !(await this.employees.lockActiveInCompany(tx, context.companyId,
          employeeReference.publicId))) throw new GeneralProjectError("EMPLOYEE_INACTIVE");
        const project = await this.lockProject(tx, context, projectPublicId);
        if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const task = await tx.generalProjectTask.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, publicId: taskPublicId } });
        if (!task) throw new GeneralProjectError("NOT_FOUND");
        if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new GeneralProjectError("PROJECT_FINAL");
        const member = await tx.generalProjectMember.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, id: memberReference.id, employeeId: memberReference.employeeId,
          publicId: input.memberId, isActive: true } });
        if (!member) throw new GeneralProjectError("MEMBER_NOT_FOUND");
        const existing = await tx.generalProjectTaskAssignment.findUnique({ where: { taskId_memberId: {
          taskId: task.id, memberId: member.id } } });
        if (task.status === "IN_PROGRESS" && existing?.isActive && existing.role === "RESPONSIBLE" && input.role !== "RESPONSIBLE") {
          await this.requireOtherResponsible(tx, context, project.id, task.id, existing.id);
        }
        const assignment = existing ? await tx.generalProjectTaskAssignment.update({ where: { id: existing.id }, data: {
          role: input.role, isActive: true, version: { increment: 1 }, assignedAt: new Date(), unassignedAt: null,
          assignedById: context.userId, updatedById: context.userId } })
          : await tx.generalProjectTaskAssignment.create({ data: { companyId: context.companyId,
            projectId: project.id, taskId: task.id, memberId: member.id, role: input.role,
            assignedById: context.userId, updatedById: context.userId } });
        await this.bumpPlanVersion(tx, context, project);
        await this.audit(tx, context, "GENERAL_PROJECT_TASK_MEMBER_ASSIGNED", projectPublicId,
          { taskId: taskPublicId, memberId: input.memberId, role: input.role, nextPlanVersion: project.planVersion + 1 });
        return { assignment: assignmentJson(assignment, member.publicId), planVersion: project.planVersion + 1 };
      });
  }

  unassignTaskMember(context: ActorContext, projectPublicId: string, taskPublicId: string,
    assignmentPublicId: string, input: { expectedPlanVersion: number; expectedVersion: number;
      reason: string; idempotencyKey: string }) {
    return this.command(context, "UNASSIGN_GENERAL_PROJECT_TASK_MEMBER", input.idempotencyKey,
      { projectPublicId, taskPublicId, assignmentPublicId, ...input }, 200, async tx => {
        if (input.reason.trim().length < 10 || input.reason.trim().length > 500) throw new GeneralProjectError("INVALID_REASON");
        const project = await this.lockProject(tx, context, projectPublicId);
        if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const task = await tx.generalProjectTask.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, publicId: taskPublicId } });
        if (!task) throw new GeneralProjectError("NOT_FOUND");
        if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new GeneralProjectError("PROJECT_FINAL");
        const assignment = await tx.generalProjectTaskAssignment.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, taskId: task.id, publicId: assignmentPublicId, isActive: true } });
        if (!assignment) throw new GeneralProjectError("ASSIGNMENT_NOT_FOUND");
        if (assignment.version !== input.expectedVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        if (task.status === "IN_PROGRESS" && assignment.role === "RESPONSIBLE") {
          await this.requireOtherResponsible(tx, context, project.id, task.id, assignment.id);
        }
        const changed = await tx.generalProjectTaskAssignment.updateMany({ where: { id: assignment.id,
          companyId: context.companyId, projectId: project.id, taskId: task.id,
          version: input.expectedVersion, isActive: true }, data: { isActive: false, unassignedAt: new Date(),
            updatedById: context.userId, version: { increment: 1 } } });
        if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
        await this.bumpPlanVersion(tx, context, project);
        const updated = await tx.generalProjectTaskAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
        const member = await tx.generalProjectMember.findUniqueOrThrow({ where: { id: assignment.memberId } });
        await this.audit(tx, context, "GENERAL_PROJECT_TASK_MEMBER_UNASSIGNED", projectPublicId,
          { taskId: taskPublicId, assignmentId: assignmentPublicId, reason: input.reason,
            nextPlanVersion: project.planVersion + 1 });
        return { assignment: assignmentJson(updated, member.publicId), planVersion: project.planVersion + 1 };
      });
  }

  transitionTask(context: ActorContext, projectPublicId: string, taskPublicId: string, input: {
    expectedPlanVersion: number; expectedVersion: number; to: GeneralProjectTask["status"]; reason?: string;
    idempotencyKey: string;
  }, mode: "MANAGE" | "PROGRESS" = "MANAGE") {
    const operation = mode === "MANAGE" ? "TRANSITION_GENERAL_PROJECT_TASK" : "PROGRESS_GENERAL_PROJECT_TASK";
    return this.command(context, operation, input.idempotencyKey,
      { projectPublicId, taskPublicId, mode, ...input }, 200, async tx => {
        const project = await this.lockProject(tx, context, projectPublicId);
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const task = await tx.generalProjectTask.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, publicId: taskPublicId } });
        if (!task) throw new GeneralProjectError("NOT_FOUND");
        if (task.version !== input.expectedVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const phase = await tx.generalProjectPhase.findFirstOrThrow({ where: { companyId: context.companyId,
          projectId: project.id, id: task.phaseId } });
        const responsibilities = await tx.generalProjectTaskAssignment.findMany({ where: { companyId: context.companyId,
          projectId: project.id, taskId: task.id, role: "RESPONSIBLE", isActive: true, member: { isActive: true } },
        select: { member: { select: { employeeId: true } } } });
        const activeResponsibleCount = await this.employees.countActiveInCompany(tx, context.companyId,
          responsibilities.map(row => row.member.employeeId));
        const predecessors = await tx.generalProjectTaskDependency.findMany({ where: { companyId: context.companyId,
          projectId: project.id, successorTaskId: task.id, isActive: true },
        select: { predecessorTask: { select: { status: true } } } });
        const actorEmployee = mode === "PROGRESS"
          ? await this.employees.findByUserInCompanyTx(tx, context.companyId, context.userId) : null;
        const actorIsActiveResponsible = mode === "PROGRESS" && actorEmployee?.status === "ACTIVE"
          && responsibilities.some(row => row.member.employeeId === actorEmployee.id);
        if (mode === "PROGRESS" && !actorIsActiveResponsible) throw new GeneralProjectError("NOT_FOUND");
        const next = transitionTask({ projectStatus: project.status, phaseStatus: phase.status,
          from: task.status, to: input.to, actorCanManage: mode === "MANAGE", actorCanProgress: mode === "PROGRESS",
          actorIsActiveResponsible: Boolean(actorIsActiveResponsible), activeResponsibleCount,
          predecessorStatuses: predecessors.map(row => row.predecessorTask.status),
          ...(input.reason === undefined ? {} : { reason: input.reason }) });
        const changed = await tx.generalProjectTask.updateMany({ where: { id: task.id, companyId: context.companyId,
          projectId: project.id, version: input.expectedVersion, status: task.status }, data: {
          status: next, version: { increment: 1 }, updatedById: context.userId } });
        if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
        await this.bumpPlanVersion(tx, context, project);
        const updated = await tx.generalProjectTask.findUniqueOrThrow({ where: { id: task.id } });
        await this.audit(tx, context, "GENERAL_PROJECT_TASK_TRANSITIONED", projectPublicId,
          { taskId: taskPublicId, from: task.status, to: next, mode, reason: input.reason ?? null,
            nextPlanVersion: project.planVersion + 1 });
        return { task: taskJson(updated), planVersion: project.planVersion + 1 };
      });
  }

  async listDependencies(context: ActorContext, projectPublicId: string,
    input: { page: number; pageSize: number; taskId?: string | undefined }) {
    const { project, rows, total } = await this.prisma.$transaction(async tx => {
      const project = await tx.generalProject.findFirst({ where: { companyId: context.companyId,
        publicId: projectPublicId }, select: { id: true, planVersion: true } });
      if (!project) throw new GeneralProjectError("NOT_FOUND");
      const task = input.taskId ? await tx.generalProjectTask.findFirst({ where: {
        companyId: context.companyId, projectId: project.id, publicId: input.taskId }, select: { id: true } }) : null;
      if (input.taskId && !task) throw new GeneralProjectError("NOT_FOUND");
      const where: Prisma.GeneralProjectTaskDependencyWhereInput = { companyId: context.companyId,
        projectId: project.id, ...(task ? { OR: [{ predecessorTaskId: task.id },
          { successorTaskId: task.id }] } : {}) };
      const [rows, total] = await Promise.all([
        tx.generalProjectTaskDependency.findMany({ where, include: {
          predecessorTask: { select: { publicId: true, title: true } },
          successorTask: { select: { publicId: true, title: true } },
        }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize,
        take: input.pageSize }),
        tx.generalProjectTaskDependency.count({ where }),
      ]);
      return { project, rows, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: rows.map(row => dependencyJson(row, row.predecessorTask.publicId,
      row.successorTask.publicId, row.predecessorTask.title, row.successorTask.title)),
      planVersion: project.planVersion,
      meta: { page: input.page, pageSize: input.pageSize, total,
        totalPages: Math.ceil(total / input.pageSize) } };
  }

  addDependency(context: ActorContext, projectPublicId: string, input: { expectedPlanVersion: number;
    predecessorTaskId: string; successorTaskId: string; idempotencyKey: string }) {
    return this.command(context, "ADD_GENERAL_PROJECT_TASK_DEPENDENCY", input.idempotencyKey,
      { projectPublicId, ...input }, 201, async tx => {
        const project = await this.lockProject(tx, context, projectPublicId);
        if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const [taskRows, linkRows] = await Promise.all([
          tx.generalProjectTask.findMany({ where: { companyId: context.companyId, projectId: project.id },
            select: { id: true, publicId: true, title: true, status: true } }),
          tx.generalProjectTaskDependency.findMany({ where: { companyId: context.companyId,
            projectId: project.id, isActive: true }, select: { predecessorTaskId: true,
            successorTaskId: true } }),
        ]);
        const predecessor = taskRows.find(row => row.publicId === input.predecessorTaskId);
        const successor = taskRows.find(row => row.publicId === input.successorTaskId);
        if (!predecessor || !successor) throw new GeneralProjectError("NOT_FOUND");
        const companyId = context.companyId.toString();
        const projectId = project.id.toString();
        const nodes = taskRows.map(row => ({ id: row.id.toString(), companyId, projectId,
          status: row.status }));
        validateDependencyAddition({ predecessor: { id: predecessor.id.toString(), companyId, projectId,
          status: predecessor.status }, successor: { id: successor.id.toString(), companyId, projectId,
          status: successor.status }, tasks: nodes,
        dependencies: linkRows.map(row => ({ predecessorId: row.predecessorTaskId.toString(),
          successorId: row.successorTaskId.toString(), active: true })) });
        const existing = await tx.generalProjectTaskDependency.findUnique({ where: {
          projectId_predecessorTaskId_successorTaskId: { projectId: project.id,
            predecessorTaskId: predecessor.id, successorTaskId: successor.id },
        } });
        const row = existing ? await tx.generalProjectTaskDependency.update({ where: { id: existing.id },
          data: { isActive: true, version: { increment: 1 }, removedAt: null, removalReason: null,
            updatedById: context.userId } })
          : await tx.generalProjectTaskDependency.create({ data: { companyId: context.companyId,
            projectId: project.id, predecessorTaskId: predecessor.id, successorTaskId: successor.id,
            createdById: context.userId, updatedById: context.userId } });
        await this.bumpPlanVersion(tx, context, project);
        await this.audit(tx, context, "GENERAL_PROJECT_TASK_DEPENDENCY_ADDED", projectPublicId,
          { dependencyId: row.publicId, predecessorTaskId: input.predecessorTaskId,
            successorTaskId: input.successorTaskId, nextPlanVersion: project.planVersion + 1 });
        return { dependency: dependencyJson(row, predecessor.publicId, successor.publicId,
          predecessor.title, successor.title),
          planVersion: project.planVersion + 1 };
      });
  }

  removeDependency(context: ActorContext, projectPublicId: string, dependencyPublicId: string,
    input: { expectedPlanVersion: number; expectedVersion: number; reason: string; idempotencyKey: string }) {
    return this.command(context, "REMOVE_GENERAL_PROJECT_TASK_DEPENDENCY", input.idempotencyKey,
      { projectPublicId, dependencyPublicId, ...input }, 200, async tx => {
        const project = await this.lockProject(tx, context, projectPublicId);
        if (project.planVersion !== input.expectedPlanVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const current = await tx.generalProjectTaskDependency.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, publicId: dependencyPublicId, isActive: true }, include: {
            predecessorTask: { select: { publicId: true, title: true, status: true } },
            successorTask: { select: { publicId: true, title: true, status: true } },
          } });
        if (!current) throw new GeneralProjectError("NOT_FOUND");
        if (current.version !== input.expectedVersion) throw new GeneralProjectError("VERSION_CONFLICT");
        const kind = validateDependencyRemoval({ projectStatus: project.status,
          predecessorStatus: current.predecessorTask.status,
          successorStatus: current.successorTask.status, reason: input.reason });
        const changed = await tx.generalProjectTaskDependency.updateMany({ where: { id: current.id,
          companyId: context.companyId, projectId: project.id, version: input.expectedVersion,
          isActive: true }, data: { isActive: false, version: { increment: 1 },
            removedAt: new Date(), removalReason: input.reason.trim(), updatedById: context.userId } });
        if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
        await this.bumpPlanVersion(tx, context, project);
        const updated = await tx.generalProjectTaskDependency.findUniqueOrThrow({ where: { id: current.id } });
        const action = kind === "PREDECESSOR_CANCELLED_RECOVERY"
          ? "GENERAL_PROJECT_TASK_DEPENDENCY_REMOVED_AFTER_PREDECESSOR_CANCELLED"
          : "GENERAL_PROJECT_TASK_DEPENDENCY_REMOVED";
        await this.audit(tx, context, action, projectPublicId, { dependencyId: dependencyPublicId,
          reason: input.reason.trim(), nextPlanVersion: project.planVersion + 1 });
        return { dependency: dependencyJson(updated, current.predecessorTask.publicId,
          current.successorTask.publicId, current.predecessorTask.title,
          current.successorTask.title), planVersion: project.planVersion + 1 };
      });
  }

  async createProject(context: ActorContext, input: { nameAr: string; nameEn?: string | null; description?: string | null; customerId?: bigint | null; priority?: GeneralProject["priority"]; plannedStartDate?: string | null; targetEndDate?: string | null; managerEmployeeId?: string; idempotencyKey: string }) {
    const managerId = input.managerEmployeeId ?? (await this.employees.findByUserInCompany(context.companyId, context.userId))?.publicId;
    if (!managerId) throw new GeneralProjectError("EMPLOYEE_NOT_FOUND");
    return this.command(context, "CREATE_GENERAL_PROJECT", input.idempotencyKey, { ...input, managerId }, 201, async tx => {
      this.validateDates(input.plannedStartDate ?? null, input.targetEndDate ?? null);
      const manager = await this.employees.lockActiveInCompany(tx, context.companyId, managerId);
      if (!manager) throw new GeneralProjectError("EMPLOYEE_INACTIVE");
      const customer = input.customerId ? await this.requireCustomer(tx, context.companyId, input.customerId) : null;
      const code = await reserveMasterDataCode(tx, context.companyId, "GENERAL_PROJECT");
      const project = await tx.generalProject.create({ data: { companyId: context.companyId, customerId: customer?.id ?? null,
        code, nameAr: input.nameAr, nameEn: input.nameEn ?? null, description: input.description ?? null,
        priority: input.priority ?? "NORMAL", plannedStartDate: input.plannedStartDate ? day(input.plannedStartDate) : null,
        targetEndDate: input.targetEndDate ? day(input.targetEndDate) : null, createdById: context.userId, updatedById: context.userId } });
      await tx.generalProjectMember.create({ data: { companyId: context.companyId, projectId: project.id, employeeId: manager.id,
        role: "MANAGER", assignedById: context.userId, updatedById: context.userId } });
      await this.audit(tx, context, "GENERAL_PROJECT_CREATED", project.publicId, { managerEmployeeId: manager.publicId, customerId: customer?.id.toString() ?? null });
      return { project: projectJson(project, customer, 1) };
    });
  }

  async updateProject(context: ActorContext, publicId: string, input: { version: number; nameAr?: string; nameEn?: string | null; description?: string | null; customerId?: bigint | null; priority?: GeneralProject["priority"]; plannedStartDate?: string | null; targetEndDate?: string | null; idempotencyKey: string }) {
    return this.command(context, "UPDATE_GENERAL_PROJECT", input.idempotencyKey, { publicId, ...input }, 200, async tx => {
      const project = await this.lockProject(tx, context, publicId, input.version);
      if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
      const start = input.plannedStartDate === undefined ? dateOnly(project.plannedStartDate) : input.plannedStartDate;
      const end = input.targetEndDate === undefined ? dateOnly(project.targetEndDate) : input.targetEndDate;
      this.validateDates(start ?? null, end ?? null);
      if (input.plannedStartDate !== undefined || input.targetEndDate !== undefined) {
        const outside: Prisma.GeneralProjectPhaseWhereInput[] = [];
        if (start) outside.push({ OR: [{ plannedStartDate: { lt: day(start) } }, { targetEndDate: { lt: day(start) } }] });
        if (end) outside.push({ OR: [{ plannedStartDate: { gt: day(end) } }, { targetEndDate: { gt: day(end) } }] });
        if (outside.length && await tx.generalProjectPhase.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, OR: outside }, select: { id: true } })) throw new GeneralProjectError("INVALID_DATE_RANGE");
        const taskOutside: Prisma.GeneralProjectTaskWhereInput[] = [];
        if (start) taskOutside.push({ OR: [{ plannedStartDate: { lt: day(start) } }, { dueDate: { lt: day(start) } }] });
        if (end) taskOutside.push({ OR: [{ plannedStartDate: { gt: day(end) } }, { dueDate: { gt: day(end) } }] });
        if (taskOutside.length && await tx.generalProjectTask.findFirst({ where: { companyId: context.companyId,
          projectId: project.id, OR: taskOutside }, select: { id: true } })) throw new GeneralProjectError("INVALID_DATE_RANGE");
      }
      const customerId = input.customerId === undefined ? project.customerId : input.customerId;
      const customer = customerId === null ? null : input.customerId === undefined
        ? await this.customers.findInCompany(tx, context.companyId, customerId)
        : await this.requireCustomer(tx, context.companyId, customerId);
      const result = await tx.generalProject.updateMany({ where: { id: project.id, companyId: context.companyId, version: input.version },
        data: { ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}), ...(input.customerId !== undefined ? { customerId } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.plannedStartDate !== undefined ? { plannedStartDate: start ? day(start) : null } : {}),
          ...(input.targetEndDate !== undefined ? { targetEndDate: end ? day(end) : null } : {}), updatedById: context.userId, version: { increment: 1 } } });
      if (result.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
      const updated = await tx.generalProject.findUniqueOrThrow({ where: { id: project.id } });
      const count = await tx.generalProjectMember.count({ where: { companyId: context.companyId, projectId: project.id, isActive: true } });
      await this.audit(tx, context, "GENERAL_PROJECT_UPDATED", publicId);
      return { project: projectJson(updated, customer, count) };
    });
  }

  async transition(context: ActorContext, publicId: string, input: { version: number; status: GeneralProject["status"]; reason?: string; idempotencyKey: string }) {
    return this.command(context, "TRANSITION_GENERAL_PROJECT", input.idempotencyKey, { publicId, ...input }, 200, async tx => {
      const project = await this.lockProject(tx, context, publicId, input.version);
      const managers = await tx.generalProjectMember.findMany({ where: { companyId: context.companyId, projectId: project.id, isActive: true, role: "MANAGER" }, select: { employeeId: true } });
      const activeManagerCount = await this.employees.countActiveInCompany(tx, context.companyId, managers.map(row => row.employeeId));
      const [phases, tasks] = input.status === "COMPLETED" ? await Promise.all([
        tx.generalProjectPhase.findMany({ where: { companyId: context.companyId, projectId: project.id }, select: { status: true } }),
        tx.generalProjectTask.findMany({ where: { companyId: context.companyId, projectId: project.id }, select: { status: true } }),
      ]) : [[], []];
      transitionProject({ from: project.status, to: input.status, activeManagerCount,
        phaseStatuses: phases.map(row => row.status), taskStatuses: tasks.map(row => row.status),
        ...(input.reason === undefined ? {} : { reason: input.reason }) });
      const result = await tx.generalProject.updateMany({ where: { id: project.id, companyId: context.companyId, version: input.version, status: project.status },
        data: { status: input.status, version: { increment: 1 }, updatedById: context.userId } });
      if (result.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
      const updated = await tx.generalProject.findUniqueOrThrow({ where: { id: project.id } });
      const customer = project.customerId === null ? null : await this.customers.findInCompany(tx, context.companyId, project.customerId);
      await this.audit(tx, context, "GENERAL_PROJECT_STATUS_CHANGED", publicId, { from: project.status, to: input.status, reason: input.reason ?? null });
      return { project: projectJson(updated, customer, await tx.generalProjectMember.count({ where: { companyId: context.companyId, projectId: project.id, isActive: true } })) };
    });
  }

  async assignMember(context: ActorContext, publicId: string, input: { version: number; employeeId: string; role: GeneralProjectMember["role"]; idempotencyKey: string }) {
    return this.command(context, "ASSIGN_GENERAL_PROJECT_MEMBER", input.idempotencyKey, { publicId, ...input }, 200, async tx => {
      // Employee lock precedes project lock consistently with creation and HR termination.
      const employee = await this.employees.lockActiveInCompany(tx, context.companyId, input.employeeId);
      if (!employee) throw new GeneralProjectError("EMPLOYEE_INACTIVE");
      const project = await this.lockProject(tx, context, publicId, input.version);
      if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
      const existing = await tx.generalProjectMember.findUnique({ where: { projectId_employeeId: { projectId: project.id, employeeId: employee.id } } });
      if (existing?.isActive && existing.role === "MANAGER" && input.role !== "MANAGER") {
        const managers = await tx.generalProjectMember.findMany({ where: { companyId: context.companyId, projectId: project.id, isActive: true, role: "MANAGER", id: { not: existing.id } }, select: { employeeId: true } });
        if (await this.employees.countActiveInCompany(tx, context.companyId, managers.map(row => row.employeeId)) < 1) throw new GeneralProjectError("LAST_MANAGER");
      }
      const member = existing ? await tx.generalProjectMember.update({ where: { id: existing.id }, data: { role: input.role, isActive: true, version: { increment: 1 },
        assignedAt: new Date(), unassignedAt: null, assignedById: context.userId, updatedById: context.userId } })
        : await tx.generalProjectMember.create({ data: { companyId: context.companyId, projectId: project.id, employeeId: employee.id, role: input.role,
          assignedById: context.userId, updatedById: context.userId } });
      await this.bumpProject(tx, context, project);
      await this.audit(tx, context, "GENERAL_PROJECT_MEMBER_ASSIGNED", publicId, { employeeId: employee.publicId, role: input.role });
      return { member: memberJson(member, employee), projectVersion: project.version + 1 };
    });
  }

  async unassignMember(context: ActorContext, publicId: string, memberPublicId: string, input: { version: number; reason: string; idempotencyKey: string }) {
    return this.command(context, "UNASSIGN_GENERAL_PROJECT_MEMBER", input.idempotencyKey, { publicId, memberPublicId, ...input }, 200, async tx => {
      const project = await this.lockProject(tx, context, publicId, input.version);
      if (!mutable(project.status)) throw new GeneralProjectError("PROJECT_FINAL");
      const member = await tx.generalProjectMember.findFirst({ where: { companyId: context.companyId, projectId: project.id, publicId: memberPublicId, isActive: true } });
      if (!member) throw new GeneralProjectError("MEMBER_NOT_FOUND");
      if (member.role === "MANAGER") {
        const managers = await tx.generalProjectMember.findMany({ where: { companyId: context.companyId, projectId: project.id, isActive: true, role: "MANAGER", id: { not: member.id } }, select: { employeeId: true } });
        if (await this.employees.countActiveInCompany(tx, context.companyId, managers.map(row => row.employeeId)) < 1) throw new GeneralProjectError("LAST_MANAGER");
      }
      const ongoingResponsibility = await tx.generalProjectTaskAssignment.findFirst({ where: {
        companyId: context.companyId, projectId: project.id, memberId: member.id,
        role: "RESPONSIBLE", isActive: true, task: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      }, select: { id: true } });
      if (ongoingResponsibility) throw new GeneralProjectError("ACTIVE_TASK_RESPONSIBILITY");
      const assignments = await tx.generalProjectTaskAssignment.updateMany({ where: {
        companyId: context.companyId, projectId: project.id, memberId: member.id, isActive: true,
      }, data: { isActive: false, unassignedAt: new Date(), updatedById: context.userId,
        version: { increment: 1 } } });
      const updated = await tx.generalProjectMember.update({ where: { id: member.id }, data: { isActive: false, unassignedAt: new Date(), updatedById: context.userId, version: { increment: 1 } } });
      await this.bumpProject(tx, context, project);
      if (assignments.count > 0) await this.bumpPlanVersion(tx, context, project);
      await this.audit(tx, context, "GENERAL_PROJECT_MEMBER_UNASSIGNED", publicId, { memberId: memberPublicId, reason: input.reason });
      return { memberId: updated.publicId, projectVersion: project.version + 1 };
    });
  }

  private async command<T>(context: ActorContext, operation: string, key: string, input: unknown, responseStatus: number, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.commands.execute({ context, operation, key, fingerprint: JSON.stringify(input, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value), responseStatus,
      errors: { mismatch: () => new GeneralProjectError("IDEMPOTENCY_MISMATCH"), inProgress: () => new GeneralProjectError("IDEMPOTENCY_IN_PROGRESS") } }, work);
  }
  private async lockProject(tx: Prisma.TransactionClient, context: ActorContext, publicId: string, version?: number) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM general_projects WHERE company_id = ${context.companyId} AND public_id = ${publicId} FOR UPDATE`;
    if (!rows[0]) throw new GeneralProjectError("NOT_FOUND");
    const row = await tx.generalProject.findFirst({ where: { companyId: context.companyId, id: rows[0].id } });
    if (!row) throw new GeneralProjectError("NOT_FOUND");
    if (version !== undefined && row.version !== version) throw new GeneralProjectError("VERSION_CONFLICT");
    return row;
  }
  private async bumpProject(tx: Prisma.TransactionClient, context: ActorContext, project: GeneralProject) {
    const changed = await tx.generalProject.updateMany({ where: { id: project.id, companyId: context.companyId, version: project.version }, data: { version: { increment: 1 }, updatedById: context.userId } });
    if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
  }
  private async bumpPlanVersion(tx: Prisma.TransactionClient, context: ActorContext, project: GeneralProject) {
    const changed = await tx.generalProject.updateMany({ where: { id: project.id, companyId: context.companyId,
      planVersion: project.planVersion, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { planVersion: { increment: 1 }, updatedById: context.userId } });
    if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
  }
  private async requireOtherResponsible(tx: Prisma.TransactionClient, context: ActorContext,
    projectId: bigint, taskId: bigint, exceptId: bigint) {
    const others = await tx.generalProjectTaskAssignment.findMany({ where: { companyId: context.companyId,
      projectId, taskId, id: { not: exceptId }, role: "RESPONSIBLE", isActive: true,
      member: { isActive: true } }, select: { member: { select: { employeeId: true } } } });
    if (await this.employees.countActiveInCompany(tx, context.companyId,
      others.map(row => row.member.employeeId)) < 1) throw new GeneralProjectError("ACTIVE_TASK_RESPONSIBILITY");
  }
  private async requireCustomer(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const row = await this.customers.findInCompany(tx, companyId, id);
    if (!row) throw new GeneralProjectError("CUSTOMER_NOT_FOUND");
    if (!row.isActive) throw new GeneralProjectError("CUSTOMER_INACTIVE");
    return row;
  }
  private validateDates(start: string | null, end: string | null) { if (start && end && end < start) throw new GeneralProjectError("INVALID_DATE_RANGE"); }
  private validatePlanDates(start: string | null, end: string | null, projectStart: string | null, projectEnd: string | null) {
    this.validateDates(start, end);
    for (const date of [start, end]) {
      if (date && ((projectStart && date < projectStart) || (projectEnd && date > projectEnd))) {
        throw new GeneralProjectError("INVALID_DATE_RANGE");
      }
    }
  }
  private customerMap = async (companyId: bigint, ids: bigint[]) => new Map((await this.customers.listByIds(companyId, [...new Set(ids)])).map(row => [row.id, row]));
  private employeeMap = async (companyId: bigint, ids: bigint[]) => new Map((await this.employees.listByInternalIds(companyId, [...new Set(ids)])).map(row => [row.id, row]));
  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityId: string, details?: Prisma.InputJsonObject) {
    return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action, entityType: "GENERAL_PROJECT", entityId, ...(details ? { details } : {}) } });
  }
}
