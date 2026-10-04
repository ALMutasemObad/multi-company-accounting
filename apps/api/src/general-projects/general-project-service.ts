import { Prisma, type GeneralProject, type GeneralProjectMember, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { transitionProject } from "./general-project-policy.js";
import type { GeneralProjectCustomerPort, GeneralProjectCustomerReference, GeneralProjectEmployeePort, GeneralProjectEmployeeReference } from "./general-project-reference-ports.js";

export type GeneralProjectFailureReason = "NOT_FOUND" | "CUSTOMER_NOT_FOUND" | "CUSTOMER_INACTIVE" | "EMPLOYEE_NOT_FOUND" | "EMPLOYEE_INACTIVE" | "INVALID_DATE_RANGE" | "PROJECT_FINAL" | "LAST_MANAGER" | "MEMBER_NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_MISMATCH" | "IDEMPOTENCY_IN_PROGRESS";
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
      transitionProject({ from: project.status, to: input.status, activeManagerCount, phaseStatuses: [], taskStatuses: [], ...(input.reason === undefined ? {} : { reason: input.reason }) });
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
      const updated = await tx.generalProjectMember.update({ where: { id: member.id }, data: { isActive: false, unassignedAt: new Date(), updatedById: context.userId, version: { increment: 1 } } });
      await this.bumpProject(tx, context, project);
      await this.audit(tx, context, "GENERAL_PROJECT_MEMBER_UNASSIGNED", publicId, { memberId: memberPublicId, reason: input.reason });
      return { memberId: updated.publicId, projectVersion: project.version + 1 };
    });
  }

  private async command<T>(context: ActorContext, operation: string, key: string, input: unknown, responseStatus: number, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.commands.execute({ context, operation, key, fingerprint: JSON.stringify(input, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value), responseStatus,
      errors: { mismatch: () => new GeneralProjectError("IDEMPOTENCY_MISMATCH"), inProgress: () => new GeneralProjectError("IDEMPOTENCY_IN_PROGRESS") } }, work);
  }
  private async lockProject(tx: Prisma.TransactionClient, context: ActorContext, publicId: string, version: number) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM general_projects WHERE company_id = ${context.companyId} AND public_id = ${publicId} FOR UPDATE`;
    if (!rows[0]) throw new GeneralProjectError("NOT_FOUND");
    const row = await tx.generalProject.findFirst({ where: { companyId: context.companyId, id: rows[0].id } });
    if (!row) throw new GeneralProjectError("NOT_FOUND");
    if (row.version !== version) throw new GeneralProjectError("VERSION_CONFLICT");
    return row;
  }
  private async bumpProject(tx: Prisma.TransactionClient, context: ActorContext, project: GeneralProject) {
    const changed = await tx.generalProject.updateMany({ where: { id: project.id, companyId: context.companyId, version: project.version }, data: { version: { increment: 1 }, updatedById: context.userId } });
    if (changed.count !== 1) throw new GeneralProjectError("VERSION_CONFLICT");
  }
  private async requireCustomer(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const row = await this.customers.findInCompany(tx, companyId, id);
    if (!row) throw new GeneralProjectError("CUSTOMER_NOT_FOUND");
    if (!row.isActive) throw new GeneralProjectError("CUSTOMER_INACTIVE");
    return row;
  }
  private validateDates(start: string | null, end: string | null) { if (start && end && end < start) throw new GeneralProjectError("INVALID_DATE_RANGE"); }
  private customerMap = async (companyId: bigint, ids: bigint[]) => new Map((await this.customers.listByIds(companyId, [...new Set(ids)])).map(row => [row.id, row]));
  private employeeMap = async (companyId: bigint, ids: bigint[]) => new Map((await this.employees.listByInternalIds(companyId, [...new Set(ids)])).map(row => [row.id, row]));
  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityId: string, details?: Prisma.InputJsonObject) {
    return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action, entityType: "GENERAL_PROJECT", entityId, ...(details ? { details } : {}) } });
  }
}
