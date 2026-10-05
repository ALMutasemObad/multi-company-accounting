import type { Prisma } from "@prisma/client";
import { ApprovalSubjectError, type ApprovalSubjectPort, type ApprovalSubjectReference } from "../approvals/approval-subject-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import { PayrollError, type PayrollService } from "./payroll-service.js";
export class PayrollApprovalAdapter implements ApprovalSubjectPort {
  constructor(private readonly payroll: PayrollService) {}
  request(tx: Prisma.TransactionClient, context: ActorContext, input: { subjectId: string; expectedVersion: number }) {
    return this.translate(() => this.payroll.requestApprovalInTransaction(tx, context, input));
  }
  approve(tx: Prisma.TransactionClient, context: ActorContext, input: ApprovalSubjectReference) {
    return this.translate(() => this.payroll.decideInTransaction(tx, context, input, true));
  }
  reject(tx: Prisma.TransactionClient, context: ActorContext, input: ApprovalSubjectReference & { reason: string }) {
    return this.translate(() => this.payroll.decideInTransaction(tx, context, input, false));
  }
  private async translate<T>(work: () => Promise<T>) {
    try { return await work(); } catch (error) {
      if (!(error instanceof PayrollError)) throw error;
      if (["NOT_FOUND", "OWNER_REQUIRED", "MAKER_REQUIRED", "MAKER_CHECKER_VIOLATION"].includes(error.reason)) throw new ApprovalSubjectError("SUBJECT_NOT_FOUND");
      if (error.reason === "VERSION_CONFLICT") throw new ApprovalSubjectError("SUBJECT_VERSION_CONFLICT");
      if (error.reason === "SNAPSHOT_CHANGED") throw new ApprovalSubjectError("SUBJECT_CHANGED");
      throw new ApprovalSubjectError("SUBJECT_INVALID_STATE");
    }
  }
}
