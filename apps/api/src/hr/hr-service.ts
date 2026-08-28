import {
  Prisma,
  type Employee,
  type EmploymentContract,
  type HrDepartment,
  type HrPosition,
  type PrismaClient,
} from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { HrIdentityPort, HrIdentityReference } from "./hr-identity-port.js";

type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN";
type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";
type ContractType = "PERMANENT" | "FIXED_TERM" | "CONSULTANT" | "INTERNSHIP";

export type HrFailureReason =
  | "NOT_FOUND"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_INACTIVE"
  | "REFERENCE_IN_USE"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_LINKED"
  | "MANAGER_NOT_FOUND"
  | "MANAGER_INACTIVE"
  | "MANAGER_CYCLE"
  | "EMPLOYEE_TERMINATED"
  | "INVALID_TRANSITION"
  | "INVALID_DATE_RANGE"
  | "ACTIVE_CONTRACT_EXISTS"
  | "CONTRACT_NOT_ACTIVE"
  | "REASON_REQUIRED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class HrError extends Error {
  constructor(public readonly reason: HrFailureReason) {
    super(reason);
  }
}

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const identityJson = (value: HrIdentityReference) => ({
  id: value.id.toString(),
  displayName: value.displayName,
  nameEn: value.nameEn,
});
const structureJson = (value: HrDepartment | HrPosition) => ({
  id: value.publicId,
  code: value.code,
  nameAr: value.nameAr,
  nameEn: value.nameEn,
  description: value.description,
  isActive: value.isActive,
  version: value.version,
  createdAt: value.createdAt.toISOString(),
  updatedAt: value.updatedAt.toISOString(),
});
const employeeReferenceJson = (employee: Pick<Employee, "publicId" | "employeeNumber" | "nameAr" | "nameEn">) => ({
  id: employee.publicId,
  employeeNumber: employee.employeeNumber,
  nameAr: employee.nameAr,
  nameEn: employee.nameEn,
});
const employeeInclude = {
  department: true,
  position: true,
  manager: true,
  contracts: { where: { status: "ACTIVE" as const }, select: { id: true }, take: 1 },
} satisfies Prisma.EmployeeInclude;
type EmployeeWithReferences = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

function employeeJson(employee: EmployeeWithReferences, linkedUser: HrIdentityReference | null) {
  return {
    id: employee.publicId,
    employeeNumber: employee.employeeNumber,
    nameAr: employee.nameAr,
    nameEn: employee.nameEn,
    employmentType: employee.employmentType,
    status: employee.status,
    hireDate: dateString(employee.hireDate),
    terminationDate: employee.terminationDate ? dateString(employee.terminationDate) : null,
    terminationReason: employee.terminationReason,
    workLocation: employee.workLocation,
    department: employee.department ? structureJson(employee.department) : null,
    position: employee.position ? structureJson(employee.position) : null,
    manager: employee.manager ? employeeReferenceJson(employee.manager) : null,
    linkedUser: linkedUser ? identityJson(linkedUser) : null,
    hasActiveContract: employee.contracts.length > 0,
    version: employee.version,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

function contractJson(contract: EmploymentContract) {
  return {
    id: contract.publicId,
    contractType: contract.contractType,
    titleAr: contract.titleAr,
    titleEn: contract.titleEn,
    startDate: dateString(contract.startDate),
    endDate: contract.endDate ? dateString(contract.endDate) : null,
    status: contract.status,
    notes: contract.notes,
    endReason: contract.endReason,
    endedAt: contract.endedAt?.toISOString() ?? null,
    version: contract.version,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
  };
}

const transitions: Record<EmploymentStatus, readonly EmploymentStatus[]> = {
  ACTIVE: ["ON_LEAVE", "TERMINATED"],
  ON_LEAVE: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
};

export class HrService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: HrIdentityPort,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async listDepartments(context: ActorContext, input: { active?: boolean | undefined; search?: string | undefined }) {
    const rows = await this.prisma.hrDepartment.findMany({
      where: {
        companyId: context.companyId,
        ...(input.active === undefined ? {} : { isActive: input.active }),
        ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
      },
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }, { id: "asc" }],
    });
    return { data: rows.map(structureJson) };
  }

  createDepartment(context: ActorContext, input: { nameAr: string; nameEn?: string | null; description?: string | null; idempotencyKey: string }) {
    return this.executeCommand(context, "CREATE_HR_DEPARTMENT", input.idempotencyKey, input, 201, async (tx) => {
      const department = await tx.hrDepartment.create({
        data: {
          companyId: context.companyId,
          code: await reserveMasterDataCode(tx, context.companyId, "HR_DEPARTMENT"),
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          description: input.description ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "HR_DEPARTMENT_CREATED", "HR_DEPARTMENT", department.publicId);
      return { department: structureJson(department) };
    });
  }

  async updateDepartment(context: ActorContext, publicId: string, input: { version: number; nameAr?: string; nameEn?: string | null; description?: string | null; isActive?: boolean; reason?: string }): Promise<{ department: ReturnType<typeof structureJson> }> {
    const result = await this.updateStructure(context, "department", publicId, input);
    const department = "department" in result ? result.department : undefined;
    if (!department) throw new Error("HR_STRUCTURE_RESULT_MISMATCH");
    return { department };
  }

  async listPositions(context: ActorContext, input: { active?: boolean | undefined; search?: string | undefined }) {
    const rows = await this.prisma.hrPosition.findMany({
      where: {
        companyId: context.companyId,
        ...(input.active === undefined ? {} : { isActive: input.active }),
        ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
      },
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }, { id: "asc" }],
    });
    return { data: rows.map(structureJson) };
  }

  createPosition(context: ActorContext, input: { nameAr: string; nameEn?: string | null; description?: string | null; idempotencyKey: string }) {
    return this.executeCommand(context, "CREATE_HR_POSITION", input.idempotencyKey, input, 201, async (tx) => {
      const position = await tx.hrPosition.create({
        data: {
          companyId: context.companyId,
          code: await reserveMasterDataCode(tx, context.companyId, "HR_POSITION"),
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          description: input.description ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "HR_POSITION_CREATED", "HR_POSITION", position.publicId);
      return { position: structureJson(position) };
    });
  }

  async updatePosition(context: ActorContext, publicId: string, input: { version: number; nameAr?: string; nameEn?: string | null; description?: string | null; isActive?: boolean; reason?: string }): Promise<{ position: ReturnType<typeof structureJson> }> {
    const result = await this.updateStructure(context, "position", publicId, input);
    const position = "position" in result ? result.position : undefined;
    if (!position) throw new Error("HR_STRUCTURE_RESULT_MISMATCH");
    return { position };
  }

  async listEmployees(context: ActorContext, input: { page: number; pageSize: number; search?: string | undefined; status?: EmploymentStatus | undefined; departmentId?: string | undefined }) {
    const where: Prisma.EmployeeWhereInput = {
      companyId: context.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.departmentId ? { department: { publicId: input.departmentId, companyId: context.companyId } } : {}),
      ...(input.search ? { OR: [{ employeeNumber: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    const people = await this.identityMap(context.companyId, rows.flatMap((row) => row.userId === null ? [] : [row.userId]));
    return {
      data: rows.map((row) => employeeJson(row, row.userId === null ? null : people.get(row.userId) ?? null)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
    };
  }

  async getEmployee(context: ActorContext, publicId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { publicId, companyId: context.companyId },
      include: employeeInclude,
    });
    if (!employee) throw new HrError("NOT_FOUND");
    const linkedUser = employee.userId === null
      ? null
      : (await this.identity.listInCompany(context.companyId, { ids: [employee.userId], limit: 1 }))[0] ?? null;
    return { employee: employeeJson(employee, linkedUser) };
  }

  async createEmployee(context: ActorContext, input: {
    nameAr: string;
    nameEn?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
    managerEmployeeId?: string | null;
    employmentType: EmploymentType;
    hireDate: string;
    workLocation?: string | null;
    idempotencyKey: string;
  }) {
    try {
      return await this.executeCommand(context, "CREATE_EMPLOYEE", input.idempotencyKey, input, 201, async (tx) => {
        const department = input.departmentId ? await this.requireDepartment(tx, context.companyId, input.departmentId, true) : null;
        const position = input.positionId ? await this.requirePosition(tx, context.companyId, input.positionId, true) : null;
        if (input.managerEmployeeId) await this.lockEmployeeHierarchy(tx, context.companyId);
        const manager = input.managerEmployeeId ? await this.requireManager(tx, context.companyId, input.managerEmployeeId) : null;
        const employee = await tx.employee.create({
          data: {
            companyId: context.companyId,
            departmentId: department?.id ?? null,
            positionId: position?.id ?? null,
            managerEmployeeId: manager?.id ?? null,
            employeeNumber: await reserveMasterDataCode(tx, context.companyId, "EMPLOYEE"),
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            employmentType: input.employmentType,
            hireDate: asDate(input.hireDate),
            workLocation: input.workLocation ?? null,
            createdById: context.userId,
            updatedById: context.userId,
          },
        });
        await this.audit(tx, context, "EMPLOYEE_CREATED", "EMPLOYEE", employee.publicId, {
          employmentType: employee.employmentType,
          linkedToUser: false,
        });
        const complete = await tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include: employeeInclude });
        return { employee: employeeJson(complete, null) };
      });
    } catch (error) {
      this.mapEmployeeUniqueConflict(error);
      throw error;
    }
  }

  async updateEmployee(context: ActorContext, publicId: string, input: {
    version: number;
    nameAr?: string;
    nameEn?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
    managerEmployeeId?: string | null;
    employmentType?: EmploymentType;
    hireDate?: string;
    workLocation?: string | null;
  }) {
    try {
      return await this.transactions.execute({ operation: "UPDATE_EMPLOYEE", companyId: context.companyId }, async (tx) => {
        const department = input.departmentId ? await this.requireDepartment(tx, context.companyId, input.departmentId, true) : null;
        const position = input.positionId ? await this.requirePosition(tx, context.companyId, input.positionId, true) : null;
        if (input.managerEmployeeId !== undefined) await this.lockEmployeeHierarchy(tx, context.companyId);
        else await this.lockEmployeeByPublicId(tx, context.companyId, publicId);
        const employee = await tx.employee.findFirst({ where: { publicId, companyId: context.companyId } });
        if (!employee) throw new HrError("NOT_FOUND");
        if (employee.version !== input.version) throw new HrError("VERSION_CONFLICT");
        if (employee.status === "TERMINATED") throw new HrError("EMPLOYEE_TERMINATED");
        const linkedUser = employee.userId === null ? null : await this.identity.findInCompany(tx, context.companyId, employee.userId);
        const manager = input.managerEmployeeId === undefined
          ? undefined
          : input.managerEmployeeId === null ? null : await this.requireManager(tx, context.companyId, input.managerEmployeeId);
        if (manager) await this.assertNoManagerCycle(tx, context.companyId, employee.id, manager.id);
        if (input.hireDate !== undefined) {
          const earlierContract = await tx.employmentContract.findFirst({
            where: { employeeId: employee.id, companyId: context.companyId, startDate: { lt: asDate(input.hireDate) } },
            select: { id: true },
          });
          if (earlierContract) throw new HrError("INVALID_DATE_RANGE");
        }
        const changed = await tx.employee.updateMany({
          where: { id: employee.id, companyId: context.companyId, version: input.version, status: employee.status },
          data: {
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.departmentId !== undefined ? { departmentId: department?.id ?? null } : {}),
            ...(input.positionId !== undefined ? { positionId: position?.id ?? null } : {}),
            ...(input.managerEmployeeId !== undefined ? { managerEmployeeId: manager?.id ?? null } : {}),
            ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
            ...(input.hireDate !== undefined ? { hireDate: asDate(input.hireDate) } : {}),
            ...(input.workLocation !== undefined ? { workLocation: input.workLocation } : {}),
            updatedById: context.userId,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new HrError("VERSION_CONFLICT");
        const updated = await tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include: employeeInclude });
        await this.audit(tx, context, "EMPLOYEE_UPDATED", "EMPLOYEE", publicId);
        return { employee: employeeJson(updated, linkedUser) };
      });
    } catch (error) {
      this.mapEmployeeUniqueConflict(error);
      throw error;
    }
  }

  transitionEmployee(context: ActorContext, publicId: string, input: {
    version: number;
    status: EmploymentStatus;
    effectiveDate?: string | null;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "TRANSITION_EMPLOYEE", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      await this.lockEmployeeByPublicId(tx, context.companyId, publicId);
      const employee = await tx.employee.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!employee) throw new HrError("NOT_FOUND");
      if (employee.version !== input.version) throw new HrError("VERSION_CONFLICT");
      if (!transitions[employee.status].includes(input.status)) throw new HrError("INVALID_TRANSITION");
      const terminationDate = input.status === "TERMINATED"
        ? input.effectiveDate ? asDate(input.effectiveDate) : null
        : null;
      if (input.status === "TERMINATED" && (!terminationDate || terminationDate < employee.hireDate)) throw new HrError("INVALID_DATE_RANGE");
      if (terminationDate) {
        const futureContract = await tx.employmentContract.findFirst({
          where: { employeeId: employee.id, companyId: context.companyId, status: "ACTIVE", startDate: { gt: terminationDate } },
          select: { id: true },
        });
        if (futureContract) throw new HrError("INVALID_DATE_RANGE");
      }
      const changed = await tx.employee.updateMany({
        where: { id: employee.id, companyId: context.companyId, version: input.version, status: employee.status },
        data: {
          status: input.status,
          terminationDate,
          terminationReason: input.status === "TERMINATED" ? input.reason : null,
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new HrError("VERSION_CONFLICT");
      if (terminationDate) {
        await tx.employmentContract.updateMany({
          where: { employeeId: employee.id, companyId: context.companyId, status: "ACTIVE" },
          data: {
            status: "ENDED",
            endDate: terminationDate,
            endReason: input.reason,
            endedAt: new Date(),
            endedById: context.userId,
            updatedById: context.userId,
            version: { increment: 1 },
          },
        });
      }
      const updated = await tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include: employeeInclude });
      const linkedUser = employee.userId === null ? null : await this.identity.findInCompany(tx, context.companyId, employee.userId);
      await this.audit(tx, context, "EMPLOYEE_STATUS_CHANGED", "EMPLOYEE", publicId, {
        from: employee.status,
        to: input.status,
        effectiveDate: input.effectiveDate ?? null,
        reason: input.reason,
      });
      return { employee: employeeJson(updated, linkedUser) };
    });
  }

  async listContracts(context: ActorContext, employeePublicId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { publicId: employeePublicId, companyId: context.companyId } });
    if (!employee) throw new HrError("NOT_FOUND");
    const rows = await this.prisma.employmentContract.findMany({
      where: { employeeId: employee.id, companyId: context.companyId },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
    });
    return { data: rows.map(contractJson) };
  }

  createContract(context: ActorContext, employeePublicId: string, input: {
    contractType: ContractType;
    titleAr: string;
    titleEn?: string | null;
    startDate: string;
    endDate?: string | null;
    notes?: string | null;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_EMPLOYMENT_CONTRACT", input.idempotencyKey, { employeePublicId, ...input }, 201, async (tx) => {
      await this.lockEmployeeByPublicId(tx, context.companyId, employeePublicId);
      const employee = await tx.employee.findFirst({ where: { publicId: employeePublicId, companyId: context.companyId } });
      if (!employee) throw new HrError("NOT_FOUND");
      if (employee.status === "TERMINATED") throw new HrError("EMPLOYEE_TERMINATED");
      const startDate = asDate(input.startDate);
      const endDate = input.endDate ? asDate(input.endDate) : null;
      if (startDate < employee.hireDate || (endDate && endDate < startDate)) throw new HrError("INVALID_DATE_RANGE");
      if (await tx.employmentContract.count({ where: { employeeId: employee.id, companyId: context.companyId, status: "ACTIVE" } })) {
        throw new HrError("ACTIVE_CONTRACT_EXISTS");
      }
      const contract = await tx.employmentContract.create({
        data: {
          companyId: context.companyId,
          employeeId: employee.id,
          contractType: input.contractType,
          titleAr: input.titleAr,
          titleEn: input.titleEn ?? null,
          startDate,
          endDate,
          notes: input.notes ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.audit(tx, context, "EMPLOYMENT_CONTRACT_CREATED", "EMPLOYMENT_CONTRACT", contract.publicId, {
        employeeId: employee.publicId,
        contractType: contract.contractType,
      });
      return { contract: contractJson(contract) };
    });
  }

  endContract(context: ActorContext, employeePublicId: string, contractPublicId: string, input: {
    version: number;
    endDate: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "END_EMPLOYMENT_CONTRACT", input.idempotencyKey, { employeePublicId, contractPublicId, ...input }, 200, async (tx) => {
      await this.lockEmployeeByPublicId(tx, context.companyId, employeePublicId);
      const employee = await tx.employee.findFirst({ where: { publicId: employeePublicId, companyId: context.companyId } });
      if (!employee) throw new HrError("NOT_FOUND");
      const contract = await tx.employmentContract.findFirst({
        where: { publicId: contractPublicId, employeeId: employee.id, companyId: context.companyId },
      });
      if (!contract) throw new HrError("NOT_FOUND");
      if (contract.version !== input.version) throw new HrError("VERSION_CONFLICT");
      if (contract.status !== "ACTIVE") throw new HrError("CONTRACT_NOT_ACTIVE");
      const endDate = asDate(input.endDate);
      if (endDate < contract.startDate) throw new HrError("INVALID_DATE_RANGE");
      const changed = await tx.employmentContract.updateMany({
        where: { id: contract.id, companyId: context.companyId, version: input.version, status: "ACTIVE" },
        data: {
          status: "ENDED",
          endDate,
          endReason: input.reason,
          endedAt: new Date(),
          endedById: context.userId,
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new HrError("VERSION_CONFLICT");
      const updated = await tx.employmentContract.findUniqueOrThrow({ where: { id: contract.id } });
      await this.audit(tx, context, "EMPLOYMENT_CONTRACT_ENDED", "EMPLOYMENT_CONTRACT", contract.publicId, {
        employeeId: employee.publicId,
        endDate: input.endDate,
        reason: input.reason,
      });
      return { contract: contractJson(updated) };
    });
  }

  private updateStructure(
    context: ActorContext,
    kind: "department" | "position",
    publicId: string,
    input: { version: number; nameAr?: string; nameEn?: string | null; description?: string | null; isActive?: boolean; reason?: string },
  ) {
    return this.transactions.execute({ operation: kind === "department" ? "UPDATE_HR_DEPARTMENT" : "UPDATE_HR_POSITION", companyId: context.companyId }, async (tx) => {
      if (kind === "department") {
        await tx.$queryRaw`SELECT id FROM hr_departments WHERE public_id = ${publicId} AND company_id = ${context.companyId} FOR UPDATE`;
        const row = await tx.hrDepartment.findFirst({ where: { publicId, companyId: context.companyId } });
        if (!row) throw new HrError("NOT_FOUND");
        if (row.version !== input.version) throw new HrError("VERSION_CONFLICT");
        if (input.isActive === false && (!input.reason || input.reason.length < 3)) throw new HrError("REASON_REQUIRED");
        if (input.isActive === false && row.isActive && await tx.employee.count({ where: { companyId: context.companyId, departmentId: row.id, status: { not: "TERMINATED" } } })) throw new HrError("REFERENCE_IN_USE");
        const changed = await tx.hrDepartment.updateMany({ where: { id: row.id, companyId: context.companyId, version: input.version }, data: this.structureUpdateData(context, input) });
        if (changed.count !== 1) throw new HrError("VERSION_CONFLICT");
        const updated = await tx.hrDepartment.findUniqueOrThrow({ where: { id: row.id } });
        await this.audit(tx, context, "HR_DEPARTMENT_UPDATED", "HR_DEPARTMENT", publicId, input.reason ? { reason: input.reason } : undefined);
        return { department: structureJson(updated) };
      }
      await tx.$queryRaw`SELECT id FROM hr_positions WHERE public_id = ${publicId} AND company_id = ${context.companyId} FOR UPDATE`;
      const row = await tx.hrPosition.findFirst({ where: { publicId, companyId: context.companyId } });
      if (!row) throw new HrError("NOT_FOUND");
      if (row.version !== input.version) throw new HrError("VERSION_CONFLICT");
      if (input.isActive === false && (!input.reason || input.reason.length < 3)) throw new HrError("REASON_REQUIRED");
      if (input.isActive === false && row.isActive && await tx.employee.count({ where: { companyId: context.companyId, positionId: row.id, status: { not: "TERMINATED" } } })) throw new HrError("REFERENCE_IN_USE");
      const changed = await tx.hrPosition.updateMany({ where: { id: row.id, companyId: context.companyId, version: input.version }, data: this.structureUpdateData(context, input) });
      if (changed.count !== 1) throw new HrError("VERSION_CONFLICT");
      const updated = await tx.hrPosition.findUniqueOrThrow({ where: { id: row.id } });
      await this.audit(tx, context, "HR_POSITION_UPDATED", "HR_POSITION", publicId, input.reason ? { reason: input.reason } : undefined);
      return { position: structureJson(updated) };
    });
  }

  private structureUpdateData(context: ActorContext, input: { nameAr?: string; nameEn?: string | null; description?: string | null; isActive?: boolean }) {
    return {
      ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedById: context.userId,
      version: { increment: 1 },
    };
  }

  private async requireDepartment(tx: Prisma.TransactionClient, companyId: bigint, publicId: string, active: boolean) {
    await tx.$queryRaw`SELECT id FROM hr_departments WHERE public_id = ${publicId} AND company_id = ${companyId} FOR UPDATE`;
    const row = await tx.hrDepartment.findFirst({ where: { publicId, companyId } });
    if (!row) throw new HrError("REFERENCE_NOT_FOUND");
    if (active && !row.isActive) throw new HrError("REFERENCE_INACTIVE");
    return row;
  }

  private async requirePosition(tx: Prisma.TransactionClient, companyId: bigint, publicId: string, active: boolean) {
    await tx.$queryRaw`SELECT id FROM hr_positions WHERE public_id = ${publicId} AND company_id = ${companyId} FOR UPDATE`;
    const row = await tx.hrPosition.findFirst({ where: { publicId, companyId } });
    if (!row) throw new HrError("REFERENCE_NOT_FOUND");
    if (active && !row.isActive) throw new HrError("REFERENCE_INACTIVE");
    return row;
  }

  private async requireManager(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const row = await tx.employee.findFirst({ where: { publicId, companyId } });
    if (!row) throw new HrError("MANAGER_NOT_FOUND");
    if (row.status === "TERMINATED") throw new HrError("MANAGER_INACTIVE");
    return row;
  }

  private async assertNoManagerCycle(tx: Prisma.TransactionClient, companyId: bigint, employeeId: bigint, managerId: bigint) {
    let current: bigint | null = managerId;
    const visited = new Set<string>();
    while (current !== null) {
      if (current === employeeId) throw new HrError("MANAGER_CYCLE");
      const key = current.toString();
      if (visited.has(key)) throw new HrError("MANAGER_CYCLE");
      visited.add(key);
      const row: { managerEmployeeId: bigint | null } | null = await tx.employee.findFirst({
        where: { id: current, companyId },
        select: { managerEmployeeId: true },
      });
      current = row?.managerEmployeeId ?? null;
    }
  }

  private lockEmployeeHierarchy(tx: Prisma.TransactionClient, companyId: bigint) {
    return tx.$queryRaw`SELECT id FROM employees WHERE company_id = ${companyId} ORDER BY id FOR UPDATE`;
  }

  private lockEmployeeByPublicId(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    return tx.$queryRaw`SELECT id FROM employees WHERE public_id = ${publicId} AND company_id = ${companyId} FOR UPDATE`;
  }

  private async identityMap(companyId: bigint, ids: bigint[]) {
    const unique = [...new Set(ids.map(String))].map(BigInt);
    const rows = unique.length ? await this.identity.listInCompany(companyId, { ids: unique, limit: unique.length }) : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private mapEmployeeUniqueConflict(error: unknown): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HrError("USER_ALREADY_LINKED");
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
        mismatch: () => new HrError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new HrError("IDEMPOTENCY_IN_PROGRESS"),
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
