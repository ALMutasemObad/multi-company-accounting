import type { Prisma } from "@prisma/client";
import {
  ApprovalSubjectError,
  type ApprovalSubjectPort,
  type ApprovalSubjectReference,
} from "../approvals/approval-subject-port.js";
import type { ActorContext } from "../users/user-service.js";
import {
  ProfessionalProjectError,
  type ProfessionalProjectService,
} from "./professional-project-service.js";

export class ProfessionalTimesheetApprovalAdapter implements ApprovalSubjectPort {
  constructor(private readonly projects: ProfessionalProjectService) {}

  request(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: { subjectId: string; expectedVersion: number },
  ) {
    return this.translate(() => this.projects.requestTimesheetApprovalInTransaction(
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
    await this.translate(() => this.projects.approveTimesheetInTransaction(tx, context, input));
  }

  async reject(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ApprovalSubjectReference & { reason: string },
  ) {
    await this.translate(() => this.projects.rejectTimesheetInTransaction(tx, context, input));
  }

  private async translate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof ProfessionalProjectError)) throw error;
      if (["NOT_FOUND", "NOT_TIMESHEET_OWNER"].includes(error.reason)) throw new ApprovalSubjectError("SUBJECT_NOT_FOUND");
      if (error.reason === "VERSION_CONFLICT") throw new ApprovalSubjectError("SUBJECT_VERSION_CONFLICT");
      if (error.reason === "TIMESHEET_INVALID_STATE") throw new ApprovalSubjectError("SUBJECT_INVALID_STATE");
      if (["TIMESHEET_EMPTY", "EMPLOYEE_NOT_FOUND", "EMPLOYEE_INACTIVE"].includes(error.reason)) {
        throw new ApprovalSubjectError("SUBJECT_NOT_READY");
      }
      if (error.reason === "TIMESHEET_CHANGED") throw new ApprovalSubjectError("SUBJECT_CHANGED");
      throw error;
    }
  }
}
