/** Commercial service definitions are independent of projects, inventory and billing. */
export type ServiceCategoryStatus = "ACTIVE" | "INACTIVE" | "RETIRED";
export type ServiceOfferingStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "RETIRED";
export type ServiceVariantStatus = ServiceOfferingStatus;
export type ServicePricingUnit = "EACH" | "HOUR" | "DAY" | "SESSION" | "MONTH";
export type ServiceAvailabilityWindow = Readonly<{ availableFrom: string | null; availableUntil: string | null }>;

export class ServiceCatalogPolicyError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ServiceCatalogPolicyError"; }
}
function requirePolicy(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ServiceCatalogPolicyError(code);
}
function dateOnly(value: string) {
  requirePolicy(/^\d{4}-\d{2}-\d{2}$/.test(value), "INVALID_SERVICE_DATE");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  requirePolicy(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, "INVALID_SERVICE_DATE");
  return value;
}
function reasonRequired(reason: string | undefined) {
  requirePolicy(typeof reason === "string" && reason.trim().length >= 10 && reason.trim().length <= 500, "SERVICE_TRANSITION_REASON_REQUIRED");
}
export function validateAvailabilityWindow(window: ServiceAvailabilityWindow): void {
  const from = window.availableFrom === null ? null : dateOnly(window.availableFrom);
  const until = window.availableUntil === null ? null : dateOnly(window.availableUntil);
  requirePolicy(from === null || until === null || from < until, "INVALID_SERVICE_AVAILABILITY_WINDOW");
}
export function transitionServiceCategory(input: Readonly<{ from: ServiceCategoryStatus; to: ServiceCategoryStatus; reason: string }>): ServiceCategoryStatus {
  requirePolicy(input.from !== "RETIRED", "SERVICE_CATEGORY_RETIRED");
  requirePolicy(input.to !== input.from && (input.to === "RETIRED" || input.to === (input.from === "ACTIVE" ? "INACTIVE" : "ACTIVE")), "INVALID_SERVICE_CATEGORY_TRANSITION");
  reasonRequired(input.reason);
  return input.to;
}
export function transitionServiceOffering(input: Readonly<{ from: ServiceOfferingStatus; to: ServiceOfferingStatus; variantStatuses: readonly ServiceVariantStatus[]; reason: string }>): ServiceOfferingStatus {
  requirePolicy(input.from !== "RETIRED", "SERVICE_OFFERING_RETIRED");
  const allowed = input.from === "DRAFT"
    ? input.to === "ACTIVE" || input.to === "RETIRED"
    : input.to === "RETIRED" || input.to === (input.from === "ACTIVE" ? "INACTIVE" : "ACTIVE");
  requirePolicy(allowed, "INVALID_SERVICE_OFFERING_TRANSITION");
  if (input.to === "ACTIVE") requirePolicy(input.variantStatuses.some(status => status !== "RETIRED"), "SERVICE_VARIANT_REQUIRED");
  reasonRequired(input.reason);
  return input.to;
}
export function transitionServiceVariant(input: Readonly<{ from: ServiceVariantStatus; to: ServiceVariantStatus; offeringStatus: ServiceOfferingStatus; availability: ServiceAvailabilityWindow; reason: string }>): ServiceVariantStatus {
  requirePolicy(input.from !== "RETIRED", "SERVICE_VARIANT_RETIRED");
  const allowed = input.from === "DRAFT"
    ? input.to === "ACTIVE" || input.to === "RETIRED"
    : input.to === "RETIRED" || input.to === (input.from === "ACTIVE" ? "INACTIVE" : "ACTIVE");
  requirePolicy(allowed, "INVALID_SERVICE_VARIANT_TRANSITION");
  if (input.to === "ACTIVE") {
    requirePolicy(input.offeringStatus !== "RETIRED", "SERVICE_OFFERING_RETIRED");
    validateAvailabilityWindow(input.availability);
  }
  reasonRequired(input.reason);
  return input.to;
}
export function validateServiceVariantEdit(input: Readonly<{ everActivated: boolean; previousUnit: ServicePricingUnit; nextUnit: ServicePricingUnit; previousAvailability: ServiceAvailabilityWindow; nextAvailability: ServiceAvailabilityWindow; asOf: string }>): void {
  const asOf = dateOnly(input.asOf);
  validateAvailabilityWindow(input.previousAvailability);
  validateAvailabilityWindow(input.nextAvailability);
  requirePolicy(!input.everActivated || input.previousUnit === input.nextUnit, "SERVICE_PRICING_UNIT_IMMUTABLE");
  const windowAlreadyStarted = input.previousAvailability.availableFrom === null
    ? input.everActivated
    : input.previousAvailability.availableFrom <= asOf;
  if (windowAlreadyStarted) {
    requirePolicy(input.previousAvailability.availableFrom === input.nextAvailability.availableFrom, "SERVICE_AVAILABILITY_START_IMMUTABLE");
    if (input.previousAvailability.availableUntil !== input.nextAvailability.availableUntil) {
      requirePolicy(input.nextAvailability.availableUntil !== null && input.nextAvailability.availableUntil > asOf, "SERVICE_AVAILABILITY_END_NOT_FUTURE");
    }
  }
}
export function isServiceCommerciallyAvailable(input: Readonly<{ offeringStatus: ServiceOfferingStatus; variantStatus: ServiceVariantStatus; availability: ServiceAvailabilityWindow; asOf: string }>): boolean {
  const asOf = dateOnly(input.asOf);
  validateAvailabilityWindow(input.availability);
  return input.offeringStatus === "ACTIVE" && input.variantStatus === "ACTIVE"
    && (input.availability.availableFrom === null || input.availability.availableFrom <= asOf)
    && (input.availability.availableUntil === null || asOf < input.availability.availableUntil);
}
