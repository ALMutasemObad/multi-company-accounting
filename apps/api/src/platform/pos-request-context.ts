import type { ErrorRequestHandler, Request } from "express";
import type { ActorContext } from "./actor-context.js";

const userHeader = "x-pos-expected-user-id";
const companyHeader = "x-pos-expected-company-id";
const canonicalId = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 20 && value.charCodeAt(0) >= 49 && value.charCodeAt(0) <= 57
  && !/[^0-9]/u.test(value) && BigInt(value) <= 18446744073709551615n;

type PosRequestHeaders = Pick<Request, "headers" | "rawHeaders">;

export type PosResponseContext = { userId: string; companyId: string };

/** A precondition failure says nothing about a reserved checkout's financial outcome. */
export class PosRequestContextError extends Error {
  constructor(public readonly code: "POS_CONTEXT_REQUIRED" | "POS_CONTEXT_CHANGED") {
    super(code);
  }
}

function expectedContext(request: PosRequestHeaders, required: boolean): PosResponseContext | null {
  const userId = request.headers[userHeader];
  const companyId = request.headers[companyHeader];
  const counts = { [userHeader]: 0, [companyHeader]: 0 };
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]!.toLowerCase();
    if (name === userHeader || name === companyHeader) counts[name] += 1;
  }
  if (userId === undefined && companyId === undefined && !required
    && counts[userHeader] === 0 && counts[companyHeader] === 0) return null;
  // Reject partial, merged, duplicate and noncanonical headers; never downgrade to legacy reads.
  if (counts[userHeader] !== 1 || counts[companyHeader] !== 1
    || !canonicalId(userId) || !canonicalId(companyId)) throw new PosRequestContextError("POS_CONTEXT_REQUIRED");
  return { userId, companyId };
}

/** Captures an authorized Actor, never constructs one from request identity. */
export function bindPosRequestContext(request: PosRequestHeaders, authorize: () => Promise<ActorContext>, required = false) {
  const expected = expectedContext(request, required);
  let captured: ActorContext | null = null;
  const binding = {
    scoped: expected !== null,
    authorize: async (): Promise<ActorContext> => {
      const current = await authorize();
      if (expected && (current.userId.toString() !== expected.userId || current.companyId.toString() !== expected.companyId
        || (captured !== null && (current.userId !== captured.userId || current.companyId !== captured.companyId)))) {
        throw new PosRequestContextError("POS_CONTEXT_CHANGED");
      }
      // Copy the identity: a mutable session/store fixture must not replace the saved Actor.
      if (captured === null) captured = { userId: current.userId, companyId: current.companyId };
      return { ...current };
    },
    response: <T extends object>(value: T): T & { posContext?: PosResponseContext } => {
      if (!expected) return value;
      if (!captured) throw new PosRequestContextError("POS_CONTEXT_REQUIRED");
      // HTTP metadata only. Do not mutate the value or store it in the idempotency response.
      return { ...value, posContext: { userId: captured.userId.toString(), companyId: captured.companyId.toString() } };
    },
  };
  return binding;
}

export async function readWithPosContext<T extends object>(request: Request, authorize: () => Promise<ActorContext>,
  read: (actor: ActorContext) => Promise<T>, required = false): Promise<T & { posContext?: PosResponseContext }> {
  const binding = bindPosRequestContext(request, authorize, required);
  const actor = await binding.authorize();
  const value = await read(actor);
  if (binding.scoped) await binding.authorize();
  return binding.response(value);
}

export const posRequestContextErrors: ErrorRequestHandler = (error, _request, response, next) => {
  if (!(error instanceof PosRequestContextError)) { next(error); return; }
  const status = error.code === "POS_CONTEXT_CHANGED" ? 409 : 400;
  // Neither the live identity nor the attempted identity belongs in an error response.
  response.status(status).json({ status, code: error.code });
};
