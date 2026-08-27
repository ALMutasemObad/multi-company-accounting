import {
  Prisma,
  type PrismaClient,
  type ProfessionalProject,
  type ProfessionalProjectMember,
  type ProfessionalTimeEntry,
} from "@prisma/client";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";
import type {
  ProfessionalCustomerPort,
  ProfessionalCustomerReference,
  ProfessionalPeoplePort,
  ProfessionalPersonReference,
} from "./project-reference-ports.js";

export type ProfessionalProjectFailureReason =
  | "NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_INACTIVE"
  | "USER_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_INACTIVE"
  | "PROJECT_INACTIVE"
  | "INVALID_TRANSITION"
  | "INVALID_DATE_RANGE"
  | "VERSION_CONFLICT"
  | "BILLABLE_NOT_ALLOWED"
  | "BILLABLE_TIME_EXISTS"
  | "LAST_MANAGER"
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

type ProjectStats = { memberCount: number; trackedMinutes: number; billableMinutes: number };

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
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

  constructor(
    private readonly prisma: PrismaClient,
    private readonly customers: ProfessionalCustomerPort,
    private readonly people: ProfessionalPeoplePort,
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
    const where: Prisma.ProfessionalProjectWhereInput = {
      companyId: context.companyId,
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
      const project = await tx.professionalProject.findFirst({ where: { publicId, companyId: context.companyId } });
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
      const project = await tx.professionalProject.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!project) throw new ProfessionalProjectError("NOT_FOUND");
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
      const project = await tx.professionalProject.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!project) throw new ProfessionalProjectError("NOT_FOUND");
      if (project.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!transitionTable[project.status].includes(input.status)) throw new ProfessionalProjectError("INVALID_TRANSITION");
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
      const project = await this.mutableProject(tx, context.companyId, publicId, input.projectVersion);
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
      const project = await this.mutableProject(tx, context.companyId, publicId, input.projectVersion);
      const member = await tx.professionalProjectMember.findFirst({ where: { projectId: project.id, userId, companyId: context.companyId } });
      if (!member) throw new ProfessionalProjectError("MEMBER_NOT_FOUND");
      if (!member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      if (member.version !== input.memberVersion) throw new ProfessionalProjectError("VERSION_CONFLICT");
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
      const project = await this.prisma.professionalProject.findFirst({ where: { publicId: input.projectId, companyId: context.companyId }, select: { id: true } });
      if (!project) return { data: [], meta: { page: input.page, pageSize: input.pageSize, total: 0, totalPages: 0 }, summary: { trackedMinutes: 0, billableMinutes: 0, nonBillableMinutes: 0 } };
      projectInternalId = project.id;
    }
    const where: Prisma.ProfessionalTimeEntryWhereInput = {
      companyId: context.companyId,
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
          include: { member: { include: { project: true } } },
          orderBy: [{ workDate: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        tx.professionalTimeEntry.count({ where }),
        tx.professionalTimeEntry.groupBy({ by: ["isBillable"], where, _sum: { minutes: true } }),
      ]);
      return { rows, total, sums };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const peopleMap = await this.peopleMap(context.companyId, result.rows.map((row) => row.userId));
    const billableMinutes = result.sums.find((row) => row.isBillable)?._sum.minutes ?? 0;
    const nonBillableMinutes = result.sums.find((row) => !row.isBillable)?._sum.minutes ?? 0;
    return {
      data: result.rows.map((row) => timeEntryJson(
        row,
        row.member.project,
        peopleMap.get(row.userId)!,
        row.userId === context.userId && row.member.isActive && row.member.project.status === "ACTIVE",
      )),
      meta: { page: input.page, pageSize: input.pageSize, total: result.total, totalPages: Math.ceil(result.total / input.pageSize) },
      summary: { trackedMinutes: billableMinutes + nonBillableMinutes, billableMinutes, nonBillableMinutes },
    };
  }

  createTimeEntry(context: ActorContext, input: {
    projectId: string;
    workDate: string;
    minutes: number;
    isBillable: boolean;
    description: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_TIME_ENTRY", input.idempotencyKey, input, 201, async (tx) => {
      const project = await tx.professionalProject.findFirst({ where: { publicId: input.projectId, companyId: context.companyId } });
      if (!project) throw new ProfessionalProjectError("NOT_FOUND");
      this.assertTimeAllowed(project, input.isBillable);
      const member = await tx.professionalProjectMember.findFirst({ where: { projectId: project.id, userId: context.userId, companyId: context.companyId } });
      if (!member) throw new ProfessionalProjectError("MEMBER_NOT_FOUND");
      if (!member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      const person = await this.people.findActiveInCompany(tx, context.companyId, context.userId);
      if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
      const entry = await tx.professionalTimeEntry.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          userId: context.userId,
          workDate: asDate(input.workDate),
          minutes: input.minutes,
          isBillable: input.isBillable,
          description: input.description,
        },
      });
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_CREATED", "PROFESSIONAL_TIME_ENTRY", entry.publicId, {
        projectId: project.publicId,
        workDate: input.workDate,
        minutes: input.minutes,
        isBillable: input.isBillable,
      });
      return { timeEntry: timeEntryJson(entry, project, person, true) };
    });
  }

  updateTimeEntry(context: ActorContext, publicId: string, input: {
    version: number;
    workDate?: string;
    minutes?: number;
    isBillable?: boolean;
    description?: string;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_TIME_ENTRY", companyId: context.companyId }, async (tx) => {
      const entry = await tx.professionalTimeEntry.findFirst({
        where: { publicId, companyId: context.companyId, userId: context.userId },
        include: { member: { include: { project: true } } },
      });
      if (!entry) throw new ProfessionalProjectError("NOT_FOUND");
      if (entry.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!entry.member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      this.assertTimeAllowed(entry.member.project, input.isBillable ?? entry.isBillable);
      const changed = await tx.professionalTimeEntry.updateMany({
        where: { id: entry.id, companyId: context.companyId, userId: context.userId, version: input.version },
        data: {
          ...(input.workDate !== undefined ? { workDate: asDate(input.workDate) } : {}),
          ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
          ...(input.isBillable !== undefined ? { isBillable: input.isBillable } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      const updated = await tx.professionalTimeEntry.findUniqueOrThrow({ where: { id: entry.id } });
      const person = await this.people.findActiveInCompany(tx, context.companyId, context.userId);
      if (!person) throw new ProfessionalProjectError("USER_NOT_FOUND");
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_UPDATED", "PROFESSIONAL_TIME_ENTRY", publicId);
      return { timeEntry: timeEntryJson(updated, entry.member.project, person, true) };
    });
  }

  deleteTimeEntry(context: ActorContext, publicId: string, input: { version: number; reason: string }) {
    return this.transactions.execute({ operation: "DELETE_PROFESSIONAL_TIME_ENTRY", companyId: context.companyId }, async (tx) => {
      const entry = await tx.professionalTimeEntry.findFirst({
        where: { publicId, companyId: context.companyId, userId: context.userId },
        include: { member: { include: { project: true } } },
      });
      if (!entry) throw new ProfessionalProjectError("NOT_FOUND");
      if (entry.version !== input.version) throw new ProfessionalProjectError("VERSION_CONFLICT");
      if (!entry.member.isActive) throw new ProfessionalProjectError("MEMBER_INACTIVE");
      this.assertTimeAllowed(entry.member.project, entry.isBillable);
      const changed = await tx.professionalTimeEntry.deleteMany({ where: { id: entry.id, companyId: context.companyId, userId: context.userId, version: input.version } });
      if (changed.count !== 1) throw new ProfessionalProjectError("VERSION_CONFLICT");
      await this.audit(tx, context, "PROFESSIONAL_TIME_ENTRY_DELETED", "PROFESSIONAL_TIME_ENTRY", publicId, { reason: input.reason });
      return { deleted: true };
    });
  }

  private assertTimeAllowed(project: ProfessionalProject, isBillable: boolean) {
    if (project.status !== "ACTIVE") throw new ProfessionalProjectError("PROJECT_INACTIVE");
    if (project.billingModel === "NON_BILLABLE" && isBillable) throw new ProfessionalProjectError("BILLABLE_NOT_ALLOWED");
  }

  private async mutableProject(tx: Prisma.TransactionClient, companyId: bigint, publicId: string, version: number) {
    const project = await tx.professionalProject.findFirst({ where: { publicId, companyId } });
    if (!project) throw new ProfessionalProjectError("NOT_FOUND");
    if (project.version !== version) throw new ProfessionalProjectError("VERSION_CONFLICT");
    if (!["ACTIVE", "ON_HOLD"].includes(project.status)) throw new ProfessionalProjectError("PROJECT_INACTIVE");
    return project;
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
    return tx.auditLog.create({
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
