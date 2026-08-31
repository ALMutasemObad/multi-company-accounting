import { describe, expect, it } from "vitest";
import { comparedModuleCodes, publicOfferDecimal, publicOfferReadiness } from "./public-offers";
import type { SubscriptionPlanVersion } from "./types";
import type { PublicSubscriptionPlan } from "./public-plans";

const version: SubscriptionPlanVersion = {
  id: "12", planId: "4", planCode: "BASIC", version: 3, versionNumber: 1, displayName: "Plan", description: null,
  billingCycle: "ANNUAL", currencyCode: "SAR", recurringFee: "999999999999.1234", taxRate: "10.0000",
  includedUsers: 0, includedEmployees: 0, includedPostedDocuments: 0,
  pricePerAdditionalUser: null, pricePerAdditionalEmployee: null, pricePerAdditionalPostedDocument: null,
  paymentTermsDays: 0, trialDays: 0, effectiveFrom: "2026-08-01T00:00:00Z", selfServicePolicy: "REQUEST_ONLY",
  publicationStatus: "PUBLISHED", publishedAt: "2026-08-01T00:00:00Z", retiredAt: null, publiclyListed: false,
  modules: [{ id: "1", code: "ACCOUNTING", displayName: "Accounting", active: true, selectionMode: "INCLUDED", additionalRecurringFee: null, dependencyIds: [] }],
};
const plan = { active: true, code: "BASIC" };
const now = Date.parse("2026-08-31T00:00:00Z");

describe("public offer display helpers", () => {
  it.each([["10", "10"], ["100.0000", "100"], ["10.5000", "10.5"], ["0.0001", "0.0001"], ["999999999999.1234", "999999999999.1234"]])("preserves exact digits for %s", (value, expected) => {
    expect(publicOfferDecimal(value)).toBe(expected);
  });
  it("only compares modules in the supplied offers without fetching or changing them", () => {
    const module = { code: "ACCOUNTING", displayName: "Accounting", selectionMode: "INCLUDED" as const, additionalRecurringFee: null };
    const plans = [{ modules: [module] }, { modules: [module, { ...module, code: "REPORTS" }] }] as PublicSubscriptionPlan[];
    expect(comparedModuleCodes(plans)).toEqual(["ACCOUNTING", "REPORTS"]);
    expect(comparedModuleCodes([])).toEqual([]);
    expect(plans[0]!.modules).toEqual([module]);
  });
  it("treats a complete zero allowance as configured, not unlimited or missing", () => {
    expect(publicOfferReadiness(plan, version, now).every((check) => check.passed)).toBe(true);
  });
  it.each([
    ["published", { publicationStatus: "DRAFT" }], ["published", { publishedAt: null }],
    ["effective", { effectiveFrom: "2027-01-01T00:00:00Z" }], ["effective", { effectiveFrom: "invalid" }],
    ["effective", { retiredAt: "2026-08-30T00:00:00Z" }], ["selfService", { selfServicePolicy: "DISABLED" }],
    ["complete", { recurringFee: null }], ["complete", { includedUsers: null }],
    ["complete", { includedEmployees: null }], ["complete", { includedPostedDocuments: null }],
  ] as const)("explains missing readiness for %s", (key, overrides) => {
    expect(publicOfferReadiness(plan, { ...version, ...overrides }, now).find((check) => check.key === key)?.passed).toBe(false);
  });
  it("excludes inactive and legacy plans", () => {
    expect(publicOfferReadiness({ ...plan, active: false }, version, now)[0].passed).toBe(false);
    expect(publicOfferReadiness({ ...plan, code: "LEGACY_COMPANY_5" }, version, now)[0].passed).toBe(false);
  });
  it("detects inactive, missing, cyclic and optional dependencies of included modules", () => {
    const base = version.modules[0]!;
    for (const modules of [
      [{ ...base, active: false }], [{ ...base, dependencyIds: ["2"] }], [{ ...base, dependencyIds: ["1"] }],
      [base, base], [{ ...base, selectionMode: "OPTIONAL" as const, additionalRecurringFee: null }],
      [{ ...base, dependencyIds: ["2"] }, { ...base, id: "2", selectionMode: "OPTIONAL" as const, additionalRecurringFee: "0.0000" }],
    ]) expect(publicOfferReadiness(plan, { ...version, modules }, now).find((check) => check.key === "modules")?.passed).toBe(false);
  });
});
