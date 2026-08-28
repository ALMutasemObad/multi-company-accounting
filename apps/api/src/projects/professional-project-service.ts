import {
  Prisma,
  type PrismaClient,
  type ProfessionalProject,
  type ProfessionalProjectMember,
  type ProfessionalProjectTask,
  type ProfessionalTimeEntry,
  type ProfessionalTimesheet,
} from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { createHash } from "node:crypto";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../platform/actor-context.js";
import type {
  ProfessionalCustomerPort,
  ProfessionalCustomerReference,
  ProfessionalEmployeePort,
  ProfessionalEmployeeReference,
  ProfessionalPeoplePort,
  ProfessionalPersonReference,
} from "./project-reference-ports.js";
import { ProfessionalProjectAccessPolicy } from "./professional-project-access-policy.js";

export type ProfessionalProjectFailureReason =
  | "NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_INACTIVE"
  | "USER_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_INACTIVE"
  | "MEMBER_HAS_OPEN_TASKS"
  | "PROJECT_INACTIVE"
  | "PROJECT_PLAN_INCOMPLETE"
  | "PROJECT_PLAN_OUTSIDE_DATES"
  | "TASK_NOT_FOUND"
  | "TASK_INACTIVE"
  | "INVALID_TRANSITION"
  | "INVALID_DATE_RANGE"
  | "VERSION_CONFLICT"
  | "BILLABLE_NOT_ALLOWED"
  | "BILLABLE_TIME_EXISTS"
  | "LAST_MANAGER"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_INACTIVE"
  | "INVALID_PERIOD_START"
  | "TIMESHEET_EMPTY"
  | "TIMESHEET_LOCKED"
  | "TIMESHEET_INVALID_STATE"
  | "TIMESHEET_CHANGED"
  | "NOT_TIMESHEET_OWNER"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class ProfessionalProjectError extends Error {
  constructor(public readonly reason: ProfessionalProjectFailureReason) {
    super(reason);
  }
}

type ProjectKind = "LEGAL_MATTER" | "CONSULTING_ENGAGEMENT" | "PROFESSIONAL_PROJECT";
type BillingModel = "TIME_AND_MATERIALS" | "FIXED_FEE" | "NON_BILLABLE";
type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
type MemberRole = "MANAGER" | "PROFESSIONAL" | "REVIEWER";
type TimesheetStatus = "OPEN" | "AWAITING_APPROVAL" | "APPROVED";
type TimeEntryWithProject = Prisma.ProfessionalTimeEntryGetPayload<{
  include: { member: { include: { project: true } }; task: true };
}>;
type TimeEntryTaskReference = Pick<ProfessionalProjectTask, "publicId" | "titleAr" | "titleEn" | "status">;

type ProjectStats = { memberCount: number; trackedMinutes: number; billableMinutes: number };
type TimesheetStats = { entryCount: number; trackedMinutes: number; billableMinutes: number };

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const weekStart = (value: Date) => addUtcDays(value, -value.getUTCDay());
const timesheetKey = (userId: bigint, periodStart: Date) => `${userId}:${dateString(periodStart)}`;
const personJson = (person: ProfessionalPersonReference) => ({
  id: person.id.toString(),
  displayName: person.displayName,
  nameEn: person.nameEn,
});
const customerJson = (customer: ProfessionalCustomerReference) => ({
  id: customer.id.toString(),
  code: customer.code,
  nameAr: customer.nameAr,
  nameEn: customer.nameEn,
});
const employeeJson = (employee: ProfessionalEmployeeReference) => ({
  id: employee.id,
  employeeNumber: employee.employeeNumber,
  nameAr: employee.nameAr,
  nameEn: employee.nameEn,
  status: employee.status,
});

function timesheetJson(
  timesheet: ProfessionalTimesheet,
  employee: ProfessionalEmployeeReference,
  stats: TimesheetStats,
  editable: boolean,
) {
  return {
    id: timesheet.publicId,
    employee: employeeJson(employee),
    periodStart: dateString(timesheet.periodStart),
    periodEnd: dateString(timesheet.periodEnd),
    status: timesheet.status,
    entryCount: stats.entryCount,
    trackedMinutes: stats.trackedMinutes,
    billableMinutes: stats.billableMinutes,
    nonBillableMinutes: stats.trackedMinutes - stats.billableMinutes,
    activeSubmissionNumber: timesheet.activeSubmissionNumber,
    activeSnapshotHashSha256: timesheet.activeSnapshotHashSha256
      ? Buffer.from(timesheet.activeSnapshotHashSha256).toString("hex")
      : null,
    submittedAt: timesheet.submittedAt?.toISOString() ?? null,
    editable,
    version: timesheet.version,
    createdAt: timesheet.createdAt.toISOString(),
    updatedAt: timesheet.updatedAt.toISOString(),
  };
}

function timesheetSnapshot(entries: TimeEntryWithProject[]) {
  const ordered = [...entries].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const facts = ordered.map((entry) => ({
    id: entry.publicId,
    version: entry.version,
    projectId: entry.member.project.publicId,
    ...(entry.task ? { taskId: entry.task.publicId } : {}),
    workDate: dateString(entry.workDate),
    minutes: entry.minutes,
    isBillable: entry.isBillable,
    description: entry.description,
  }));
  return {
    references: facts.map(({ id, version }) => ({ timeEntryId: id, version })),
    hash: createHash("sha256").update(JSON.stringify(facts), "utf8").digest(),
  };
}

function projectJson(
  project: ProfessionalProject,
  customer: ProfessionalCustomerReference,
  stats: ProjectStats,
) {
  return {
    id: project.publicId,
    code: project.code,
    customer: customerJson(customer),
    nameAr: project.nameAr,
    nameEn: project.nameEn,
    kind: project.kind,
    billingModel: project.billingModel,
    status: project.status,
    startDate: dateString(project.startDate),
    targetEndDate: project.targetEndDate ? dateString(project.targetEndDate) : null,
    description: project.description,
    memberCount: stats.memberCount,
    trackedMinutes: stats.trackedMinutes,
    billableMinutes: stats.billableMinutes,
    accessMode: project.accessMode,
    accessVersion: project.accessVersion,
    version: project.version,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function memberJson(member: ProfessionalProjectMember, person: ProfessionalPersonReference) {
  return {
    user: personJson(person),
    role: member.role,
    isActive: member.isActive,
    version: member.version,
    assignedAt: member.assignedAt.toISOString(),
    unassignedAt: member.unassignedAt?.toISOString() ?? null,
  };
}

function timeEntryJson(
  entry: ProfessionalTimeEntry,
  task: TimeEntryTaskReference | null,
  project: Pick<ProfessionalProject, "publicId" | "code" | "nameAr" | "nameEn">,
  person: ProfessionalPersonReference,
  editable: boolean,
) {
  return {
    id: entry.publicId,
    project: {
      id: project.publicId,
      code: project.code,
      nameAr: project.nameAr,
      nameEn: project.nameEn,
    },
    task: task ? {
      id: task.publicId,
      titleAr: task.titleAr,
      titleEn: task.titleEn,
      status: task.status,
    } : null,
    user: personJson(person),
    workDate: dateString(entry.workDate),
    minutes: entry.minutes,
    isBillable: entry.isBillable,
    description: entry.description,
    editable,
    version: entry.version,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

const transitionTable: Record<ProjectStatus, readonly ProjectStatus[]> = {
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export class ProfessionalProjectService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;
  private readonly access = new ProfessionalProjectAccessPolicy();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly customers: ProfessionalCustomerPort,
    private readonly people: ProfessionalPeoplePort,
    private readonly employees: ProfessionalEmployeePort,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async listProjects(context: ActorContext, input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    status?: ProjectStatus | undefined;
    kind?: ProjectKind | undefined;
    customerId?: bigint | undefined;
  }) {
    const filters: Prisma.ProfessionalProjectWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.search ? {
        OR: [
          { code: { contains: input.search } },
          { nameAr: { contains: input.search } },
          { nameEn: { contains: input.search } },
        ],
      } : {}),
    };
    const where = this.access.where(context, filters);
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.professionalProject.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      });
      const ids = rows.map((row) => row.id);
      const [total, members, time] = await Promise.all([
        tx.professionalProject.count({ where }),
        ids.length ? tx.professionalProjectMember.groupBy({
          by: ["projectId"],
          where: { companyId: context.companyId, projectId: { in: ids }, isActive: true },
          _count: { _all: true },
        }) : [],
        ids.length ? tx.professionalTimeEntry.groupBy({
          by: ["projectId", "isBillable"],
          where: { companyId: context.companyId, projectId: { in: ids } },
          _sum: { minutes: true },
        }) : [],
      ]);
      return { rows, total, members, time };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const customerMap = await this.customerMap(context.companyId, result.rows.map((row) => row.customerId));
    const stats = new Map<bigint, ProjectStats>();
    for (const row of result.rows) stats.set(row.id, { memberCount: 0, trackedMinutes: 0, billableMinutes: 0 });
    for (const row of result.members) stats.get(row.projectId)!.memberCount = row._count._all;
    for (const row of result.time) {
      const value = stats.get(row.projectId)!;
      value.trackedMinutes += row._sum.minutes ?? 0;
      if (row.isBillable) value.billableMinutes += row._sum.minutes ?? 0;
    }
    return {
      data: result.rows.map((row) => projectJson(row, customerMap.get(row.customerId)!, stats.get(row.id)!)),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / input.pageSize),
      },
    };
  }

  async getProject(context: ActorContext, publicId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const project = await this.access.findAccessible(tx, context, { publicId });
      if (!project) throw new ProfessionalProjectError("NOT_FOUND");
      const [members, time] = await Promise.all([
        tx.professionalProjectMember.findMany({
          where: { projectId: project.id, companyId: context.companyId },
          orderBy: [{ isActive: "desc" }, { role: "asc" }, { id: "asc" }],
        }),
        tx.professionalTimeEntry.groupBy({
          by: ["isBillable"],
          where: { projectId: project.id, companyId: context.companyId },
          _sum: { minutes: true },
        }),
      ]);
      return { project, members, time };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const [customerMap, peopleMap] = await Promise.all([
      this.customerMap(context.companyId, [result.project.customerId]),
      this.peopleMap(context.companyId, result.members.map((member) => member.userId)),
    ]);
    const stats = result.time.reduce<ProjectStats>((value, row) => {
      value.trackedMinutes += row._sum.minutes ?? 0;
      if (row.isBillable) value.billableMinutes += row._sum.minutes ?? 0;
      return value;
    }, { memberCount: result.members.filter((member) => member.isActive).length, trackedMinutes: 0, billableMinutes: 0 });
    return {
      project: projectJson(result.project, customerMap.get(result.project.customerId)!, stats),
      members: result.members.map((member) => memberJson(member, peopleMap.get(member.userId)!)),
    };
  }

  async listCustomerOptions(context: ActorContext, search?: string) {
    const rows = await this.customers.listInCompany(context.companyId, { search, limit: 100 });
    return { data: rows.map(customerJson) };
  }

  async listMemberOptions(context: ActorContext, search?: string) {
    const rows = await this.people.listActiveInCompany(context.companyId, { search, limit: 100 });
    return { data: rows.map(personJson) };
  }

  async listTimesheets(context: ActorContext, input: {
    page: number;
    pageSize: number;
    scope: "MY" | "ALL";
    status?: TimesheetStatus | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  }) {
    const where: Prisma.ProfessionalTimesheetWhereInput = {
      companyId: context.companyId,
      ...(input.scope === "MY" ? { userId: context.userId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...((input.dateFrom || input.dateTo) ? {
        periodStart: {
          ...(input.dateFrom ? { gte: asDate(input.dateFrom) } : {}),
          ...(input.dateTo ? { lte: asDate(input.dateTo) } : {}),
        },
      } : {}),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.professionalTimesheet.findMany({
          where,
          orderBy: [{ periodStart: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        tx.professionalTimesheet.count({ where }),
      ]);
      return { rows, total, stats: await this.timesheetStats(tx, context, rows) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const employeeMap = await this.employeeMap(context.companyId, result.rows.map((row) => row.userId));
    return {
      data: result.rows.map((row) => {
        const employee = employeeMap.get(row.userId);
        if (!employee) throw new ProfessionalProjectError("EMPLOYEE_NOT_FOUND");
        return timesheetJson(
          row,
          employee,
          result.stats.get(timesheetKey(row.userId, row.periodStart)) ?? { entryCount: 0, trackedMinutes: 0, billableMinutes: 0 },
          row.userId === context.userId && row.status === "OPEN",
        );
      }),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / input.pageSize),
      },
    };
  }

  async getTimesheet(context: ActorContext, publicId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const timesheet = await tx.professionalTimesheet.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!timesheet) throw new ProfessionalProjectError("NOT_FOUND");
      const allEntries = await this.loadTimesheetEntries(tx, timesheet);
      const entries = await this.loadVisibleTimesheetEntries(tx, timesheet, context);
      return { timesheet, entries, restrictedEntryCount: allEntries.length - entries.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const [employeeMap, peopleMap] = await Promise.all([
      this.employeeMap(context.companyId, [result.timesheet.userId]),
      this.peopleMap(context.companyId, [result.timesheet.userId]),
    ]);
    const employee = employeeMap.get(result.timesheet.userId);
    const person = peopleMap.get(result.timesheet.userId);
    if (!employee) throw new ProfessionalProjectError("EMPLOYEE_NOT_FOUND");
    if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
    const stats = this.statsFromEntries(result.entries);
    const editable = result.timesheet.userId === context.userId && result.timesheet.status === "OPEN";
    return {
      timesheet: timesheetJson(result.timesheet, employee, stats, editable),
      restrictedEntryCount: result.restrictedEntryCount,
      entries: result.entries.map((entry) => timeEntryJson(
        entry,
        entry.task,
        entry.member.project,
        person,
        editable && entry.member.isActive && entry.member.project.status === "ACTIVE",
      )),
    };
  }

  createTimesheet(context: ActorContext, input: { periodStart: string; idempotencyKey: string }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_TIMESHEET", input.idempotencyKey, input, 201, async (tx) => {
      const periodStart = asDate(input.periodStart);
      if (periodStart.getUTCDay() !== 0) throw new ProfessionalProjectError("INVALID_PERIOD_START");
      await this.lockActiveTimesheetOwner(tx, context);
      const employee = await this.requireActiveEmployee(tx, context.companyId, context.userId);
      const existing = await tx.professionalTimesheet.findUnique({
        where: { companyId_userId_periodStart: { companyId: context.companyId, userId: context.userId, periodStart } },
      });
      if (existing) {
        const stats = this.statsFromEntries(await this.loadVisibleTimesheetEntries(tx, existing, context));
        return { timesheet: timesheetJson(existing, employee, stats, existing.status === "OPEN") };
      }
      const timesheet = await tx.professionalTimesheet.create({
        data: {
          companyId: context.companyId,
          userId: context.userId,
          periodStart,
          periodEnd: addUtcDays(periodStart, 6),
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_TIMESHEET_CREATED", "PROFESSIONAL_TIMESHEET", timesheet.publicId, {
        periodStart: input.periodStart,
        periodEnd: dateString(timesheet.periodEnd),
        employeeId: employee.id,
      });
      const stats = this.statsFromEntries(await this.loadVisibleTimesheetEntries(tx, timesheet, context));
      return { timesheet: timesheetJson(timesheet, employee, stats, true) };
    });
  }

  createProject(context: ActorContext, input: {
    customerId: bigint;
    nameAr: string;
    nameEn?: string | null;
    kind: ProjectKind;
    billingModel: BillingModel;
    startDate: string;
    targetEndDate?: string | null;
    description?: string | null;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_PROJECT", input.idempotencyKey, input, 201, async (tx) => {
      const startDate = asDate(input.startDate);
      const targetEndDate = input.targetEndDate ? asDate(input.targetEndDate) : null;
      if (targetEndDate && targetEndDate < startDate) throw new ProfessionalProjectError("INVALID_DATE_RANGE");
      const customer = await this.requireCustomer(tx, context.companyId, input.customerId);
      const code = await reserveMasterDataCode(tx, context.companyId, "PROFESSIONAL_PROJECT");
      const project = await tx.professionalProject.create({
        data: {
          companyId: context.companyId,
          customerId: input.customerId,
          code,
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          kind: input.kind,
          billingModel: input.billingModel,
          startDate,
          targetEndDate,
          description: input.description ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await tx.professionalProjectMember.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          userId: context.userId,
          role: "MANAGER",
          assignedById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_CREATED", "PROFESSIONAL_PROJECT", project.publicId, {
        kind: project.kind,
        billingModel: project.billingModel,
      });
      return { project: projectJson(project, customer, { memberCount: 1, trackedMinutes: 0, billableMinutes: 0 }) };
    });
  }

  updateProject(context: ActorContext, publicId: string, input: {
    version: number;
    customerId?: bigint;
    nameAr?: string;
    nameEn?: string | null;
    kind?: ProjectKind;
    billingModel?: BillingModel;
    startDate?: string;
    targetEndDate?: string | null;
    description?: string | null;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_PROJECT", companyId: context.companyId }, async (tx) => {
      const project = await this.lockProject(tx, context, publicId);
      if (project.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!["ACTIVE", "ON_HOLD"].includes(project.status)) throw new ProfessionalProjectError("PROJECT_INACTIVE");
      const customer = await this.requireCustomer(tx, context.companyId, input.customerId ?? project.customerId);
      if (input.billingModel === "NON_BILLABLE" && project.billingModel !== "NON_BILLABLE") {
        const billableEntries = await tx.professionalTimeEntry.count({ where: { projectId: project.id, companyId: context.companyId, isBillable: true } });
        if (billableEntries > 0) throw new ProfessionalProjectError("BILLABLE_TIME_EXISTS");
      }
      const startDate = input.startDate ? asDate(input.startDate) : project.startDate;
      const targetEndDate = input.targetEndDate === undefined
        ? project.targetEndDate
        : input.targetEndDate ? asDate(input.targetEndDate) : null;
      if (targetEndDate && targetEndDate < startDate) throw new ProfessionalProjectError("INVALID_DATE_RANGE");
      const narrowsStart = startDate > project.startDate;
      const narrowsEnd = targetEndDate !== null
        && (project.targetEndDate === null || targetEndDate < project.targetEndDate);
      if (narrowsStart || narrowsEnd) {
        await this.assertProjectPlanWithinDates(tx, context.companyId, project.id, startDate, targetEndDate);
      }
      const changed = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, version: input.version },
        data: {
          ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.billingModel !== undefined ? { billingModel: input.billingModel } : {}),
          ...(input.startDate !== undefined ? { startDate } : {}),
          ...(input.targetEndDate !== undefined ? { targetEndDate } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const updated = await tx.professionalProject.findUniqueOrThrow({ where: { id: project.id } });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_UPDATED", "PROFESSIONAL_PROJECT", publicId);
      return { project: projectJson(updated, customer, await this.projectStats(tx, context.companyId, project.id)) };
    });
  }

  transitionProject(context: ActorContext, publicId: string, input: {
    version: number;
    status: ProjectStatus;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "TRANSITION_PROFESSIONAL_PROJECT", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const project = await this.lockProject(tx, context, publicId);
      if (project.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!transitionTable[project.status].includes(input.status)) throw new ProfessionalProjectError("INVALID_TRANSITION");
      if (input.status === "COMPLETED") {
        await this.assertProjectPlanComplete(tx, context.companyId, project.id);
      }
      const changed = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, version: input.version, status: project.status },
        data: { status: input.status, updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const updated = await tx.professionalProject.findUniqueOrThrow({ where: { id: project.id } });
      const customer = await this.requireCustomer(tx, context.companyId, project.customerId, false);
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_STATUS_CHANGED", "PROFESSIONAL_PROJECT", publicId, {
        from: project.status,
        to: input.status,
        reason: input.reason,
      });
      return { project: projectJson(updated, customer, await this.projectStats(tx, context.companyId, project.id)) };
    });
  }

  assignMember(context: ActorContext, publicId: string, input: {
    projectVersion: number;
    userId: bigint;
    role: MemberRole;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "ASSIGN_PROFESSIONAL_PROJECT_MEMBER", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const project = await this.mutableProject(tx, context, publicId, input.projectVersion);
      const person = await this.people.findActiveInCompany(tx, context.companyId, input.userId);
      if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
      const changed = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, version: input.projectVersion },
        data: { updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const existing = await tx.professionalProjectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: input.userId } },
      });
      const member = existing
        ? await tx.professionalProjectMember.update({
            where: { id: existing.id },
            data: {
              role: input.role,
              isActive: true,
              assignedAt: existing.isActive ? existing.assignedAt : new Date(),
              unassignedAt: null,
              updatedById: context.userId,
              version: { increment: 1 },
            },
          })
        : await tx.professionalProjectMember.create({
            data: {
              companyId: context.companyId,
              projectId: project.id,
              userId: input.userId,
              role: input.role,
              assignedById: context.userId,
              updatedById: context.userId,
            },
          });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_MEMBER_ASSIGNED", "PROFESSIONAL_PROJECT", publicId, {
        memberUserId: input.userId.toString(),
        role: input.role,
      });
      return { member: memberJson(member, person), projectVersion: input.projectVersion + 1 };
    });
  }

  unassignMember(context: ActorContext, publicId: string, userId: bigint, input: {
    projectVersion: number;
    memberVersion: number;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "UNASSIGN_PROFESSIONAL_PROJECT_MEMBER", input.idempotencyKey, { publicId, userId, ...input }, 200, async (tx) => {
      const project = await this.mutableProject(tx, context, publicId, input.projectVersion);
      const member = await tx.professionalProjectMember.findFirst({ where: { projectId: project.id, userId, companyId: context.companyId } });
      if (!member) throw new ProfessionalProjectError("MEMBER_NOT_FOUND");
      if (!member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      if (member.version !== input.memberVersion) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const openTask = await tx.professionalProjectTask.findFirst({
        where: {
          companyId: context.companyId,
          projectId: project.id,
          assigneeUserId: userId,
          status: { in: ["TODO", "IN_PROGRESS"] },
        },
        select: { id: true },
      });
      if (openTask) throw new ProfessionalProjectError("MEMBER_HAS_OPEN_TASKS");
      if (member.role === "MANAGER") {
        const managers = await tx.professionalProjectMember.count({ where: { projectId: project.id, companyId: context.companyId, role: "MANAGER", isActive: true } });
        if (managers <= 1) throw new ProfessionalProjectError("LAST_MANAGER");
      }
      const projectChanged = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, version: input.projectVersion },
        data: { updatedById: context.userId, version: { increment: 1 } },
      });
      if (projectChanged.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const memberChanged = await tx.professionalProjectMember.updateMany({
        where: { id: member.id, companyId: context.companyId, version: input.memberVersion, isActive: true },
        data: { isActive: false, unassignedAt: new Date(), updatedById: context.userId, version: { increment: 1 } },
      });
      if (memberChanged.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_MEMBER_UNASSIGNED", "PROFESSIONAL_PROJECT", publicId, {
        memberUserId: userId.toString(),
        reason: input.reason,
      });
      return { unassigned: true, projectVersion: input.projectVersion + 1, memberVersion: input.memberVersion + 1 };
    });
  }

  async listTimeEntries(context: ActorContext, input: {
    page: number;
    pageSize: number;
    projectId?: string | undefined;
    userId?: bigint | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    billable?: boolean | undefined;
  }) {
    let projectInternalId: bigint | undefined;
    if (input.projectId) {
      const project = await this.prisma.professionalProject.findFirst({ where: this.access.where(context, { publicId: input.projectId }), select: { id: true } });
      if (!project) return { data: [], meta: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 }, summary: { trackedMinutes: 0, billableMinutes: 0, nonBillableMinutes: 0 } };
      projectInternalId = project.id;
    }
    const where: Prisma.ProfessionalTimeEntryWhereInput = {
      companyId: context.companyId,
      member: { project: { is: this.access.scope(context) } },
      ...(projectInternalId ? { projectId: projectInternalId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.billable !== undefined ? { isBillable: input.billable } : {}),
      ...((input.dateFrom || input.dateTo) ? {
        workDate: {
          ...(input.dateFrom ? { gte: asDate(input.dateFrom) } : {}),
          ...(input.dateTo ? { lte: asDate(input.dateTo) } : {}),
        },
      } : {}),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      const [rows, total, sums] = await Promise.all([
        tx.professionalTimeEntry.findMany({
          where,
          include: { member: { include: { project: true } }, task: true },
          orderBy: [{ workDate: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        tx.professionalTimeEntry.count({ where }),
        tx.professionalTimeEntry.groupBy({ by: ["isBillable"], where, _sum: { minutes: true } }),
      ]);
      const userIds = [...new Set(rows.map((row) => row.userId.toString()))].map(BigInt);
      const periodStarts = [...new Set(rows.map((row) => dateString(weekStart(row.workDate))))].map(asDate);
      const locked = userIds.length && periodStarts.length ? await tx.professionalTimesheet.findMany({
        where: {
          companyId: context.companyId,
          userId: { in: userIds },
          periodStart: { in: periodStarts },
          status: { in: ["AWAITING_APPROVAL", "APPROVED"] },
        },
        select: { userId: true, periodStart: true },
      }) : [];
      return { rows, total, sums, locked };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const peopleMap = await this.peopleMap(context.companyId, result.rows.map((row) => row.userId));
    const lockedKeys = new Set(result.locked.map((row) => timesheetKey(row.userId, row.periodStart)));
    const billableMinutes = result.sums.find((row) => row.isBillable)?._sum.minutes ?? 0;
    const nonBillableMinutes = result.sums.find((row) => !row.isBillable)?._sum.minutes ?? 0;
    return {
      data: result.rows.map((row) => timeEntryJson(
        row,
        row.task,
        row.member.project,
        peopleMap.get(row.userId)!,
        row.userId === context.userId
          && row.member.isActive
          && row.member.project.status === "ACTIVE"
          && !lockedKeys.has(timesheetKey(row.userId, weekStart(row.workDate))),
      )),
      meta: { page: input.page, pageSize: input.pageSize, total: result.total, totalPages: Math.ceil(result.total / input.pageSize) },
      summary: { trackedMinutes: billableMinutes + nonBillableMinutes, billableMinutes, nonBillableMinutes },
    };
  }

  async createTimeEntry(context: ActorContext, input: {
    projectId: string;
    taskId?: string | null;
    workDate: string;
    minutes: number;
    isBillable: boolean;
    description: string;
    idempotencyKey: string;
  }) {
    const response = await this.executeCommand(context, "CREATE_PROFESSIONAL_TIME_ENTRY", input.idempotencyKey, input, 201, async (tx) => {
      await this.lockActiveTimesheetOwner(tx, context);
      await this.assertTimesheetPeriodsOpen(tx, context.companyId, context.userId, [weekStart(asDate(input.workDate))]);
      const project = await this.access.findAccessible(tx, context, { publicId: input.projectId });
      if (!project) throw new ProfessionalProjectError("NOT_FOUND");
      this.assertTimeAllowed(project, input.isBillable);
      const member = await tx.professionalProjectMember.findFirst({ where: { projectId: project.id, userId: context.userId, companyId: context.companyId } });
      if (!member) throw new ProfessionalProjectError("MEMBER_NOT_FOUND");
      if (!member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      const task = await this.requireTimeTask(tx, context.companyId, project.id, input.taskId);
      const person = await this.people.findActiveInCompany(tx, context.companyId, context.userId);
      if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
      const entry = await tx.professionalTimeEntry.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          taskId: task?.id ?? null,
          userId: context.userId,
          workDate: asDate(input.workDate),
          minutes: input.minutes,
          isBillable: input.isBillable,
          description: input.description,
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_CREATED", "PROFESSIONAL_TIME_ENTRY", entry.publicId, {
        projectId: project.publicId,
        taskId: task?.publicId ?? null,
        workDate: input.workDate,
        minutes: input.minutes,
        isBillable: input.isBillable,
      });
      return { timeEntry: timeEntryJson(entry, task, project, person, true) };
    });
    return {
      ...response,
      timeEntry: { ...response.timeEntry, task: response.timeEntry.task ?? null },
    };
  }

  updateTimeEntry(context: ActorContext, publicId: string, input: {
    version: number;
    taskId?: string | null;
    workDate?: string;
    minutes?: number;
    isBillable?: boolean;
    description?: string;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_TIME_ENTRY", companyId: context.companyId }, async (tx) => {
      await this.lockActiveTimesheetOwner(tx, context);
      const entry = await tx.professionalTimeEntry.findFirst({
        where: { publicId, companyId: context.companyId, userId: context.userId },
        include: { member: { include: { project: true } }, task: true },
      });
      if (!entry) throw new ProfessionalProjectError("NOT_FOUND");
      await this.access.assertAccessible(tx, context, entry.projectId, () => new ProfessionalProjectError("NOT_FOUND"));
      if (entry.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!entry.member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      this.assertTimeAllowed(entry.member.project, input.isBillable ?? entry.isBillable);
      const task = input.taskId === undefined
        ? entry.task
        : await this.requireTimeTask(tx, context.companyId, entry.projectId, input.taskId);
      await this.assertTimesheetPeriodsOpen(tx, context.companyId, context.userId, [
        weekStart(entry.workDate),
        weekStart(input.workDate ? asDate(input.workDate) : entry.workDate),
      ]);
      const changed = await tx.professionalTimeEntry.updateMany({
        where: { id: entry.id, companyId: context.companyId, userId: context.userId, version: input.version },
        data: {
          ...(input.taskId !== undefined ? { taskId: task?.id ?? null } : {}),
          ...(input.workDate !== undefined ? { workDate: asDate(input.workDate) } : {}),
          ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
          ...(input.isBillable !== undefined ? { isBillable: input.isBillable } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const updated = await tx.professionalTimeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { task: true } });
      const person = await this.people.findActiveInCompany(tx, context.companyId, context.userId);
      if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_UPDATED", "PROFESSIONAL_TIME_ENTRY", publicId, {
        taskId: updated.task?.publicId ?? null,
      });
      return { timeEntry: timeEntryJson(updated, updated.task, entry.member.project, person, true) };
    });
  }

  deleteTimeEntry(context: ActorContext, publicId: string, input: { version: number; reason: string }) {
    return this.transactions.execute({ operation: "DELETE_PROFESSIONAL_TIME_ENTRY", companyId: context.companyId }, async (tx) => {
      await this.lockActiveTimesheetOwner(tx, context);
      const entry = await tx.professionalTimeEntry.findFirst({
        where: { publicId, companyId: context.companyId, userId: context.userId },
        include: { member: { include: { project: true } } },
      });
      if (!entry) throw new ProfessionalProjectError("NOT_FOUND");
      await this.access.assertAccessible(tx, context, entry.projectId, () => new ProfessionalProjectError("NOT_FOUND"));
      if (entry.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!entry.member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      this.assertTimeAllowed(entry.member.project, entry.isBillable);
      await this.assertTimesheetPeriodsOpen(tx, context.companyId, context.userId, [weekStart(entry.workDate)]);
      const changed = await tx.professionalTimeEntry.deleteMany({ where: { id: entry.id, companyId: context.companyId, userId: context.userId, version: input.version } });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_DELETED", "PROFESSIONAL_TIME_ENTRY", publicId, { reason: input.reason });
      return { deleted: true };
    });
  }

  async requestTimesheetApprovalInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    publicId: string,
    expectedVersion: number,
  ) {
    const timesheet = await this.lockTimesheetForApproval(tx, context.companyId, publicId);
    if (timesheet.userId !== context.userId) throw new ProfessionalProjectError("NOT_TIMESHEET_OWNER");
    if (timesheet.version !== expectedVersion) throw new ProfessionalProjectError("VERSION_CONFLICT");
    if (timesheet.status !== "OPEN") throw new ProfessionalProjectError("TIMESHEET_INVALID_STATE");
    await this.requireActiveEmployee(tx, context.companyId, context.userId);
    const entries = await this.loadTimesheetEntries(tx, timesheet);
    if (entries.length === 0) throw new ProfessionalProjectError("TIMESHEET_EMPTY");
    const snapshot = timesheetSnapshot(entries);
    const submissionNumber = timesheet.lastSubmissionNumber + 1;
    await tx.professionalTimesheetSubmission.create({
      data: {
        companyId: context.companyId,
        timesheetId: timesheet.id,
        submissionNumber,
        entryReferences: snapshot.references,
        snapshotHashSha256: snapshot.hash,
        submittedById: context.userId,
      },
    });
    const submittedAt = new Date();
    const changed = await tx.professionalTimesheet.updateMany({
      where: { id: timesheet.id, companyId: context.companyId, version: expectedVersion, status: "OPEN" },
      data: {
        status: "AWAITING_APPROVAL",
        lastSubmissionNumber: submissionNumber,
        activeSubmissionNumber: submissionNumber,
        activeSnapshotHashSha256: snapshot.hash,
        submittedAt,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
    await this.audit(tx, context, "PROFESSIONAL_TIMESHEET_APPROVAL_REQUESTED", "PROFESSIONAL_TIMESHEET", publicId, {
      submissionNumber,
      entryCount: entries.length,
      snapshotHashSha256: snapshot.hash.toString("hex"),
    });
    return {
      subjectId: publicId,
      subjectVersion: expectedVersion + 1,
      subjectSnapshotHashSha256: snapshot.hash,
    };
  }

  async approveTimesheetInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; subjectVersion: number; subjectSnapshotHashSha256: Uint8Array },
  ) {
    const timesheet = await this.lockTimesheetForApproval(tx, context.companyId, input.subjectId);
    this.assertApprovalTimesheet(timesheet, input);
    const snapshot = timesheetSnapshot(await this.loadTimesheetEntries(tx, timesheet));
    if (!snapshot.hash.equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new ProfessionalProjectError("TIMESHEET_CHANGED");
    }
    const changed = await tx.professionalTimesheet.updateMany({
      where: {
        id: timesheet.id,
        companyId: context.companyId,
        version: input.subjectVersion,
        status: "AWAITING_APPROVAL",
      },
      data: { status: "APPROVED", version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
    await this.audit(tx, context, "PROFESSIONAL_TIMESHEET_APPROVED", "PROFESSIONAL_TIMESHEET", input.subjectId, {
      submissionNumber: timesheet.activeSubmissionNumber,
      snapshotHashSha256: snapshot.hash.toString("hex"),
    });
  }

  async rejectTimesheetInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; subjectVersion: number; subjectSnapshotHashSha256: Uint8Array; reason: string },
  ) {
    const timesheet = await this.lockTimesheetForApproval(tx, context.companyId, input.subjectId);
    this.assertApprovalTimesheet(timesheet, input);
    const snapshot = timesheetSnapshot(await this.loadTimesheetEntries(tx, timesheet));
    if (!snapshot.hash.equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new ProfessionalProjectError("TIMESHEET_CHANGED");
    }
    const changed = await tx.professionalTimesheet.updateMany({
      where: {
        id: timesheet.id,
        companyId: context.companyId,
        version: input.subjectVersion,
        status: "AWAITING_APPROVAL",
      },
      data: {
        status: "OPEN",
        activeSubmissionNumber: null,
        activeSnapshotHashSha256: null,
        submittedAt: null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
    await this.audit(tx, context, "PROFESSIONAL_TIMESHEET_REJECTED", "PROFESSIONAL_TIMESHEET", input.subjectId, {
      submissionNumber: timesheet.activeSubmissionNumber,
      reason: input.reason,
    });
  }

  private assertTimeAllowed(project: ProfessionalProject, isBillable: boolean) {
    if (project.status !== "ACTIVE") throw new ProfessionalProjectError("PROJECT_INACTIVE");
    if (project.billingModel === "NON_BILLABLE" && isBillable) throw new ProfessionalProjectError("BILLABLE_NOT_ALLOWED");
  }

  private assertApprovalTimesheet(
    timesheet: ProfessionalTimesheet,
    input: { subjectVersion: number; subjectSnapshotHashSha256: Uint8Array },
  ) {
    if (timesheet.version !== input.subjectVersion) throw new ProfessionalProjectError("VERSION_CONFLICT");
    if (timesheet.status !== "AWAITING_APPROVAL") throw new ProfessionalProjectError("TIMESHEET_INVALID_STATE");
    if (!timesheet.activeSnapshotHashSha256
      || !Buffer.from(timesheet.activeSnapshotHashSha256).equals(Buffer.from(input.subjectSnapshotHashSha256))) {
      throw new ProfessionalProjectError("TIMESHEET_CHANGED");
    }
  }

  private async lockActiveTimesheetOwner(tx: Prisma.TransactionClient, context: ActorContext) {
    if (!await this.people.lockAssignment(tx, context.companyId, context.userId)) {
      throw new ProfessionalProjectError("USER_NOT_FOUND");
    }
    if (!await this.people.findActiveInCompany(tx, context.companyId, context.userId)) {
      throw new ProfessionalProjectError("USER_NOT_FOUND");
    }
  }

  private async assertTimesheetPeriodsOpen(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
    periodStarts: Date[],
  ) {
    const unique = [...new Set(periodStarts.map(dateString))].sort().map(asDate);
    if (unique.length === 0) return;
    const rows = await tx.$queryRaw<Array<{ status: TimesheetStatus }>>(Prisma.sql`
      SELECT status FROM professional_timesheets
      WHERE company_id=${companyId} AND user_id=${userId}
        AND period_start IN (${Prisma.join(unique)})
      ORDER BY period_start
      FOR UPDATE`);
    if (rows.some((row) => row.status !== "OPEN")) throw new ProfessionalProjectError("TIMESHEET_LOCKED");
  }

  private async lockTimesheetForApproval(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    publicId: string,
  ) {
    const candidate = await tx.professionalTimesheet.findFirst({ where: { publicId, companyId }, select: { userId: true } });
    if (!candidate) throw new ProfessionalProjectError("NOT_FOUND");
    if (!await this.people.lockAssignment(tx, companyId, candidate.userId)) throw new ProfessionalProjectError("NOT_FOUND");
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM professional_timesheets
      WHERE public_id=${publicId} AND company_id=${companyId}
      FOR UPDATE`;
    if (rows.length !== 1) throw new ProfessionalProjectError("NOT_FOUND");
    return tx.professionalTimesheet.findFirstOrThrow({ where: { id: rows[0]!.id, companyId } });
  }

  private async requireActiveEmployee(tx: Prisma.TransactionClient, companyId: bigint, userId: bigint) {
    const employee = await this.employees.findByUserInCompany(tx, companyId, userId);
    if (!employee) throw new ProfessionalProjectError("EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") throw new ProfessionalProjectError("EMPLOYEE_INACTIVE");
    return employee;
  }

  private async requireTimeTask(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    projectId: bigint,
    taskPublicId: string | null | undefined,
  ) {
    if (taskPublicId === null || taskPublicId === undefined) return null;
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM professional_project_tasks
      WHERE public_id=${taskPublicId} AND company_id=${companyId} AND project_id=${projectId}
      FOR UPDATE`;
    if (rows.length !== 1) throw new ProfessionalProjectError("TASK_NOT_FOUND");
    const task = await tx.professionalProjectTask.findFirst({
      where: { id: rows[0]!.id, companyId, projectId },
      select: { id: true, publicId: true, titleAr: true, titleEn: true, status: true },
    });
    if (!task) throw new ProfessionalProjectError("TASK_NOT_FOUND");
    if (!["TODO", "IN_PROGRESS"].includes(task.status)) throw new ProfessionalProjectError("TASK_INACTIVE");
    return task;
  }

  private loadTimesheetEntries(
    tx: Prisma.TransactionClient,
    timesheet: Pick<ProfessionalTimesheet, "companyId" | "userId" | "periodStart" | "periodEnd">,
  ) {
    return tx.professionalTimeEntry.findMany({
      where: {
        companyId: timesheet.companyId,
        userId: timesheet.userId,
        workDate: { gte: timesheet.periodStart, lte: timesheet.periodEnd },
      },
      include: { member: { include: { project: true } }, task: true },
      orderBy: [{ id: "asc" }],
    });
  }

  private loadVisibleTimesheetEntries(
    tx: Prisma.TransactionClient,
    timesheet: Pick<ProfessionalTimesheet, "companyId" | "userId" | "periodStart" | "periodEnd">,
    context: ActorContext,
  ) {
    return tx.professionalTimeEntry.findMany({
      where: {
        companyId: timesheet.companyId,
        userId: timesheet.userId,
        workDate: { gte: timesheet.periodStart, lte: timesheet.periodEnd },
        member: { project: { is: this.access.scope(context) } },
      },
      include: { member: { include: { project: true } }, task: true },
      orderBy: [{ id: "asc" }],
    });
  }

  private statsFromEntries(entries: Array<Pick<ProfessionalTimeEntry, "minutes" | "isBillable">>): TimesheetStats {
    return entries.reduce<TimesheetStats>((stats, entry) => {
      stats.entryCount += 1;
      stats.trackedMinutes += entry.minutes;
      if (entry.isBillable) stats.billableMinutes += entry.minutes;
      return stats;
    }, { entryCount: 0, trackedMinutes: 0, billableMinutes: 0 });
  }

  private async timesheetStats(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    timesheets: Array<Pick<ProfessionalTimesheet, "userId" | "periodStart" | "periodEnd">>,
  ) {
    const stats = new Map<string, TimesheetStats>();
    for (const timesheet of timesheets) stats.set(timesheetKey(timesheet.userId, timesheet.periodStart), { entryCount: 0, trackedMinutes: 0, billableMinutes: 0 });
    if (timesheets.length === 0) return stats;
    const entries = await tx.professionalTimeEntry.findMany({
      where: {
        companyId: context.companyId,
        member: { project: { is: this.access.scope(context) } },
        OR: timesheets.map((timesheet) => ({
          userId: timesheet.userId,
          workDate: { gte: timesheet.periodStart, lte: timesheet.periodEnd },
        })),
      },
      select: { userId: true, workDate: true, minutes: true, isBillable: true },
    });
    for (const entry of entries) {
      const value = stats.get(timesheetKey(entry.userId, weekStart(entry.workDate)));
      if (!value) continue;
      value.entryCount += 1;
      value.trackedMinutes += entry.minutes;
      if (entry.isBillable) value.billableMinutes += entry.minutes;
    }
    return stats;
  }

  private async mutableProject(tx: Prisma.TransactionClient, context: ActorContext, publicId: string, version: number) {
    const project = await this.lockProject(tx, context, publicId);
    if (project.version !== version) throw new ProfessionalProjectError("VERSION_CONFLICT");
    if (!["ACTIVE", "ON_HOLD"].includes(project.status)) throw new ProfessionalProjectError("PROJECT_INACTIVE");
    return project;
  }

  private lockProject(tx: Prisma.TransactionClient, context: ActorContext, publicId: string) {
    return this.access.lockAccessible(tx, context, publicId, () => new ProfessionalProjectError("NOT_FOUND"));
  }

  private async assertProjectPlanComplete(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    projectId: bigint,
  ) {
    const [stage, task] = await Promise.all([
      tx.professionalProjectStage.findFirst({
        where: { companyId, projectId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { id: true },
      }),
      tx.professionalProjectTask.findFirst({
        where: { companyId, projectId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { id: true },
      }),
    ]);
    if (stage || task) throw new ProfessionalProjectError("PROJECT_PLAN_INCOMPLETE");
  }

  private async assertProjectPlanWithinDates(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    projectId: bigint,
    startDate: Date,
    targetEndDate: Date | null,
  ) {
    const stageOutsideDates: Prisma.ProfessionalProjectStageWhereInput[] = [
      { plannedStartDate: { lt: startDate } },
      { targetEndDate: { lt: startDate } },
    ];
    const taskOutsideDates: Prisma.ProfessionalProjectTaskWhereInput[] = [
      { plannedStartDate: { lt: startDate } },
      { dueDate: { lt: startDate } },
    ];
    if (targetEndDate) {
      stageOutsideDates.push(
        { plannedStartDate: { gt: targetEndDate } },
        { targetEndDate: { gt: targetEndDate } },
      );
      taskOutsideDates.push(
        { plannedStartDate: { gt: targetEndDate } },
        { dueDate: { gt: targetEndDate } },
      );
    }
    const [stage, task] = await Promise.all([
      tx.professionalProjectStage.findFirst({
        where: { companyId, projectId, OR: stageOutsideDates },
        select: { id: true },
      }),
      tx.professionalProjectTask.findFirst({
        where: { companyId, projectId, OR: taskOutsideDates },
        select: { id: true },
      }),
    ]);
    if (stage || task) throw new ProfessionalProjectError("PROJECT_PLAN_OUTSIDE_DATES");
  }

  private async requireCustomer(tx: Prisma.TransactionClient, companyId: bigint, customerId: bigint, requireActive = true) {
    const customer = await this.customers.findInCompany(tx, companyId, customerId);
    if (!customer) throw new ProfessionalProjectError("CUSTOMER_NOT_FOUND");
    if (requireActive && !customer.isActive) throw new ProfessionalProjectError("CUSTOMER_INACTIVE");
    return customer;
  }

  private async projectStats(tx: Prisma.TransactionClient, companyId: bigint, projectId: bigint): Promise<ProjectStats> {
    const [memberCount, time] = await Promise.all([
      tx.professionalProjectMember.count({ where: { projectId, companyId, isActive: true } }),
      tx.professionalTimeEntry.groupBy({ by: ["isBillable"], where: { projectId, companyId }, _sum: { minutes: true } }),
    ]);
    let trackedMinutes = 0;
    let billableMinutes = 0;
    for (const row of time) {
      trackedMinutes += row._sum.minutes ?? 0;
      if (row.isBillable) billableMinutes += row._sum.minutes ?? 0;
    }
    return { memberCount, trackedMinutes, billableMinutes };
  }

  private async customerMap(companyId: bigint, ids: bigint[]) {
    const unique = [...new Set(ids.map(String))].map(BigInt);
    const rows = unique.length ? await this.customers.listInCompany(companyId, { ids: unique, limit: unique.length }) : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async peopleMap(companyId: bigint, ids: bigint[]) {
    const unique = [...new Set(ids.map(String))].map(BigInt);
    const rows = unique.length ? await this.people.listActiveInCompany(companyId, { ids: unique, limit: unique.length }) : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async employeeMap(companyId: bigint, userIds: bigint[]) {
    const unique = [...new Set(userIds.map(String))].map(BigInt);
    const rows = await this.employees.listByUsersInCompany(companyId, unique);
    return new Map(rows.map((row) => [row.userId, row]));
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: Record<string, unknown>,
    responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint, (_name, value) => typeof value === "bigint" ? value.toString() : value),
      responseStatus,
      errors: {
        mismatch: () => new ProfessionalProjectError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ProfessionalProjectError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: string,
    entityId: string,
    details?: Prisma.InputJsonObject,
  ) {
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        ...(details ? { details } : {}),
      },
    });
  }
}
