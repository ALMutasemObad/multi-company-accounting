import {
  createXStateWorkflowStatePort,
  InvalidWorkflowTransitionError,
} from "../approvals/workflow-state-port.js";

export type FinancialCloseWorkflowState = "OPEN" | "PREPARING" | "AWAITING_APPROVAL" | "REVIEWED" | "CLOSED";
export type FinancialCloseWorkflowEvent = "PREPARE" | "SUBMIT" | "APPROVE" | "REJECT" | "RETURN" | "CLOSE" | "REOPEN";

const workflow = createXStateWorkflowStatePort<FinancialCloseWorkflowState, FinancialCloseWorkflowEvent>({
  id: "financial-close",
  initial: "OPEN",
  states: ["OPEN", "PREPARING", "AWAITING_APPROVAL", "REVIEWED", "CLOSED"],
  transitions: {
    OPEN: { PREPARE: "PREPARING" },
    PREPARING: { SUBMIT: "AWAITING_APPROVAL" },
    AWAITING_APPROVAL: { APPROVE: "REVIEWED", REJECT: "PREPARING" },
    REVIEWED: { RETURN: "PREPARING", CLOSE: "CLOSED" },
    CLOSED: { REOPEN: "OPEN" },
  },
});

export class InvalidFinancialCloseTransitionError extends InvalidWorkflowTransitionError<FinancialCloseWorkflowState, FinancialCloseWorkflowEvent> {}

export function transitionFinancialClose(
  state: FinancialCloseWorkflowState,
  event: FinancialCloseWorkflowEvent,
): FinancialCloseWorkflowState {
  try {
    return workflow.transition(state, event);
  } catch (error) {
    if (error instanceof InvalidWorkflowTransitionError) {
      throw new InvalidFinancialCloseTransitionError("financial-close", state, event);
    }
    throw error;
  }
}
