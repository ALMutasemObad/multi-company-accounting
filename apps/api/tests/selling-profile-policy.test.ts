import { describe, expect, it } from "vitest";
import {
  canonicalSellingPrice, sellingCatalogQuery, sellingProfileReadiness, validRevenueAccount,
} from "../src/sales/selling-profile-policy.js";

describe("Sales-owned selling profile policy", () => {
  it.each([["0", "0.0000"], ["0.1", "0.1000"], ["999999999999999.9999", "999999999999999.9999"]])(
    "keeps %s exact without Number conversion", (input, result) => {
      expect(canonicalSellingPrice(input)).toBe(result);
    },
  );
  it.each(["-1", "1e2", "+1", "1.00001", "1000000000000000", "NaN", "Infinity", "01", ".2", "1.", " 1", "١"])(
    "rejects malformed, overflowing or excess-scale price %s", (value) => {
      expect(() => canonicalSellingPrice(value)).toThrow("INVALID_UNIT_PRICE");
    },
  );
  it("bounds internal pagination and trims search before database access", () => {
    expect(sellingCatalogQuery({ page: 2, pageSize: 24, search: "  milk  " }))
      .toEqual({ page: 2, pageSize: 24, search: "milk" });
    for (const [page, pageSize] of [[0, 24], [1, 101], [10001, 10], [1.1, 10], [1, 0]]) {
      expect(() => sellingCatalogQuery({ page: page!, pageSize: pageSize! })).toThrow("INVALID_PAGINATION");
    }
    expect(() => sellingCatalogQuery({ page: 1, pageSize: 10, search: "x".repeat(101) })).toThrow("INVALID_SEARCH");
    expect(() => sellingCatalogQuery({ page: 1, pageSize: 10, search: "milk\u0000" })).toThrow("INVALID_SEARCH");
  });
  const ready = {
    itemActive: true, unitActive: true, profile: { isActive: true, hasTax: true },
    currencyEnabled: true, revenueAccountValid: true, taxRateValid: true,
  };
  it("does not fabricate defaults for a missing profile", () => {
    expect(sellingProfileReadiness({ ...ready, profile: null })).toBe("PROFILE_MISSING");
    expect(sellingProfileReadiness(ready)).toBeNull();
    expect(sellingProfileReadiness({ ...ready, profile: { isActive: true, hasTax: false }, taxRateValid: false })).toBeNull();
  });
  it.each([
    [{ itemActive: false }, "ITEM_INACTIVE"], [{ unitActive: false }, "UNIT_INACTIVE"],
    [{ profile: { isActive: false, hasTax: true } }, "PROFILE_INACTIVE"],
    [{ currencyEnabled: false }, "CURRENCY_UNAVAILABLE"],
    [{ revenueAccountValid: false }, "REVENUE_ACCOUNT_INVALID"], [{ taxRateValid: false }, "TAX_RATE_INVALID"],
  ] as const)("fails closed for unavailable references %j", (change, reason) => {
    expect(sellingProfileReadiness({ ...ready, ...change })).toBe(reason);
  });
  it("requires an active posting revenue leaf, not merely an existing account", () => {
    const account = { isActive: true, allowsPosting: true, accountClass: "REVENUE", childCount: 0 };
    expect(validRevenueAccount(account)).toBe(true);
    for (const change of [{ isActive: false }, { allowsPosting: false }, { accountClass: "ASSET" }, { childCount: 1 }]) {
      expect(validRevenueAccount({ ...account, ...change })).toBe(false);
    }
    expect(validRevenueAccount(null)).toBe(false);
  });
});
