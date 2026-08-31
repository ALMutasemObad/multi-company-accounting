import { Prisma } from "@prisma/client";

export type SellingProfileErrorReason =
  | "NOT_FOUND" | "PROFILE_EXISTS" | "VERSION_CONFLICT" | "INVALID_UNIT_PRICE"
  | "INVALID_PAGINATION" | "INVALID_SEARCH" | "INVALID_REFERENCE"
  | "ITEM_INACTIVE" | "UNIT_INACTIVE" | "CURRENCY_UNAVAILABLE"
  | "REVENUE_ACCOUNT_INVALID" | "TAX_RATE_INVALID"
  | "IDEMPOTENCY_MISMATCH" | "IDEMPOTENCY_IN_PROGRESS";

export class SellingProfileError extends Error {
  constructor(public readonly reason: SellingProfileErrorReason) { super(reason); }
}

export type SellingProfileReadinessReason =
  | "PROFILE_MISSING" | "PROFILE_INACTIVE" | "ITEM_INACTIVE" | "UNIT_INACTIVE"
  | "CURRENCY_UNAVAILABLE" | "REVENUE_ACCOUNT_INVALID" | "TAX_RATE_INVALID";

// Defaults are not a quote or a new pricing engine. Sales still validates every checkout line.
export function sellingProfileReadiness(input: {
  itemActive: boolean;
  unitActive: boolean;
  profile: { isActive: boolean; hasTax: boolean } | null;
  currencyEnabled: boolean;
  revenueAccountValid: boolean;
  taxRateValid: boolean;
}): SellingProfileReadinessReason | null {
  if (!input.itemActive) return "ITEM_INACTIVE";
  if (!input.unitActive) return "UNIT_INACTIVE";
  if (!input.profile) return "PROFILE_MISSING";
  if (!input.profile.isActive) return "PROFILE_INACTIVE";
  if (!input.currencyEnabled) return "CURRENCY_UNAVAILABLE";
  if (!input.revenueAccountValid) return "REVENUE_ACCOUNT_INVALID";
  if (input.profile.hasTax && !input.taxRateValid) return "TAX_RATE_INVALID";
  return null;
}

export function canonicalSellingPrice(value: string): string {
  // Reject excess scale, exponent notation, signs and numeric coercion at the application boundary.
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/.test(value)) {
    throw new SellingProfileError("INVALID_UNIT_PRICE");
  }
  return new Prisma.Decimal(value).toFixed(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function sellingCatalogQuery(input: {
  page: number; pageSize: number; search?: string | undefined;
}) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000
    || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new SellingProfileError("INVALID_PAGINATION");
  }
  const search = input.search?.trim() ?? "";
  if (search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) {
    throw new SellingProfileError("INVALID_SEARCH");
  }
  return { page: input.page, pageSize: input.pageSize, search };
}

export function validRevenueAccount(account: {
  isActive: boolean; allowsPosting: boolean; accountClass: string; childCount: number;
} | null | undefined) {
  return !!account && account.isActive && account.allowsPosting
    && account.accountClass === "REVENUE" && account.childCount === 0;
}
