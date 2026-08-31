import { ApiError, api } from "./api";

export type PosExpectedContext = Readonly<{ userId: string; companyId: string }>;
export type PosRequest = typeof api;
export type PosRequestOptions = Parameters<typeof api>[1];
export class PosScopeError extends Error {
  constructor(public readonly reason: "closed" | "stale" | "context" | "response") { super("POS_SCOPE_UNAVAILABLE"); }
}
export const canonicalPosId = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 20 && value.charCodeAt(0) >= 49 && value.charCodeAt(0) <= 57
  && !/[^0-9]/u.test(value) && BigInt(value) <= 18446744073709551615n;
export function posExpectedHeaders(expected: PosExpectedContext, existing?: HeadersInit) {
  if (!canonicalPosId(expected.userId) || !canonicalPosId(expected.companyId)) throw new PosScopeError("context");
  const headers = new Headers(existing);
  headers.set("X-POS-Expected-User-Id", expected.userId);
  headers.set("X-POS-Expected-Company-Id", expected.companyId);
  return headers;
}
export function hasExpectedPosContext(body: unknown, expected: PosExpectedContext): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const context = (body as Record<string, unknown>).posContext;
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  const value = context as Record<string, unknown>;
  return Object.keys(value).sort().join(",") === "companyId,userId" && canonicalPosId(value.userId) && canonicalPosId(value.companyId)
    && value.userId === expected.userId && value.companyId === expected.companyId;
}
export function isPosScopeFailure(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 401 || cause.status === 403
    || (cause.status === 409 && cause.code === "POS_CONTEXT_CHANGED")
    || (cause.status === 400 && cause.code === "POS_CONTEXT_REQUIRED"));
}
