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
  const id = new URLSearchParams(hash.split("?", 2)[1] ?? "").get("plan");
  if (id) rememberSubscriptionPlan(id);
}
export const registrationPlanHref = (id: string) => validPlanId(id) ? `/#register?plan=${encodeURIComponent(id)}` : "/#register";
export const isPublicPlansLocation = (pathname: string, hash: string) =>
  /^\/plans\/?$/u.test(pathname) || ["#plans", "#plans-catalog", "#plans-faq"].includes(hash.split("?", 1)[0] ?? "");
