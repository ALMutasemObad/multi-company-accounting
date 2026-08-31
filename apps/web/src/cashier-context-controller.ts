import {
  cashierContextFields, cashierContextScopeKey, canReadCashierContextField, canReviewCashierContext,
  chooseCashierContextValue, copyCashierContextValues, emptyCashierContextMetrics,
  type CashierContextDraft, type CashierContextField, type CashierContextFieldState,
  type CashierContextMetrics, type CashierContextMetricAction, type CashierContextPeriodState,
  type CashierContextReadPort, type CashierContextReference, type CashierContextScope,
  type CashierContextSuggestions, type CashierContextValues,
} from "./cashier-context-model";

export type CashierContextLock = "scan-pending" | "checkout-pending" | "checkout-unknown" | "checkout-completed" | null;
export type CashierContextReviewed = {
  documentDate: string; fiscalPeriodId: string; warehouseId: string | null;
  cashBankAccountId: string; paymentMethodId: string; currencyId: string;
  paymentRequiresReference: boolean;
};
export type CashierContextSnapshot = {
  scopeKey: string; documentDate: string; requiresWarehouse: boolean;
  fields: Record<CashierContextField, CashierContextFieldState>;
  period: CashierContextPeriodState; lock: CashierContextLock;
  canEdit: boolean; canReview: boolean; reviewed: boolean; hasSavedDraft: boolean; verificationExpired: boolean;
};

/** One instance per mounted, authenticated POS workspace. Memory only: no browser storage or global cache. */
export function createCashierContextController(reader: CashierContextReadPort, now: () => number = () => performance.now(), reviewMaxAgeMs = 300_000) {
  if (!Number.isFinite(reviewMaxAgeMs) || reviewMaxAgeMs <= 0) throw new Error("Invalid context review lifetime");
  let scope: CashierContextScope | null = null;
  let scopeKey = "";
  let documentDate = "";
  let requiresWarehouse = true;
  let draft: CashierContextValues = {};
  let savedDraft: CashierContextDraft | null = null;
  let remembered: CashierContextValues = {};
  let company: CashierContextSuggestions = {};
  let fields = initialFields();
  let period: CashierContextPeriodState = { documentDate: "", status: "UNAVAILABLE" };
  let lock: CashierContextLock = null;
  let reviewed: CashierContextReviewed | null = null;
  let reviewedAt: number | null = null;
  let reusableReview: { signature: string; value: CashierContextReviewed; at: number } | null = null;
  let metrics = emptyCashierContextMetrics();
  let startedAt = now();
  const listeners = new Set<() => void>();
  const requests = new Map<CashierContextField | "period", AbortController>();
  const validatedAt = new Map<CashierContextField | "period", number>();

  function initialFields() {
    return Object.fromEntries(cashierContextFields.map((field) => [field, { id: null, source: "choice", status: "empty" }])) as Record<CashierContextField, CashierContextFieldState>;
  }
  function canEdit() { return canReviewCashierContext(scope) && lock === null; }
  function fresh(at: number | null) { const elapsed = at === null ? NaN : now() - at; return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < reviewMaxAgeMs; }
  function signature() {
    return JSON.stringify([scopeKey, documentDate, requiresWarehouse, period,
      cashierContextFields.map((field) => [field, fields[field].id, fields[field].status, fields[field].reference ?? null])]);
  }
  function ready() {
    return canEdit() && period.status === "RESOLVED" && period.documentDate === documentDate
      && fresh(validatedAt.get("period") ?? null)
      && cashierContextFields.every((field) => (field === "warehouseId" && !requiresWarehouse)
        || (fields[field].status === "available" && fresh(validatedAt.get(field) ?? null)));
  }
  function snapshot(): CashierContextSnapshot {
    const verificationExpired = (period.status === "RESOLVED" && !fresh(validatedAt.get("period") ?? null))
      || cashierContextFields.some((field) => fields[field].status === "available" && !fresh(validatedAt.get(field) ?? null));
    return { scopeKey, documentDate, requiresWarehouse, fields, period, lock, canEdit: canEdit(), canReview: ready(),
      reviewed: reviewed !== null && fresh(reviewedAt) && !verificationExpired, hasSavedDraft: savedDraft !== null, verificationExpired };
  }
  let current = snapshot();
  function publish(invalidate = true) {
    if (invalidate) { reviewed = null; reviewedAt = null; }
    current = snapshot();
    listeners.forEach((listener) => listener());
  }
  function count(action: CashierContextMetricAction) { metrics = { ...metrics, [action]: metrics[action] + 1 }; }
  function abort(key: CashierContextField | "period") { requests.get(key)?.abort(); requests.delete(key); }
  function abortAll() { for (const key of requests.keys()) abort(key); }
  function setField(field: CashierContextField, state: CashierContextFieldState) { fields = { ...fields, [field]: state }; }
  function safeReference(value: CashierContextReference, id: string) {
    return value.id === id && /^[1-9][0-9]*$/.test(id) && value.label.trim().length > 0
      && value.revision.length > 0 && (value.requiresReference === undefined || typeof value.requiresReference === "boolean");
  }
  async function validateField(field: CashierContextField) {
    abort(field); validatedAt.delete(field);
    if (field === "warehouseId" && !requiresWarehouse) { setField(field, { id: null, source: "choice", status: "not-required" }); publish(); return; }
    const choice = chooseCashierContextValue(field, draft, remembered, company);
    if (!scope || !canReadCashierContextField(scope, field)) {
      setField(field, { id: null, source: "choice", status: "forbidden" }); publish(); return;
    }
    setField(field, choice); publish();
    if (!choice.id || choice.status !== "loading") return;
    if (!/^[1-9][0-9]*$/.test(choice.id)) { setField(field, { ...choice, status: "unavailable" }); publish(); return; }
    const controller = new AbortController(); requests.set(field, controller);
    try {
      const result = await reader.reference({ scope, field, id: choice.id, signal: controller.signal });
      if (controller.signal.aborted || requests.get(field) !== controller) return;
      if (result.status === "available" && safeReference(result.reference, choice.id)
        && (field !== "paymentMethodId" || typeof result.reference.requiresReference === "boolean")) {
        const value = result.reference;
        setField(field, { ...choice, source: Object.hasOwn(draft, field) ? "draft" : choice.source, status: "available",
          reference: { id: value.id, label: value.label, revision: value.revision,
            ...(field === "paymentMethodId" ? { requiresReference: value.requiresReference } : {}) } });
        validatedAt.set(field, now());
      } else setField(field, { ...choice, status: result.status === "available" ? "unavailable" : result.status });
    } catch {
      if (controller.signal.aborted || requests.get(field) !== controller) return;
      setField(field, { ...choice, status: "unavailable" });
    } finally {
      if (requests.get(field) === controller) { requests.delete(field); publish(); }
    }
  }
  async function validatePeriod() {
    abort("period"); validatedAt.delete("period");
    if (!scope || !canReviewCashierContext(scope)) { period = { documentDate, status: "FORBIDDEN" }; publish(); return; }
    // Validity and matching are owned by the server. Even a date that looks valid is not resolved here.
    if (!documentDate) { period = { documentDate, status: "UNAVAILABLE" }; publish(); return; }
    const date = documentDate;
    const controller = new AbortController(); requests.set("period", controller);
    period = { documentDate: date, status: "LOADING" }; publish();
    try {
      const result = await reader.period({ scope, documentDate: date, signal: controller.signal });
      if (controller.signal.aborted || requests.get("period") !== controller) return;
      const validResolved = result.status !== "RESOLVED" || (/^[1-9][0-9]*$/.test(result.period.id)
        && result.period.name.trim().length > 0 && ["OPEN", "REOPENED"].includes(result.period.status)
        && Number.isSafeInteger(result.period.version) && result.period.version >= 0);
      if (result.documentDate !== date || !validResolved) period = { documentDate: date, status: "UNAVAILABLE" };
      else if (result.status === "RESOLVED") {
        const value = result.period;
        period = { documentDate: date, status: "RESOLVED", period: { id: value.id, name: value.name,
          startDate: value.startDate, endDate: value.endDate, status: value.status, version: value.version } };
      } else period = { documentDate: date, status: ["MISSING", "CLOSED", "AMBIGUOUS"].includes(result.status) ? result.status : "UNAVAILABLE" };
      if (period.status === "RESOLVED") validatedAt.set("period", now());
    } catch {
      if (controller.signal.aborted || requests.get("period") !== controller) return;
      period = { documentDate: date, status: "UNAVAILABLE" };
    } finally {
      if (requests.get("period") === controller) { requests.delete("period"); publish(); }
    }
  }
  async function validateAll() { await Promise.all([...cashierContextFields.map(validateField), validatePeriod()]); }

  return {
    getSnapshot: () => {
      if (current.reviewed && !fresh(reviewedAt)) { reviewed = null; reviewedAt = null; reusableReview = null; }
      const latest = snapshot();
      if (latest.reviewed !== current.reviewed || latest.canReview !== current.canReview || latest.verificationExpired !== current.verificationExpired) current = latest;
      return current;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScope(next: CashierContextScope | null) {
      const key = cashierContextScopeKey(next);
      if (key === scopeKey) return;
      abortAll(); validatedAt.clear();
      scope = next ? { ...next, permissions: [...next.permissions], modules: [...next.modules] } : null;
      scopeKey = key; documentDate = ""; draft = {}; savedDraft = null; remembered = {}; company = {};
      fields = initialFields(); period = { documentDate: "", status: "UNAVAILABLE" }; reviewed = null; reviewedAt = null; reusableReview = null;
      lock = null; requiresWarehouse = true; metrics = emptyCashierContextMetrics(); startedAt = now(); publish();
    },
    /** Must only be called for an explicit new sale; unknown/pending attempts cannot be replaced. */
    async startSale(input: { documentDate: string; requiresWarehouse: boolean; draft?: CashierContextDraft; companySuggestions?: CashierContextSuggestions }) {
      if (!canEdit()) return false;
      abortAll();
      documentDate = input.draft?.documentDate ?? input.documentDate;
      draft = copyCashierContextValues(input.draft?.values ?? {}); savedDraft = input.draft ? { documentDate, values: { ...draft } } : null;
      company = Object.fromEntries(cashierContextFields.filter((field) => input.companySuggestions?.[field] !== undefined)
        .map((field) => [field, [...input.companySuggestions![field]!]]));
      requiresWarehouse = input.requiresWarehouse; reviewed = null; fields = initialFields();
      metrics = emptyCashierContextMetrics(); startedAt = now();
      const reusable = reusableReview;
      await validateAll();
      // Reuse is only for an explicitly remembered, unchanged, recently reviewed context.
      // It follows fresh owner reads and does not count as another cashier confirmation.
      if (reusable && reusableReview === reusable && ready() && fresh(reusable.at) && signature() === reusable.signature) {
        reviewed = { ...reusable.value }; reviewedAt = reusable.at; publish(false);
      } else reusableReview = null;
      return true;
    },
    async select(field: CashierContextField, id: string | null) {
      if (!canEdit() || !canReadCashierContextField(scope, field) || (field === "warehouseId" && !requiresWarehouse)) return false;
      reusableReview = null; draft = { ...draft, [field]: id }; count("fieldChange"); await validateField(field); return true;
    },
    async changeDate(date: string) {
      if (!canEdit()) return false;
      reusableReview = null; documentDate = date; count("dateChange"); await validatePeriod(); return true;
    },
    async setRequiresWarehouse(required: boolean) {
      if (!canEdit() || requiresWarehouse === required) return false;
      reusableReview = null; requiresWarehouse = required; await validateField("warehouseId"); return true;
    },
    setLock(next: CashierContextLock) { if (next !== lock) { lock = next; publish(); } },
    saveDraft() {
      if (!canEdit()) return false;
      savedDraft = { documentDate, values: Object.fromEntries(cashierContextFields
        .filter((field) => field !== "warehouseId" || requiresWarehouse).map((field) => [field, fields[field].id])) };
      draft = { ...savedDraft.values }; count("saveDraft");
      fields = Object.fromEntries(cashierContextFields.map((field) => [field, fields[field].status === "not-required" ? fields[field] : { ...fields[field], source: "draft" }])) as typeof fields;
      publish(); return true;
    },
    getSavedDraft: () => savedDraft ? { documentDate: savedDraft.documentDate, values: { ...savedDraft.values } } : null,
    async refresh() { if (!canEdit()) return false; reusableReview = null; count("refresh"); await validateAll(); return true; },
    review(rememberForNextSale = false): CashierContextReviewed | null {
      if (!ready() || period.status !== "RESOLVED") return null;
      reviewed = { documentDate, fiscalPeriodId: period.period.id, warehouseId: requiresWarehouse ? fields.warehouseId.id : null,
        cashBankAccountId: fields.cashBankAccountId.id!, paymentMethodId: fields.paymentMethodId.id!, currencyId: fields.currencyId.id!,
        paymentRequiresReference: fields.paymentMethodId.reference!.requiresReference! };
      reviewedAt = now();
      if (rememberForNextSale) {
        remembered = Object.fromEntries(cashierContextFields.filter((field) => field !== "warehouseId" || requiresWarehouse).map((field) => [field, fields[field].id]));
        count("remember");
        reusableReview = { signature: signature(), value: { ...reviewed }, at: reviewedAt };
      }
      count("review"); publish(false); return { ...reviewed! };
    },
    getReviewed: () => ready() && reviewed && fresh(reviewedAt) ? { ...reviewed } : null,
    getReviewRemainingMs: () => {
      const times = [...validatedAt.values(), ...(reviewedAt === null ? [] : [reviewedAt])];
      return times.length ? Math.max(0, Math.min(...times.map((at) => fresh(at) ? reviewMaxAgeMs - (now() - at) : 0))) : 0;
    },
    expireReview() { if (!fresh(reviewedAt) || !ready()) { reusableReview = null; publish(); } },
    getMetrics(): CashierContextMetrics {
      const elapsed = now() - startedAt;
      return { ...metrics, elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0 };
    },
    dispose() { abortAll(); validatedAt.clear(); scope = null; scopeKey = ""; draft = {}; savedDraft = null; remembered = {}; company = {};
      fields = initialFields(); period = { documentDate: "", status: "UNAVAILABLE" }; documentDate = ""; reviewed = null; reviewedAt = null; reusableReview = null;
      metrics = emptyCashierContextMetrics(); publish(); listeners.clear(); },
  };
}
export type CashierContextController = ReturnType<typeof createCashierContextController>;
