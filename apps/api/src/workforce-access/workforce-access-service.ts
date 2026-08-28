import { createHash } from "node:crypto";
import { hash } from "argon2";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type {
  EmployeeAccountPort,
  EmployeeAccountReference,
  IdentityAccountPort,
  IdentityAccountRecord,
} from "./workforce-access-ports.js";

export type WorkforceAccessFailureReason =
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_TERMINATED"
  | "EMPLOYEE_ALREADY_LINKED"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_LINKED"
  | "EMPLOYEE_MANAGED_PROFILE"
  | "EMAIL_EXISTS"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class WorkforceAccessError extends Error {
  constructor(public readonly reason: WorkforceAccessFailureReason) {
    super(reason);
  }
}

export type WorkforceUser = {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "LOCKED" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  employee: EmployeeAccountReference;
};

const passwordFingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const serialize = (
  user: IdentityAccountRecord,
  employee: EmployeeAccountReference,
): WorkforceUser => ({
  id: user.id.toString(),
  email: user.emailNormalized,
  nameAr: employee.nameAr,
  nameEn: employee.nameEn,
  status: !user.isActive
    ? "DISABLED"
    : user.lockedUntil && user.lockedUntil > new Date() ? "LOCKED" : "ACTIVE",
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
  employee: {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    nameAr: employee.nameAr,
    nameEn: employee.nameEn,
    status: employee.status,
  },
});

export class WorkforceAccessService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly employees: EmployeeAccountPort,
    private readonly identities: IdentityAccountPort,
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  listEmployeeOptions(context: ActorContext, search?: string) {
    return this.employees.listAvailable(context.companyId, { search, limit: 100 });
  }

  async employeeLinks(companyId: bigint, userIds: bigint[]) {
    const links = await this.employees.findByUserIds(companyId, userIds);
    return new Map(links.map((employee) => [employee.userId.toString(), employee]));
  }

  async assertLegacyProfileEditable(context: ActorContext, userId: bigint) {
    if ((await this.employees.findByUserIds(context.companyId, [userId])).length) {
      throw new WorkforceAccessError("EMPLOYEE_MANAGED_PROFILE");
    }
  }

  async createUser(context: ActorContext, input: {
    employeeId: string;
    email: string;
    temporaryPassword: string;
    idempotencyKey: string;
  }): Promise<WorkforceUser> {
    const emailNormalized = input.email.trim().toLocaleLowerCase("en-US");
    const password = input.temporaryPassword;
    const passwordHash = await hash(password);
    try {
      return await this.commands.execute({
        context,
        operation: "CREATE_EMPLOYEE_USER_ACCOUNT",
        key: input.idempotencyKey,
        fingerprint: JSON.stringify({
          employeeId: input.employeeId,
          email: emailNormalized,
          passwordFingerprint: passwordFingerprint(password),
        }),
        responseStatus: 201,
        errors: {
          mismatch: () => new WorkforceAccessError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new WorkforceAccessError("IDEMPOTENCY_IN_PROGRESS"),
        },
      }, async (tx) => {
        const employee = await this.requireAvailableEmployee(tx, context.companyId, input.employeeId);
        const user = await this.identities.createForEmployee(tx, {
          companyId: context.companyId,
          actorUserId: context.userId,
          employeePublicId: employee.id,
          emailNormalized,
          displayName: employee.nameAr,
          nameEn: employee.nameEn,
          passwordHash,
        });
        if (!await this.employees.linkAccount(tx, {
          companyId: context.companyId,
          employeeId: employee.internalId,
          employeePublicId: employee.id,
          userId: user.id,
          actorUserId: context.userId,
        })) throw new WorkforceAccessError("EMPLOYEE_ALREADY_LINKED");
        return serialize(user, employee);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        && await this.identities.emailExists(emailNormalized)) {
        throw new WorkforceAccessError("EMAIL_EXISTS");
      }
      this.mapUniqueConflict(error);
      throw error;
    }
  }

  async linkExistingUser(context: ActorContext, userId: bigint, input: {
    employeeId: string;
    idempotencyKey: string;
  }): Promise<WorkforceUser> {
    try {
      return await this.commands.execute({
        context,
        operation: "LINK_EMPLOYEE_USER_ACCOUNT",
        key: input.idempotencyKey,
        fingerprint: JSON.stringify({ employeeId: input.employeeId, userId: userId.toString() }),
        errors: {
          mismatch: () => new WorkforceAccessError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new WorkforceAccessError("IDEMPOTENCY_IN_PROGRESS"),
        },
      }, async (tx) => {
        const employee = await this.requireAvailableEmployee(tx, context.companyId, input.employeeId);
        const existing = await this.identities.lockActiveInCompany(tx, context.companyId, userId);
        if (!existing) throw new WorkforceAccessError("USER_NOT_FOUND");
        const user = await this.identities.alignEmployeeProfile(tx, {
          companyId: context.companyId,
          actorUserId: context.userId,
          userId,
          employeePublicId: employee.id,
          displayName: employee.nameAr,
          nameEn: employee.nameEn,
        });
        if (!await this.employees.linkAccount(tx, {
          companyId: context.companyId,
          employeeId: employee.internalId,
          employeePublicId: employee.id,
          userId,
          actorUserId: context.userId,
        })) throw new WorkforceAccessError("EMPLOYEE_ALREADY_LINKED");
        return serialize(user, employee);
      });
    } catch (error) {
      this.mapUniqueConflict(error);
      throw error;
    }
  }

  private async requireAvailableEmployee(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    employeePublicId: string,
  ) {
    const employee = await this.employees.lockCandidate(tx, companyId, employeePublicId);
    if (!employee) throw new WorkforceAccessError("EMPLOYEE_NOT_FOUND");
    if (employee.status === "TERMINATED") throw new WorkforceAccessError("EMPLOYEE_TERMINATED");
    if (employee.linkedUserId !== null) throw new WorkforceAccessError("EMPLOYEE_ALREADY_LINKED");
    return employee;
  }

  private mapUniqueConflict(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return;
    const target = JSON.stringify(error.meta?.target ?? "");
    if (target.includes("email_normalized")) throw new WorkforceAccessError("EMAIL_EXISTS");
    throw new WorkforceAccessError("USER_ALREADY_LINKED");
  }
}
