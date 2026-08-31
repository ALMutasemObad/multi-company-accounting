export const cashierContextFields = ["warehouseId", "cashBankAccountId", "paymentMethodId", "currencyId"] as const;
export type CashierContextField = typeof cashierContextFields[number];
export type CashierContextValues = Partial<Record<CashierContextField, string | null>>;
export type CashierContextDraft = { documentDate: string; values: CashierContextValues };
/** Whitelist at the draft boundary: callers may hold a larger POS draft with financial fields. */
export function copyCashierContextValues(values: CashierContextValues): CashierContextValues {
  return Object.fromEntries(cashierContextFields.filter((field) => Object.hasOwn(values, field))
    .map((field) => [field, typeof values[field] === "string" ? values[field] : null]));
}
export type CashierContextSource = "draft" | "session" | "company" | "choice";
export type CashierContextScope = {
  userId: string; companyId: string; authorizationRevision: string;
  /** Effective permissions, after entitlement composition; server still enforces each read/write. */
  permissions: readonly string[]; modules: readonly string[];
};
export type CashierContextSuggestions = Partial<Record<CashierContextField, readonly string[]>>;
export type CashierContextReference = { id: string; label: string; revision: string; requiresReference?: boolean };
export type CashierContextReferenceResult =
  | { status: "available"; reference: CashierContextReference }
  | { status: "unavailable" | "forbidden" | "ambiguous" };
export type CashierContextFieldState = {
  id: string | null; source: CashierContextSource;
  status: "empty" | "loading" | "available" | "unavailable" | "forbidden" | "ambiguous" | "not-required";
  reference?: CashierContextReference;
};
/** Presentation DTO only; no client-side date-to-period search or calculation. */
export type CashierContextPeriodResult =
  | { documentDate: string; status: "MISSING" | "CLOSED" | "AMBIGUOUS" }
  | { documentDate: string; status: "RESOLVED"; period: {
    id: string; name: string; startDate: string; endDate: string;
    status: "OPEN" | "REOPENED"; version: number;
  } };
export type CashierContextPeriodState = CashierContextPeriodResult | {
  documentDate: string; status: "LOADING" | "UNAVAILABLE" | "FORBIDDEN";
};
export interface CashierContextReadPort {
  /** Exact-id, active, authorized, current-company reference validation by the owner. Never a first-page membership check. */
  reference(input: { scope: CashierContextScope; field: CashierContextField; id: string; signal: AbortSignal }): Promise<CashierContextReferenceResult>;
  /** Core Accounting's advisory result; no fallback when the endpoint is absent. */
  period(input: { scope: CashierContextScope; documentDate: string; signal: AbortSignal }): Promise<CashierContextPeriodResult>;
}

export function cashierContextScopeKey(scope: CashierContextScope | null): string {
  return scope ? JSON.stringify([scope.userId, scope.companyId, scope.authorizationRevision,
    [...new Set(scope.permissions)].sort(), [...new Set(scope.modules)].sort()]) : "";
}
export function canReviewCashierContext(scope: CashierContextScope | null): boolean {
  return Boolean(scope?.userId && scope.companyId && scope.permissions.includes("pos.checkout") && scope.modules.includes("POS"));
}
export function canReadCashierContextField(scope: CashierContextScope | null, field: CashierContextField): boolean {
  if (!canReviewCashierContext(scope) || !scope) return false;
  if (field === "warehouseId") return scope.permissions.includes("warehouses.view") && scope.modules.includes("INVENTORY");
  if (field === "currencyId") return scope.permissions.includes("currencies.view");
  return scope.permissions.includes("cash_bank_accounts.view") && scope.modules.includes("TREASURY");
}

/** A cleared/invalid draft is intentional: never replace it with a lower-priority default. */
export function chooseCashierContextValue(field: CashierContextField, draft: CashierContextValues,
  session: CashierContextValues, company: CashierContextSuggestions): CashierContextFieldState {
  if (Object.hasOwn(draft, field)) return { id: draft[field] ?? null, source: "draft", status: draft[field] ? "loading" : "empty" };
  if (Object.hasOwn(session, field)) return { id: session[field] ?? null, source: "session", status: session[field] ? "loading" : "empty" };
  const candidates = company[field] ?? [];
  if (candidates.length > 1) return { id: null, source: "company", status: "ambiguous" };
  if (candidates.length === 1) return { id: candidates[0] || null, source: "company", status: candidates[0] ? "loading" : "unavailable" };
  return { id: null, source: "choice", status: "empty" };
}

export type CashierContextMetricAction = "fieldChange" | "dateChange" | "review" | "saveDraft" | "remember" | "refresh";
export type CashierContextMetrics = Record<CashierContextMetricAction, number> & { elapsedMs: number };
export const emptyCashierContextMetrics = (): CashierContextMetrics => ({ fieldChange: 0, dateChange: 0, review: 0, saveDraft: 0, remember: 0, refresh: 0, elapsedMs: 0 });
