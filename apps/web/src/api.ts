import { messageForError } from "./domain";
import { storageKey } from "./branding";
import { assertRequestActive, RequestError, withinRequest, type RequestPolicy } from "./request-scope";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly reason?: string,
  ) {
    super(message);
  }
}

let csrfToken = "";
try { csrfToken = globalThis.sessionStorage?.getItem(storageKey("csrf")) ?? ""; } catch { /* In-memory CSRF still works when storage is disabled. */ }

export function setCsrfToken(value: string) {
  csrfToken = value;
  try { globalThis.sessionStorage?.setItem(storageKey("csrf"), value); } catch { /* Keep the in-memory token. */ }
}

export function clearCsrfToken() {
  csrfToken = "";
  try { globalThis.sessionStorage?.removeItem(storageKey("csrf")); } catch { /* Already cleared in memory. */ }
}

export async function api<T>(
  path: string,
  options: RequestInit & { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken)
    headers.set("X-CSRF-Token", csrfToken);
  if (options.idempotencyKey)
    headers.set("Idempotency-Key", options.idempotencyKey);
  const { timeoutMs, idempotencyKey: _key, ...request } = options;
  return withinRequest(async (signal) => {
    let response: Response;
    try {
      response = await fetch(`/api/v1${path}`, { ...request, headers, signal, credentials: "include" });
    } catch (cause) {
      assertRequestActive(signal);
      if (cause instanceof TypeError) throw new RequestError("network");
      throw cause;
    }
    assertRequestActive(signal);
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => {
      assertRequestActive(signal);
      if (response.ok) throw new RequestError("response");
      return {};
    });
    assertRequestActive(signal);
    if (!response.ok) {
      throw new ApiError(messageForError(body?.code, body?.reason), response.status, body?.code, body?.reason);
    }
    return body as T;
  }, { signal: options.signal, timeoutMs });
}

let beginLoginRequest: Promise<void> | null = null;

export function beginLogin(options: RequestPolicy = {}) {
  const request = () => api<{ csrfToken: string }>("/auth/csrf", options)
    .then((result) => {
      assertRequestActive(options.signal);
      if (!result?.csrfToken) throw new RequestError("response");
      setCsrfToken(result.csrfToken);
    });
  // Scoped callers own cancellation; they must never share an aborted promise/token write.
  if (options.signal || options.timeoutMs !== undefined) return request();
  if (beginLoginRequest) return beginLoginRequest;
  beginLoginRequest = request()
    .finally(() => { beginLoginRequest = null; });
  return beginLoginRequest;
}

export async function login(email: string, password: string, options: RequestPolicy = {}) {
  return withinRequest(async (signal) => {
    await beginLogin({ signal });
    const result = await api<{
      user: { id: string; displayName: string };
      csrfToken: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      signal,
    });
    assertRequestActive(signal);
    if (!result?.csrfToken || !result.user) throw new RequestError("response");
    setCsrfToken(result.csrfToken);
    return result.user;
  }, options);
}

export async function logout() {
  try {
    await api<void>("/auth/logout", { method: "POST" });
  } finally {
    clearCsrfToken();
  }
}

export const idempotencyKey = (operation: string, id: string) =>
  `${operation}-${id}-${crypto.randomUUID()}`;

export async function downloadFile(path: string, fallbackFilename: string) {
  const response = await fetch(`/api/v1${path}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(messageForError(body.code, body.reason), response.status, body.code, body.reason);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadPdf = (path: string) => downloadFile(path, "accounting-document.pdf");
