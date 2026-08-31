import { describe, expect, it } from "vitest";
import { openApiRequestBodySchemas as bodies, parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";

describe("selling profile executable contract", () => {
  it("keeps money textual and converts IDs exactly, refusing server-owned fields", () => {
    const input = { unitPrice: "0", currencyId: "9007199254740993", revenueAccountId: "4", taxRateId: null };
    expect(bodies.createItemSellingProfile.parse(input)).toEqual({ ...input, currencyId: 9007199254740993n, revenueAccountId: 4n });
    for (const change of [{ companyId: "4" }, { code: "PRICE-1" }, { unitPrice: 2 }, { unitPrice: "1.00001" }, { isActive: true }]) {
      expect(bodies.createItemSellingProfile.safeParse({ ...input, ...change }).success).toBe(false);
    }
  });
  it("requires a version and at least one actual update", () => {
    expect(bodies.updateItemSellingProfile.safeParse({ version: 1 }).success).toBe(false);
    expect(bodies.updateItemSellingProfile.safeParse({ isActive: false }).success).toBe(false);
    expect(bodies.updateItemSellingProfile.parse({ version: 1, isActive: false })).toEqual({ version: 1, isActive: false });
  });
  it("requires explicit readiness without disclosing raw Inventory/Tax records", () => {
    const data = { inventoryItemId: "1", code: "ITM-1", nameAr: "صنف", nameEn: null, description: null, isActive: true,
      unitOfMeasure: { id: "2", code: "EA", nameAr: "حبة", nameEn: null, decimalPlaces: 0, isActive: true },
      sellingProfile: null, isReady: false, readinessReason: "PROFILE_MISSING" };
    expect(parseOpenApiResponseBody("getSellingCatalogItem", 200, { data })).toEqual({ data });
    expect(() => parseOpenApiResponseBody("getSellingCatalogItem", 200, { data: { ...data, barcode: "0012" } })).toThrow();
    expect(() => parseOpenApiResponseBody("getSellingCatalogItem", 200, { data: { ...data, readinessReason: "STOCK_READY" } })).toThrow();
  });
});
