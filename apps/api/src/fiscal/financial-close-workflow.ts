import { createMachine, initialTransition, transition } from "xstate";

export type FinancialCloseWorkflowState = "OPEN" | "PREPARING" | "REVIEWED" | "CLOSED";
export type FinancialCloseWorkflowEvent = "PREPARE" | "REVIEW" | "RETURN" | "CLOSE" | "REOPEN";

const workflow = createMachine({
  id: "financial-close",
  initial: "open",
  states: {
    open: { on: { PREPARE: "preparing" } },
    preparing: { on: { REVIEW: "reviewed" } },
    reviewed: { on: { RETURN: "preparing", CLOSE: "closed" } },
    closed: { on: { REOPEN: "open" } },
  },
});

const localToMachine = {
  OPEN: "open",
  PREPARING: "preparing",
  REVIEWED: "reviewed",
  CLOSED: "closed",
} as const satisfies Record<FinancialCloseWorkflowState, string>;

const machineToLocal = {
  open: "OPEN",
  preparing: "PREPARING",
  reviewed: "REVIEWED",
  closed: "CLOSED",
} as const satisfies Record<string, FinancialCloseWorkflowState>;

export class InvalidFinancialCloseTransitionError extends Error {
  constructor(
    public readonly state: FinancialCloseWorkflowState,
    public readonly event: FinancialCloseWorkflowEvent,
  ) {
    super(`Financial close cannot apply ${event} from ${state}`);
  }
}

export function transitionFinancialClose(
  state: FinancialCloseWorkflowState,
  event: FinancialCloseWorkflowEvent,
): FinancialCloseWorkflowState {
  const machineState = state === "OPEN"
    ? initialTransition(workflow)[0]
    : workflow.resolveState({ value: localToMachine[state], context: {} });
  const next = transition(workflow, machineState, { type: event })[0];
  const value = machineToLocal[String(next.value) as keyof typeof machineToLocal];
  if (!value || value === state) throw new InvalidFinancialCloseTransitionError(state, event);
  return value;
}
