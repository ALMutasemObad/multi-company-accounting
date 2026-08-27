import type { Prisma } from "@prisma/client";
import {
  ApprovalSubjectError,
  type ApprovalSubjectPort,
  type ApprovalSubjectReference,
} from "../approvals/approval-subject-port.js";
import type { ActorContext } from "../users/user-service.js";
import { FinancialCloseError, type FinancialCloseService } from "./financial-close-service.js";

export class FinancialCloseApprovalAdapter implements ApprovalSubjectPort {
  constructor(private readonly financialClose: FinancialCloseService) {}

  async request(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; expectedVersion: number },
  ) {
    return this.translate(() => this.financialClose.requestApprovalInTransaction(
      tx,
      context,
      input.subjectId,
      input.expectedVersion,
    ));
  }

  async approve(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference,
  ) {
    await this.translate(() => this.financialClose.approveInTransaction(tx, context, input));
  }

  async reject(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference & { reason: string },
  ) {
    await this.translate(() => this.financialClose.rejectInTransaction(tx, context, input));
  }

  private async translate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof FinancialCloseError)) throw error;
      if (error.reason === "NOT_FOUND") throw new ApprovalSubjectError("SUBJECT_NOT_FOUND");
      if (error.reason === "VERSION_CONFLICT") throw new ApprovalSubjectError("SUBJECT_VERSION_CONFLICT");
      if (error.reason === "INVALID_STATE") throw new ApprovalSubjectError("SUBJECT_INVALID_STATE");
      if (error.reason === "NOT_READY") throw new ApprovalSubjectError("SUBJECT_NOT_READY");
      if (error.reason === "CHECKLIST_CHANGED") throw new ApprovalSubjectError("SUBJECT_CHANGED");
      throw error;
    }
  }
}
