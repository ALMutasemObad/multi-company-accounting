import type { Prisma } from "@prisma/client";
import {
  ApprovalSubjectError,
  type ApprovalSubjectPort,
  type ApprovalSubjectReference,
} from "../approvals/approval-subject-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  EmployeeExpenseError,
  type EmployeeExpenseService,
} from "./employee-expense-service.js";

export class EmployeeExpenseApprovalAdapter implements ApprovalSubjectPort {
  constructor(private readonly expenses: EmployeeExpenseService) {}

  request(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; expectedVersion: number },
  ) {
    return this.translate(() => this.expenses.requestApprovalInTransaction(
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
    await this.translate(() => this.expenses.approveInTransaction(tx, context, input));
  }

  async reject(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference & { reason: string },
  ) {
    await this.translate(() => this.expenses.rejectInTransaction(tx, context, input));
  }

  private async translate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof EmployeeExpenseError)) throw error;
      if (["NOT_FOUND", "NOT_OWNER"].includes(error.reason)) throw new ApprovalSubjectError("SUBJECT_NOT_FOUND");
      if (error.reason === "VERSION_CONFLICT") throw new ApprovalSubjectError("SUBJECT_VERSION_CONFLICT");
      if (error.reason === "INVALID_STATE") throw new ApprovalSubjectError("SUBJECT_INVALID_STATE");
      if (["EMPLOYEE_NOT_FOUND", "EMPLOYEE_INACTIVE", "CLAIM_EMPTY"].includes(error.reason)) {
        throw new ApprovalSubjectError("SUBJECT_NOT_READY");
      }
      if (error.reason === "CLAIM_CHANGED") throw new ApprovalSubjectError("SUBJECT_CHANGED");
      throw error;
    }
  }
}
