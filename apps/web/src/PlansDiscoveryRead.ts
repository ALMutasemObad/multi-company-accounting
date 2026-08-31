import type { PublicSubscriptionCatalog, PublicSubscriptionPlan } from "./public-plans";
import { assertRequestActive, RequestError, withinRequest } from "./request-scope";

// Display bounds of the existing public endpoint (ADR-019), not a second catalog.
export const plansDiscoveryMaxPage = 1000;
const pageSize = 9;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const decimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$/u.test(value);
const optionalDecimal = (value: unknown) => value === null || decimal(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function isPlan(value: unknown): value is PublicSubscriptionPlan {
  if (!object(value) || typeof value.id !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.id)
    || !text(value.displayName) || !(value.description === null || typeof value.description === "string")
    || !["MONTHLY", "QUARTERLY", "ANNUAL"].includes(String(value.billingCycle))
    || typeof value.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(value.currencyCode)
    || !decimal(value.recurringFee) || !decimal(value.taxRate) || !count(value.trialDays)
    || !count(value.includedUsers) || !count(value.includedEmployees) || !count(value.includedPostedDocuments)
    || !optionalDecimal(value.pricePerAdditionalUser) || !optionalDecimal(value.pricePerAdditionalEmployee)
    || !optionalDecimal(value.pricePerAdditionalPostedDocument) || typeof value.requiresApproval !== "boolean"
    || !Array.isArray(value.modules) || value.modules.length > 100) return false;
  return value.modules.every((module: unknown) => object(module) && text(module.code) && text(module.displayName)
    && (module.selectionMode === "INCLUDED" || module.selectionMode === "OPTIONAL")
    && optionalDecimal(module.additionalRecurringFee))
    && new Set(value.modules.map((module) => module.code)).size === value.modules.length;
}

export function plansDiscoveryCatalog(value: unknown, page: number): PublicSubscriptionCatalog {
  if (!object(value) || !object(value.meta) || !Array.isArray(value.plans)
    || value.plans.length > pageSize || !value.plans.every(isPlan)
    || new Set(value.plans.map((plan) => plan.id)).size !== value.plans.length
    || value.meta.page !== page || value.meta.pageSize !== pageSize
    || !count(value.meta.total) || !count(value.meta.totalPages)
    || value.meta.totalPages !== Math.ceil(value.meta.total / pageSize)
    || (value.meta.total === 0 && value.plans.length !== 0)) throw new RequestError("response");
  // Count and listing can change between the server's two reads. An empty later
  // page is not proof that a selected/hidden plan or a subscription was removed.
  return value as PublicSubscriptionCatalog;
}

export function readPlansDiscoveryPage(page: number, signal: AbortSignal): Promise<PublicSubscriptionCatalog> {
  if (!Number.isSafeInteger(page) || page < 1 || page > plansDiscoveryMaxPage) return Promise.reject(new RequestError("response"));
  return withinRequest(async (requestSignal) => {
    const response = await fetch(`/api/v1/public/subscription-plans?page=${page}`, {
      method: "GET", credentials: "omit", cache: "no-store", signal: requestSignal,
    });
    assertRequestActive(requestSignal);
    if (!response.ok) throw new RequestError("response");
    const body: unknown = await response.json();
    assertRequestActive(requestSignal);
    return plansDiscoveryCatalog(body, page);
  }, { signal, timeoutMs: 12_000 });
}
