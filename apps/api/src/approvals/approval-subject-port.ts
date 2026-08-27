import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";

export type SupportedApprovalSubjectType = "FINANCIAL_CLOSE_RUN" | "PROFESSIONAL_TIMESHEET";

export type ApprovalSubjectFailureReason =
  | "SUBJECT_NOT_FOUND"
  | "SUBJECT_INVALID_STATE"
  | "SUBJECT_VERSION_CONFLICT"
  | "SUBJECT_NOT_READY"
  | "SUBJECT_CHANGED";

export class ApprovalSubjectError extends Error {
  constructor(public readonly reason: ApprovalSubjectFailureReason) {
    super(reason);
  }
}

export type ApprovalSubjectReference = {
  subjectId: string;
  subjectVersion: number;
  subjectSnapshotHashSha256: Uint8Array;
};

export interface ApprovalSubjectPort {
  request(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; expectedVersion: number },
  ): Promise<ApprovalSubjectReference>;
  approve(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference,
  ): Promise<void>;
  reject(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference & { reason: string },
  ): Promise<void>;
}

export type ApprovalSubjectPorts = Record<SupportedApprovalSubjectType, ApprovalSubjectPort>;
