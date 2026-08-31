import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_TIMEOUT_MS } from "./auth-resilience";
import { withinRequest } from "./request-scope";

export function useAuthAction() {
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); active.current = null; };
  }, []);
  const cancel = useCallback(() => active.current?.abort(), []);
  const run = useCallback(async <T,>(
    work: (signal: AbortSignal) => Promise<T>,
    options: { timeoutMs?: number; onSuccess?: (result: T) => void; onError?: (cause: unknown) => void } = {},
  ) => {
    if (active.current) return; // Synchronous guard against double submits, including the same render.
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await withinRequest(work, { signal: controller.signal, timeoutMs: options.timeoutMs ?? AUTH_TIMEOUT_MS });
      if (mounted.current && active.current === controller) options.onSuccess?.(result);
    } catch (cause) {
      if (mounted.current && active.current === controller) { setError(cause); options.onError?.(cause); }
    } finally {
      if (mounted.current && active.current === controller) { active.current = null; setBusy(false); }
    }
  }, []);
  return { busy, error, run, cancel };
}
