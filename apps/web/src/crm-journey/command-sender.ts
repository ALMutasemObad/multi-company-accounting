import { api, idempotencyKey } from "../api";

// Keep the same command identity when a user retries an unchanged failed request.
// This is intentionally local to one mounted company workspace, not durable recovery.
export function createCrmCommandSender() {
  const attempts = new Map<string, string>();
  return async (path: string, options: { method: "POST"; signal: AbortSignal; body: string }) => {
    const fingerprint = JSON.stringify([path, options.body]);
    let key = attempts.get(fingerprint);
    if (!key) {
      // Never put user-entered names in HTTP headers (Arabic is not a ByteString).
      key = idempotencyKey("crm-command", "request");
      attempts.set(fingerprint, key);
    }
    const result = await api(path, { ...options, idempotencyKey: key });
    attempts.delete(fingerprint);
    return result;
  };
}
