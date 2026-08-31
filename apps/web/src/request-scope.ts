export type RequestPolicy = { signal?: AbortSignal | null; timeoutMs?: number };

export class RequestError extends Error {
  constructor(public readonly kind: "timeout" | "cancelled" | "network" | "response") {
    super(`Request ${kind}`);
    this.name = "RequestError";
  }
}

export function assertRequestActive(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw signal.reason instanceof RequestError ? signal.reason : new RequestError("cancelled");
  }
}

// One budget for the whole operation, including response-body consumption and child calls.
// Aborting the browser's wait does NOT establish whether a server write committed.
export async function withinRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal: parent, timeoutMs }: RequestPolicy = {},
): Promise<T> {
  assertRequestActive(parent);
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason instanceof RequestError ? parent.reason : new RequestError("cancelled"));
  parent?.addEventListener("abort", cancel, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(new RequestError("timeout")), timeoutMs);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    let pending: Promise<T>;
    try { pending = operation(controller.signal); } catch (cause) { pending = Promise.reject(cause); }
    const result = await Promise.race([pending, aborted]);
    assertRequestActive(controller.signal);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
    // Cancel sibling reads if another child failed, without letting late results update UI.
    controller.abort(new RequestError("cancelled"));
  }
}
