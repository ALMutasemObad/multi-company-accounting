import { RequestError, withinRequest, type RequestPolicy } from "../request-scope";

let context = new AbortController();
const listeners = new Set<() => void>();

/** No form data is retained across this boundary. Cancellation is not rollback. */
export function invalidateSessionRequests() {
  context.abort(new RequestError("cancelled"));
  context = new AbortController();
}

export function sessionRequestSignal(parent?: AbortSignal | null) {
  return parent ? AbortSignal.any([parent, context.signal]) : context.signal;
}

export function withinSessionRequest<T>(work: (signal: AbortSignal) => Promise<T>, options: RequestPolicy) {
  return withinRequest(signal => withinRequest(work, { signal: sessionRequestSignal(signal) }), options);
}

export function onSessionExpired(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isSessionExpiry(path: string, status: number, code?: string, reason?: string) {
  const route = path.split(/[?#]/)[0];
  if (code === "INVALID_CSRF" || reason === "INVALID_CSRF") return false;
  if (route === "/auth/login" || route === "/auth/logout" || route === "/auth/csrf"
    || route === "/auth/social/providers" || route?.startsWith("/auth/password/")) return false;
  return status === 401;
}

export function expireSession() {
  invalidateSessionRequests();
  for (const listener of listeners) listener();
}
