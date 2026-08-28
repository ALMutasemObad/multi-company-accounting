import {
  Prisma,
  type ApprovalDecision,
  type ApprovalRequest,
  type PrismaClient,
  type User,
} from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../platform/actor-context.js";
import type {
  ApprovalSubjectPorts,
  SupportedApprovalSubjectType,
} from "./approval-subject-port.js";
import { approvalWorkflow } from "./approval-workflow.js";

export type ApprovalFailureReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "MAKER_CHECKER_VIOLATION"
  | "REJECTION_REASON_REQUIRED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class ApprovalError extends Error {
  constructor(public readonly reason: ApprovalFailureReason) {
    super(reason);
  }
}

type Person = Pick<User, "id" | "displayName">;
type DecisionView = ApprovalDecision & { actor: Person };
type ApprovalRequestView = ApprovalRequest & {
  requestedBy: Person;
  decisions: DecisionView[];
};

const hashHex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const activeSubjectKey = (subjectType: SupportedApprovalSubjectType, subjectId: string) => `${subjectType}:${subjectId}`;

function serializeApproval(request: ApprovalRequestView) {
  const decision = request.decisions[0];
  return {
    id: request.publicId,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    subjectVersion: request.subjectVersion,
    subjectSnapshotHashSha256: hashHex(request.subjectSnapshotHashSha256),
    status: request.status,
    makerCheckerRequired: request.makerCheckerRequired,
    requestedBy: {
      id: request.requestedBy.id.toString(),
      displayName: request.requestedBy.displayName,
    },
    decision: decision ? {
      type: decision.decision,
      actor: { id: decision.actor.id.toString(), displayName: decision.actor.displayName },
      reason: decision.reason,
      decidedAt: decision.decidedAt.toISOString(),
    } : null,
    version: request.version,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export class ApprovalService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ports: ApprovalSubjectPorts,
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async list(context: ActorContext, input: {
    page: number;
    pageSize: number;
    status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | undefined;
    subjectType?: SupportedApprovalSubjectType | undefined;
    subjectId?: string | undefined;
  }) {
    const where = {
      companyId: context.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.subjectType ? { subjectType: input.subjectType } : {}),
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.approvalRequest.findMany({
          where,
          include: this.include(),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        tx.approvalRequest.count({ where }),
      ]);
      return {
        data: rows.map(serializeApproval),
        meta: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(context: ActorContext, publicId: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { publicId, companyId: context.companyId },
      include: this.include(),
    });
    if (!request) throw new ApprovalError("NOT_FOUND");
    return { approvalRequest: serializeApproval(request) };
  }

  async request(
    context: ActorContext,
    input: {
      subjectType: SupportedApprovalSubjectType;
      subjectId: string;
      subjectVersion: number;
      idempotencyKey: string;
    },
  ) {
    return this.executeCommand(context, "REQUEST_APPROVAL", input.idempotencyKey, {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
    }, async (tx) => {
      const subject = await this.ports[input.subjectType].request(tx, context, {
        subjectId: input.subjectId,
        expectedVersion: input.subjectVersion,
      });
      const request = await tx.approvalRequest.create({
        data: {
          companyId: context.companyId,
          subjectType: input.subjectType,
          subjectId: subject.subjectId,
          subjectVersion: subject.subjectVersion,
          subjectSnapshotHashSha256: Buffer.from(subject.subjectSnapshotHashSha256),
          requestedById: context.userId,
          makerCheckerRequired: true,
          activeSubjectKey: activeSubjectKey(input.subjectType, subject.subjectId),
        },
      });
      await this.audit(tx, context, "APPROVAL_REQUEST_CREATED", request.publicId, {
        subjectType: input.subjectType,
        subjectId: subject.subjectId,
        makerCheckerRequired: true,
      });
      return this.loadResponse(tx, context.companyId, request.id);
    });
  }

  approve(
    context: ActorContext,
    publicId: string,
    input: { version: number; idempotencyKey: string },
  ) {
    return this.decide(context, publicId, {
      ...input,
      decision: "APPROVE",
      reason: null,
    });
  }

  reject(
    context: ActorContext,
    publicId: string,
    input: { version: number; reason: string; idempotencyKey: string },
  ) {
    const reason = input.reason.trim();
    if (reason.length < 10) throw new ApprovalError("REJECTION_REASON_REQUIRED");
    return this.decide(context, publicId, {
      version: input.version,
      idempotencyKey: input.idempotencyKey,
      decision: "REJECT",
      reason,
    });
  }

  private decide(
    context: ActorContext,
    publicId: string,
    input: {
      version: number;
      idempotencyKey: string;
      decision: "APPROVE" | "REJECT";
      reason: string | null;
    },
  ) {
    return this.executeCommand(context, `${input.decision}_APPROVAL`, input.idempotencyKey, {
      publicId,
      version: input.version,
      decision: input.decision,
      reason: input.reason,
    }, async (tx) => {
      const request = await tx.approvalRequest.findFirst({
        where: { publicId, companyId: context.companyId },
      });
      if (!request) throw new ApprovalError("NOT_FOUND");
      if (request.version !== input.version) throw new ApprovalError("VERSION_CONFLICT");
      if (request.status !== "PENDING") throw new ApprovalError("INVALID_STATE");
      if (request.makerCheckerRequired && request.requestedById === context.userId) {
        throw new ApprovalError("MAKER_CHECKER_VIOLATION");
      }

      const next = approvalWorkflow.transition(request.status, input.decision);
      const changed = await tx.approvalRequest.updateMany({
        where: {
          id: request.id,
          companyId: context.companyId,
          status: "PENDING",
          version: input.version,
        },
        data: {
          status: next,
          activeSubjectKey: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApprovalError("VERSION_CONFLICT");

      const port = this.ports[request.subjectType];
      const subject = {
        subjectId: request.subjectId,
        subjectVersion: request.subjectVersion,
        subjectSnapshotHashSha256: request.subjectSnapshotHashSha256,
      };
      if (input.decision === "APPROVE") await port.approve(tx, context, subject);
      else await port.reject(tx, context, { ...subject, reason: input.reason! });

      await tx.approvalDecision.create({
        data: {
          companyId: context.companyId,
          approvalRequestId: request.id,
          decision: input.decision,
          actorUserId: context.userId,
          reason: input.reason,
        },
      });
      await this.audit(tx, context, `APPROVAL_REQUEST_${next}`, request.publicId, {
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return this.loadResponse(tx, context.companyId, request.id);
    });
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: Record<string, unknown>,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint),
      errors: {
        mismatch: () => new ApprovalError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ApprovalError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private async loadResponse(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const request = await tx.approvalRequest.findFirstOrThrow({
      where: { id, companyId },
      include: this.include(),
    });
    return { approvalRequest: serializeApproval(request) };
  }

  private include() {
    return {
      requestedBy: { select: { id: true, displayName: true } },
      decisions: {
        include: { actor: { select: { id: true, displayName: true } } },
        orderBy: { id: "asc" as const },
      },
    };
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityId: string,
    details: Prisma.InputJsonObject,
  ) {
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "APPROVAL_REQUEST",
        entityId,
        details,
      },
    });
  }
}
