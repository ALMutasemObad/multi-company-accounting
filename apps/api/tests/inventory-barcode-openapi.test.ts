import { describe, expect, it } from "vitest";
import {
  openApiRequestBodySchemas,
  parseOpenApiResponseBody,
} from "../src/generated/openapi-request-guards.js";

const resolved = {
  barcode: { id: "31", symbology: "EAN_13", isPrimary: true },
  inventoryItem: {
    id: "11",
    code: "ITM-000011",
    nameAr: "صنف",
    nameEn: null,
    description: null,
    unitOfMeasure: { id: "21", code: "EA", nameAr: "حبة", decimalPlaces: 0 },
  },
};

describe("inventory barcode executable OpenAPI contract", () => {
  it("preserves exact string values and rejects server-owned fields", () => {
    expect(openApiRequestBodySchemas.createInventoryItemBarcode.parse({
      symbology: "EAN_13",
      value: "0012345678905",
      isPrimary: true,
    })).toEqual({ symbology: "EAN_13", value: "0012345678905", isPrimary: true });
    expect(openApiRequestBodySchemas.createInventoryItemBarcode.safeParse({
      symbology: "EAN_13",
      value: "0012345678905",
      normalizedValue: "00012345678905",
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createInventoryItemBarcode.safeParse({
      symbology: "GS1_128",
      value: "ABC",
    }).success).toBe(false);
  });

  it("requires an actual update in addition to the optimistic version", () => {
    expect(openApiRequestBodySchemas.updateInventoryItemBarcode.safeParse({ version: 1 }).success)
      .toBe(false);
    expect(openApiRequestBodySchemas.updateInventoryItemBarcode.parse({
      version: 1,
      value: "SKU-02",
    })).toEqual({ version: 1, value: "SKU-02" });
  });

  it("bounds resolve batches to 100 exact string entries", () => {
    expect(openApiRequestBodySchemas.resolveInventoryBarcodeBatch.safeParse({ entries: [] }).success)
      .toBe(false);
    expect(openApiRequestBodySchemas.resolveInventoryBarcodeBatch.safeParse({
      entries: Array.from({ length: 101 }, () => ({ value: "ABC" })),
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.resolveInventoryBarcodeBatch.parse({
      entries: [{ value: "00000123", clientReference: "row-1" }],
    })).toEqual({ entries: [{ value: "00000123", clientReference: "row-1" }] });
  });

  it("accepts the limited resolve response and rejects raw internal identity fields", () => {
    expect(parseOpenApiResponseBody("resolveInventoryBarcode", 200, resolved)).toEqual(resolved);
    expect(() => parseOpenApiResponseBody("resolveInventoryBarcode", 200, {
      ...resolved,
      value: "0012345678905",
      normalizedValue: "00012345678905",
    })).toThrow();
    expect(parseOpenApiResponseBody("resolveInventoryBarcodeBatch", 200, {
      data: [
        { index: 0, status: "RESOLVED", clientReference: "row-1", data: resolved },
        { index: 1, status: "UNRESOLVED", reason: "BARCODE_NOT_FOUND" },
      ],
    })).toBeDefined();
  });
});
