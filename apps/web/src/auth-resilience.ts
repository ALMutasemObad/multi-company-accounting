import { api, ApiError, beginLogin } from "./api";
import type { createTranslator } from "./i18n";
import { RequestError } from "./request-scope";

export const AUTH_TIMEOUT_MS = 15_000;
// Provisioning already has a server budget of up to 45s; do not cut it to a login read budget.
export const AUTH_VERIFICATION_TIMEOUT_MS = 60_000;

export async function authPost<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  await beginLogin({ signal });
  return api<T>(path, { method: "POST", body: JSON.stringify(body), signal });
}

export function uncertainAuthResult(cause: unknown) {
  return cause instanceof RequestError || (cause instanceof ApiError && cause.status >= 500);
}

export function authErrorMessage(cause: unknown, t: ReturnType<typeof createTranslator>) {
  if (cause instanceof RequestError) {
    if (cause.kind === "timeout") return t("authResilience.timeout");
    if (cause.kind === "cancelled") return t("authResilience.cancelled");
    return t("authResilience.network");
  }
  if (cause instanceof ApiError) {
    if (cause.code === "INVALID_CSRF" || cause.reason === "INVALID_CSRF") return t("authResilience.csrf");
    if (cause.code === "INVALID_CREDENTIALS" || cause.code === "ACCOUNT_LOCKED") return t("login.invalidCredentials");
    if (cause.status === 429 || cause.code === "RATE_LIMITED") return t("registration.rateLimited");
    if (cause.status === 401) return t("authResilience.sessionExpired");
    if (cause.status >= 500) return t("authResilience.unavailable");
    if (cause.code === "PASSWORD_RESET_TOKEN_INVALID") return t("passwordReset.invalidToken");
    if (cause.code === "REGISTRATION_TOKEN_INVALID") return t("registration.invalidToken");
    if (cause.code === "REGISTRATION_CONFLICT") return t("registration.conflict");
    if (cause.code === "PROVISIONING_FAILED") return t("registration.provisioningFailed");
    return cause.message;
  }
  // Never expose raw browser errors, payloads, or tokens in the auth UI.
  return t("authResilience.unavailable");
}
