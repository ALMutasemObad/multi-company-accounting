import { createMachine, initialTransition, transition } from "xstate";

export interface WorkflowStatePort<State extends string, Event extends string> {
  transition(state: State, event: Event): State;
}

export class InvalidWorkflowTransitionError<State extends string, Event extends string> extends Error {
  constructor(
    public readonly workflowId: string,
    public readonly state: State,
    public readonly event: Event,
  ) {
    super(`${workflowId} cannot apply ${event} from ${state}`);
  }
}

export function createXStateWorkflowStatePort<State extends string, Event extends string>(input: {
  id: string;
  initial: State;
  states: readonly State[];
  transitions: Partial<Record<State, Partial<Record<Event, State>>>>;
}): WorkflowStatePort<State, Event> {
  const states = Object.fromEntries(input.states.map((state) => [
    state,
    {
      on: Object.fromEntries(Object.entries(input.transitions[state] ?? {}).map(([event, target]) => [
        event,
        String(target),
      ])),
    },
  ]));
  const machine = createMachine({ id: input.id, initial: input.initial, states });

  return {
    transition(state, event) {
      const current = state === input.initial
        ? initialTransition(machine)[0]
        : machine.resolveState({ value: state, context: {} });
      const next = transition(machine, current, { type: event })[0];
      const value = String(next.value) as State;
      if (!input.states.includes(value) || value === state) {
        throw new InvalidWorkflowTransitionError(input.id, state, event);
      }
      return value;
    },
  };
}
