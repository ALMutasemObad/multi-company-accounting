import { Prisma, type PrismaClient, type ProfessionalProjectAccessGrant } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../platform/actor-context.js";
import { ProfessionalProjectAccessPolicy } from "./professional-project-access-policy.js";
import type { ProfessionalPeoplePort, ProfessionalPersonReference } from "./project-reference-ports.js";

export type ProfessionalAccessFailureReason =
  | "NOT_FOUND"
  | "USER_NOT_FOUND"
  | "GRANT_NOT_FOUND"
  | "GRANT_ALREADY_ACTIVE"
  | "GRANT_ALREADY_REVOKED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class ProfessionalAccessError extends Error {
  constructor(public readonly reason: ProfessionalAccessFailureReason) {
    super(reason);
  }
}

type AccessMode = "COMPANY" | "RESTRICTED";

const personJson = (person: ProfessionalPersonReference | undefined, userId: bigint) => ({
  id: userId.toString(),
  displayName: person?.displayName ?? userId.toString(),
  nameEn: person?.nameEn ?? null,
});

export class ProfessionalProjectAccessService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;
  private readonly access = new ProfessionalProjectAccessPolicy();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly people: ProfessionalPeoplePort,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async getAccess(context: ActorContext, projectPublicId: string) {
    return this.transactions.execute({ operation: "GET_PROFESSIONAL_PROJECT_ACCESS", companyId: context.companyId }, async (tx) => {
      const project = await this.access.findAccessible(tx, context, { publicId: projectPublicId });
      if (!project) throw new ProfessionalAccessError("NOT_FOUND");
      return this.accessJson(tx, context.companyId, project);
    });
  }

  updateAccessMode(context: ActorContext, projectPublicId: string, input: {
    accessVersion: number;
    accessMode: AccessMode;
    reason: string;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_PROJECT_ACCESS", companyId: context.companyId }, async (tx) => {
      const project = await this.access.lockAccessible(tx, context, projectPublicId, () => new ProfessionalAccessError("NOT_FOUND"));
      if (project.accessVersion !== input.accessVersion) throw new ProfessionalAccessError("VERSION_CONFLICT");
      const changed = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, accessVersion: input.accessVersion },
        data: { accessMode: input.accessMode, accessVersion: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new ProfessionalAccessError("VERSION_CONFLICT");
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_ACCESS_MODE_CHANGED", projectPublicId, {
        from: project.accessMode,
        to: input.accessMode,
        reason: input.reason,
      });
      const updated = await tx.professionalProject.findUniqueOrThrow({ where: { id: project.id } });
      return this.accessJson(tx, context.companyId, updated);
    });
  }

  grantAccess(context: ActorContext, projectPublicId: string, input: {
    accessVersion: number;
    userId: bigint;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "GRANT_PROFESSIONAL_PROJECT_ACCESS", input.idempotencyKey, { projectPublicId, ...input }, 201, async (tx) => {
      const project = await this.access.lockAccessible(tx, context, projectPublicId, () => new ProfessionalAccessError("NOT_FOUND"));
      if (project.accessVersion !== input.accessVersion) throw new ProfessionalAccessError("VERSION_CONFLICT");
      await this.people.lockAssignment(tx, context.companyId, input.userId);
      const person = await this.people.findActiveInCompany(tx, context.companyId, input.userId);
      if (!person) throw new ProfessionalAccessError("USER_NOT_FOUND");
      const existing = await tx.professionalProjectAccessGrant.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: input.userId } },
      });
      if (existing?.isActive) throw new ProfessionalAccessError("GRANT_ALREADY_ACTIVE");
      const changed = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, accessVersion: input.accessVersion },
        data: { accessVersion: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new ProfessionalAccessError("VERSION_CONFLICT");
      const grant = existing
        ? await tx.professionalProjectAccessGrant.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              grantReason: input.reason,
              grantedById: context.userId,
              grantedAt: new Date(),
              revocationReason: null,
              revokedById: null,
              revokedAt: null,
              updatedById: context.userId,
              version: { increment: 1 },
            },
          })
        : await tx.professionalProjectAccessGrant.create({
            data: {
              companyId: context.companyId,
              projectId: project.id,
              userId: input.userId,
              grantReason: input.reason,
              grantedById: context.userId,
              updatedById: context.userId,
            },
          });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_ACCESS_GRANTED", projectPublicId, {
        grantId: grant.publicId,
        userId: input.userId.toString(),
        reason: input.reason,
      });
      return { grant: this.grantJson(grant, person), accessVersion: input.accessVersion + 1 };
    });
  }

  revokeAccess(context: ActorContext, projectPublicId: string, grantPublicId: string, input: {
    accessVersion: number;
    grantVersion: number;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "REVOKE_PROFESSIONAL_PROJECT_ACCESS", input.idempotencyKey, { projectPublicId, grantPublicId, ...input }, 200, async (tx) => {
      const project = await this.access.lockAccessible(tx, context, projectPublicId, () => new ProfessionalAccessError("NOT_FOUND"));
      if (project.accessVersion !== input.accessVersion) throw new ProfessionalAccessError("VERSION_CONFLICT");
      const grant = await tx.professionalProjectAccessGrant.findFirst({
        where: { publicId: grantPublicId, projectId: project.id, companyId: context.companyId },
      });
      if (!grant) throw new ProfessionalAccessError("GRANT_NOT_FOUND");
      if (!grant.isActive) throw new ProfessionalAccessError("GRANT_ALREADY_REVOKED");
      if (grant.version !== input.grantVersion) throw new ProfessionalAccessError("VERSION_CONFLICT");
      const projectChanged = await tx.professionalProject.updateMany({
        where: { id: project.id, companyId: context.companyId, accessVersion: input.accessVersion },
        data: { accessVersion: { increment: 1 }, updatedById: context.userId },
      });
      const grantChanged = await tx.professionalProjectAccessGrant.updateMany({
        where: { id: grant.id, companyId: context.companyId, version: input.grantVersion, isActive: true },
        data: {
          isActive: false,
          revocationReason: input.reason,
          revokedById: context.userId,
          revokedAt: new Date(),
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (projectChanged.count !== 1 || grantChanged.count !== 1) throw new ProfessionalAccessError("VERSION_CONFLICT");
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_ACCESS_REVOKED", projectPublicId, {
        grantId: grantPublicId,
        userId: grant.userId.toString(),
        reason: input.reason,
      });
      return { revoked: true, accessVersion: input.accessVersion + 1, grantVersion: input.grantVersion + 1 };
    });
  }

  private async accessJson(tx: Prisma.TransactionClient, companyId: bigint, project: { id: bigint; publicId: string; accessMode: AccessMode; accessVersion: number }) {
    const grants = await tx.professionalProjectAccessGrant.findMany({
      where: { projectId: project.id, companyId },
      orderBy: [{ isActive: "desc" }, { grantedAt: "desc" }, { id: "desc" }],
    });
    const ids = [...new Set(grants.map((grant) => grant.userId.toString()))].map(BigInt);
    const people = ids.length ? await this.people.listActiveInCompany(companyId, { ids, limit: ids.length }) : [];
    const peopleById = new Map(people.map((person) => [person.id, person]));
    return {
      projectId: project.publicId,
      accessMode: project.accessMode,
      accessVersion: project.accessVersion,
      grants: grants.map((grant) => this.grantJson(grant, peopleById.get(grant.userId))),
    };
  }

  private grantJson(grant: ProfessionalProjectAccessGrant, person: ProfessionalPersonReference | undefined) {
    return {
      id: grant.publicId,
      user: personJson(person, grant.userId),
      isActive: grant.isActive,
      version: grant.version,
      grantReason: grant.grantReason,
      grantedAt: grant.grantedAt.toISOString(),
      revocationReason: grant.revocationReason,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
    };
  }

  private executeCommand<T>(context: ActorContext, operation: string, key: string, fingerprint: Record<string, unknown>, responseStatus: number, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint, (_name, value) => typeof value === "bigint" ? value.toString() : value),
      responseStatus,
      errors: {
        mismatch: () => new ProfessionalAccessError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ProfessionalAccessError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityId: string, details: Prisma.InputJsonObject) {
    return appendAudit(tx, {
      data: { companyId: context.companyId, actorUserId: context.userId, action, entityType: "PROFESSIONAL_PROJECT", entityId, details },
    });
  }
}
