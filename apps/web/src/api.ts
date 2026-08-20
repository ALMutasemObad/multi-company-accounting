import { messageForError } from "./domain";
import { storageKey } from "./branding";

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

let csrfToken =
  typeof sessionStorage === "undefined"
    ? ""
    : sessionStorage.getItem(storageKey("csrf")) ?? "";

export function setCsrfToken(value: string) {
  csrfToken = value;
  if (typeof sessionStorage !== "undefined")
    sessionStorage.setItem(storageKey("csrf"), value);
}

export function clearCsrfToken() {
  csrfToken = "";
  if (typeof sessionStorage !== "undefined")
    sessionStorage.removeItem(storageKey("csrf"));
}

export async function api<T>(
  path: string,
  options: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken)
    headers.set("X-CSRF-Token", csrfToken);
  if (options.idempotencyKey)
    headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      messageForError(body.code, body.reason),
      response.status,
      body.code,
      body.reason,
    );
  }
  return body as T;
}

let beginLoginRequest: Promise<void> | null = null;

export function beginLogin() {
  if (beginLoginRequest) return beginLoginRequest;
  beginLoginRequest = api<{ csrfToken: string }>("/auth/csrf")
    .then((result) => setCsrfToken(result.csrfToken))
    .finally(() => { beginLoginRequest = null; });
  return beginLoginRequest;
}

export async function login(email: string, password: string) {
  const result = await api<{
    user: { id: string; displayName: string };
    csrfToken: string;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setCsrfToken(result.csrfToken);
  return result.user;
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
