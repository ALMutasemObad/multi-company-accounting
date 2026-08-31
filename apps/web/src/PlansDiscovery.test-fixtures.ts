import type { PublicSubscriptionCatalog, PublicSubscriptionPlan } from "./public-plans";

// Deliberately test-only offers. Production has no fallback catalog.
export const discoveryTestPlan: PublicSubscriptionPlan = {
  id: "9007199254740993", displayName: "Test offer", description: null,
  billingCycle: "ANNUAL", currencyCode: "SAR", recurringFee: "123.4567", taxRate: "15.0000",
  trialDays: 0, includedUsers: 0, includedEmployees: 2, includedPostedDocuments: 50,
  pricePerAdditionalUser: "0.0000", pricePerAdditionalEmployee: null,
  pricePerAdditionalPostedDocument: "0.1234", requiresApproval: true,
  modules: [{ code: "POS", displayName: "Test checkout", selectionMode: "INCLUDED", additionalRecurringFee: null }],
};
export const discoveryTestCatalog = (plans = [discoveryTestPlan], page = 1, total = plans.length): PublicSubscriptionCatalog => ({
  plans, meta: { page, pageSize: 9, total, totalPages: Math.ceil(total / 9) },
});
