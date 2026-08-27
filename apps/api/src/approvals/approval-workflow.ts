import { createXStateWorkflowStatePort } from "./workflow-state-port.js";

export type ApprovalWorkflowState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ApprovalWorkflowEvent = "APPROVE" | "REJECT" | "CANCEL";

export const approvalWorkflow = createXStateWorkflowStatePort<ApprovalWorkflowState, ApprovalWorkflowEvent>({
  id: "approval-request",
  initial: "PENDING",
  states: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
  transitions: {
    PENDING: { APPROVE: "APPROVED", REJECT: "REJECTED", CANCEL: "CANCELLED" },
  },
});
