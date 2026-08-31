import { useEffect, useRef, useState } from "react";
import { billingAttemptStore, BillingAttemptLocked, BillingStorageUnavailable, billingCommandFailure, type BillingAttempt, type BillingAttemptInput } from "./billing-recovery-attempt";
import { billingReadError, initialBillingQuery, loadBillingRecoveryPages, sendBillingAttempt } from "./billing-recovery-requests";
import { isNavigableCheckoutUrl } from "./electronic-payments";

export function useBillingRecovery(userId: string, companyId: string | undefined, canRead: boolean, canManage: boolean) {
  const scope = `${userId}:${companyId ?? "none"}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const access = useRef({ canRead, canManage });
  access.current = { canRead, canManage };
  const mounted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const commandController = useRef<AbortController | null>(null);
  const navigationEpoch = useRef(0);
  const [query, setQuery] = useState(initialBillingQuery);
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<(Awaited<ReturnType<typeof loadBillingRecoveryPages>> & { scope: string }) | null>(null);
  const [record, setRecord] = useState<{ scope: string; attempt: BillingAttempt | null }>({ scope, attempt: null });
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const pending = pendingScope === scope;
  const [error, setError] = useState<ReturnType<typeof billingReadError> | null>(null);
  const [confirmationScope, setConfirmationScope] = useState<string | null>(null);
  const confirmed = confirmationScope === scope;
  const [navigationErrorScope, setNavigationErrorScope] = useState<string | null>(null);
  const [reviewReady, setReviewReady] = useState(false);

  useEffect(() => {
    mounted.current = true;
    setPendingScope(null); setConfirmationScope(null); setNavigationErrorScope(null); setStorageBlocked(false); setReviewReady(false);
    try { setRecord({ scope, attempt: billingAttemptStore.read(scope) }); }
    catch { setStorageBlocked(true); }
    const leave = () => { navigationEpoch.current++; commandController.current?.abort(); readController.current?.abort(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("hashchange", leave);
    window.addEventListener("popstate", leave);
    return () => {
      mounted.current = false; commandController.current?.abort(); commandController.current = null;
      window.removeEventListener("pagehide", leave); window.removeEventListener("hashchange", leave); window.removeEventListener("popstate", leave);
    };
  }, [scope, canRead, canManage]);

  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    let active = true;
    setLoading(true); setError(null); setReviewReady(false);
    if (!canRead || !companyId) { setLoading(false); return () => { active = false; controller.abort(); }; }
    void loadBillingRecoveryPages(companyId, query, controller.signal).then((pages) => {
      if (!active || currentScope.current !== scope) return;
      setSnapshot({ ...pages, scope });
      try {
        const saved = billingAttemptStore.read(scope);
        // Only a complete command acknowledgement may be released by a subsequent successful read.
        if (saved?.outcome === "confirmed") billingAttemptStore.releaseReviewed(saved);
        setRecord({ scope, attempt: billingAttemptStore.read(scope) });
        setReviewReady(saved?.outcome === "rejected");
      } catch { setStorageBlocked(true); }
    }).catch((cause: unknown) => {
      if (active && currentScope.current === scope) setError(billingReadError(cause));
    }).finally(() => {
      if (active && currentScope.current === scope) { setLoading(false); readController.current = null; }
    });
    return () => { active = false; controller.abort(); };
  }, [companyId, scope, canRead, query, reload]);

  async function command(input: Omit<BillingAttemptInput, "scope">) {
    if (!mounted.current || currentScope.current !== scope || !canManage || !canRead || !companyId || loading || commandController.current) return;
    const controller = new AbortController();
    commandController.current = controller;
    const startLocation = globalThis.location.href;
    const startNavigation = navigationEpoch.current;
    const active = () => mounted.current && currentScope.current === scope && access.current.canRead && access.current.canManage && commandController.current === controller;
    let attempt: BillingAttempt;
    try { attempt = billingAttemptStore.begin({ ...input, scope }); }
    catch (cause) {
      if (cause instanceof BillingStorageUnavailable) setStorageBlocked(true);
      if (cause instanceof BillingAttemptLocked) {
        try { setRecord({ scope, attempt: billingAttemptStore.read(scope) }); } catch { setStorageBlocked(true); }
      }
      commandController.current = null;
      return;
    }
    setRecord({ scope, attempt }); setPendingScope(scope); setConfirmationScope(null); setNavigationErrorScope(null); setError(null); setReviewReady(false);
    try {
      const payment = await sendBillingAttempt(attempt, companyId, controller.signal);
      if (!active() || controller.signal.aborted) return;
      setConfirmationScope(scope);
      try { setRecord({ scope, attempt: billingAttemptStore.settle(attempt, "confirmed") }); }
      catch { setStorageBlocked(true); }
      // Refresh failure is a READ failure, never a failure of this acknowledged command.
      setReload((value) => value + 1);
      if (attempt.command !== "cancel" && navigationEpoch.current === startNavigation && globalThis.location.href === startLocation && isNavigableCheckoutUrl(payment.checkoutUrl)) {
        // A browser navigation failure cannot undo a confirmed server command.
        try { globalThis.location.assign(payment.checkoutUrl); }
        catch { setNavigationErrorScope(scope); }
      }
    } catch (cause) {
      if (!active()) return;
      const failure = billingCommandFailure(cause);
      try { setRecord({ scope, attempt: billingAttemptStore.settle(attempt, failure.outcome, failure.issue) }); }
      catch { setStorageBlocked(true); }
    } finally {
      if (active()) { commandController.current = null; setPendingScope(null); }
    }
  }

  function acknowledgeRejection() {
    const saved = record.scope === scope ? record.attempt : null;
    if (!reviewReady || loading || pending || saved?.outcome !== "rejected") return;
    try { if (billingAttemptStore.releaseReviewed(saved)) setRecord({ scope, attempt: null }); }
    catch { setStorageBlocked(true); }
    setReviewReady(false);
  }
  const attempt = record.scope === scope ? record.attempt : null;
  return { query, setQuery, snapshot: snapshot?.scope === scope ? snapshot : null, attempt, pending, loading, error,
    confirmed, navigationError: navigationErrorScope === scope, storageBlocked, reviewReady, acknowledgeRejection,
    blocked: loading || pending || Boolean(error) || Boolean(attempt) || storageBlocked || !canManage || !canRead || !companyId,
    command, refresh: () => setReload((value) => value + 1), stopWaiting: () => { commandController.current?.abort(); },
    stopReading: () => readController.current?.abort(),
  };
}
