import { describe, expect, it } from "vitest";
import { isServiceCommerciallyAvailable, ServiceCatalogPolicyError, transitionServiceCategory, transitionServiceOffering,
  transitionServiceVariant, validateAvailabilityWindow, validateServiceVariantEdit } from "../src/service-catalog/service-offering-policy.js";

const reason = "Approved status transition";
const window = { availableFrom: "2026-10-01", availableUntil: "2026-11-01" };
const code = (action: () => unknown) => { try { action(); } catch (cause) { return cause instanceof ServiceCatalogPolicyError ? cause.code : "UNKNOWN"; } return "NONE"; };

describe("independent service offering policy", () => {
  it("makes retired categories final and requires a reason", () => {
    expect(transitionServiceCategory({ from: "ACTIVE", to: "INACTIVE", reason })).toBe("INACTIVE");
    expect(transitionServiceCategory({ from: "INACTIVE", to: "RETIRED", reason })).toBe("RETIRED");
    expect(code(() => transitionServiceCategory({ from: "RETIRED", to: "ACTIVE", reason }))).toBe("SERVICE_CATEGORY_RETIRED");
    expect(code(() => transitionServiceCategory({ from: "ACTIVE", to: "INACTIVE", reason: "short" }))).toBe("SERVICE_TRANSITION_REASON_REQUIRED");
  });
  it("activates an offering only when it has a non-retired variant", () => {
    expect(code(() => transitionServiceOffering({ from: "DRAFT", to: "ACTIVE", variantStatuses: [], reason }))).toBe("SERVICE_VARIANT_REQUIRED");
    expect(transitionServiceOffering({ from: "DRAFT", to: "ACTIVE", variantStatuses: ["DRAFT"], reason })).toBe("ACTIVE");
    expect(code(() => transitionServiceOffering({ from: "RETIRED", to: "ACTIVE", variantStatuses: ["ACTIVE"], reason }))).toBe("SERVICE_OFFERING_RETIRED");
  });
  it("keeps variant activation independent of pricing and validates real dates", () => {
    expect(transitionServiceVariant({ from: "DRAFT", to: "ACTIVE", offeringStatus: "DRAFT", availability: window, reason })).toBe("ACTIVE");
    expect(code(() => transitionServiceVariant({ from: "DRAFT", to: "ACTIVE", offeringStatus: "RETIRED", availability: window, reason }))).toBe("SERVICE_OFFERING_RETIRED");
    expect(code(() => validateAvailabilityWindow({ availableFrom: "2026-10-01", availableUntil: "2026-10-01" }))).toBe("INVALID_SERVICE_AVAILABILITY_WINDOW");
    expect(code(() => validateAvailabilityWindow({ availableFrom: "2026-02-30", availableUntil: null }))).toBe("INVALID_SERVICE_DATE");
  });
  it("uses a half-open window without assuming staff capacity or stock", () => {
    const input = { offeringStatus: "ACTIVE" as const, variantStatus: "ACTIVE" as const, availability: window };
    expect(isServiceCommerciallyAvailable({ ...input, asOf: "2026-09-30" })).toBe(false);
    expect(isServiceCommerciallyAvailable({ ...input, asOf: "2026-10-01" })).toBe(true);
    expect(isServiceCommerciallyAvailable({ ...input, asOf: "2026-11-01" })).toBe(false);
    expect(isServiceCommerciallyAvailable({ ...input, offeringStatus: "INACTIVE", asOf: "2026-10-15" })).toBe(false);
  });
  it("freezes the pricing unit after activation and prevents retroactive availability edits", () => {
    const edit = { everActivated: true, previousUnit: "HOUR" as const, nextUnit: "HOUR" as const,
      previousAvailability: window, nextAvailability: window, asOf: "2026-10-15" };
    expect(() => validateServiceVariantEdit(edit)).not.toThrow();
    expect(code(() => validateServiceVariantEdit({ ...edit, nextUnit: "SESSION" }))).toBe("SERVICE_PRICING_UNIT_IMMUTABLE");
    expect(code(() => validateServiceVariantEdit({ ...edit, nextAvailability: { ...window, availableFrom: "2026-10-02" } }))).toBe("SERVICE_AVAILABILITY_START_IMMUTABLE");
    expect(code(() => validateServiceVariantEdit({ ...edit, nextAvailability: { ...window, availableUntil: "2026-10-14" } }))).toBe("SERVICE_AVAILABILITY_END_NOT_FUTURE");
    const openStart = { availableFrom: null, availableUntil: null };
    expect(code(() => validateServiceVariantEdit({ ...edit, previousAvailability: openStart,
      nextAvailability: { availableFrom: "2026-10-20", availableUntil: null } }))).toBe("SERVICE_AVAILABILITY_START_IMMUTABLE");
    expect(() => validateServiceVariantEdit({ ...edit, everActivated: false, previousAvailability: openStart,
      nextAvailability: { availableFrom: "2026-10-20", availableUntil: null } })).not.toThrow();
  });
});
