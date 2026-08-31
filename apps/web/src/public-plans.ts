import { storageKey } from "./branding";

export type PublicSubscriptionPlan = {
  id: string; displayName: string; description: string | null;
  billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  currencyCode: string; recurringFee: string; taxRate: string; trialDays: number;
  includedUsers: number; includedEmployees: number; includedPostedDocuments: number;
  pricePerAdditionalUser: string | null; pricePerAdditionalEmployee: string | null;
  pricePerAdditionalPostedDocument: string | null; requiresApproval: boolean;
  modules: Array<{ code: string; displayName: string; selectionMode: "INCLUDED" | "OPTIONAL"; additionalRecurringFee: string | null }>;
};
export type PublicSubscriptionCatalog = {
  plans: PublicSubscriptionPlan[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

const intentKey = storageKey("subscription-plan-intent");
const validPlanId = (id: string) => /^[1-9][0-9]{0,19}$/u.test(id);
type SubscriptionPlanDestination = "login" | "register" | "subscription";
export const subscriptionRouteBase = (hash: string) => hash.split("?", 1)[0] ?? "";

function routePlan(hash: string): { present: boolean; id: string | null } {
  if (!["#login", "#register", "#subscription"].includes(subscriptionRouteBase(hash))) return { present: false, id: null };
  const queryStart = hash.indexOf("?");
  const ids = new URLSearchParams(queryStart < 0 ? "" : hash.slice(queryStart + 1)).getAll("plan");
  return { present: ids.length > 0, id: ids.length === 1 && validPlanId(ids[0]!) ? ids[0]! : null };
}

// URL intent is explicit and survives disabled storage. It is never a purchase command.
// An invalid/ambiguous explicit parameter must not resurrect an older stored choice.
export function subscriptionPlanForRoute(hash: string): string | null {
  const candidate = routePlan(hash);
  return candidate.present ? candidate.id : preferredSubscriptionPlan();
}
export const subscriptionPlanHash = (destination: SubscriptionPlanDestination, id: string | null) =>
  `${destination}${id && validPlanId(id) ? `?plan=${encodeURIComponent(id)}` : ""}`;
export const subscriptionPlanHref = (destination: SubscriptionPlanDestination, id: string | null) =>
  `/#${subscriptionPlanHash(destination, id)}`;

// A short-lived UI preference only. The authenticated catalog and command revalidate it.
export function rememberSubscriptionPlan(id: string) {
  if (!validPlanId(id)) return;
  try { sessionStorage.setItem(intentKey, JSON.stringify({ id, expiresAt: Date.now() + 86_400_000 })); } catch { /* Storage may be disabled. */ }
}
export function preferredSubscriptionPlan(): string | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(intentKey) ?? "null");
    if (value && typeof value === "object" && "id" in value && typeof value.id === "string" && validPlanId(value.id)
      && "expiresAt" in value && typeof value.expiresAt === "number" && value.expiresAt > Date.now()) return value.id;
    sessionStorage.removeItem(intentKey);
  } catch { /* Untrusted/disabled storage never blocks authentication. */ }
  return null;
}
export function clearSubscriptionPlanPreference() {
  try { sessionStorage.removeItem(intentKey); } catch { /* Storage may be disabled. */ }
}
export function captureSubscriptionPlanPreference(hash: string) {
  const { id, present } = routePlan(hash);
  if (id) rememberSubscriptionPlan(id);
  else if (present) clearSubscriptionPlanPreference();
}
export const registrationPlanHref = (id: string) => subscriptionPlanHref("register", id);
export const isPublicPlansLocation = (pathname: string, hash: string) =>
  /^\/plans\/?$/u.test(pathname) || ["#plans", "#plans-catalog", "#plans-faq"].includes(hash.split("?", 1)[0] ?? "");
