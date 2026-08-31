import { describe, expect, it } from "vitest";
import { addPosItem, applyPosSellingProfile, blankPosLine } from "./pos-experience-cart";
import { posCatalogPath, type PosCatalogItem } from "./pos-experience-catalog";
const item: PosCatalogItem = { inventoryItemId: "1", code: "I", nameAr: "A", nameEn: null, description: null, isActive: true,
  unitOfMeasure: { id: "1", code: "EA", nameAr: "Each", nameEn: null, decimalPlaces: 0, isActive: true },
  sellingProfile: { id: "1", unitPrice: "0.0000", currencyId: "1", currencyCode: "SAR", revenueAccountId: "4", taxRateId: null, version: 2, isActive: true }, isReady: true, readinessReason: null };
describe("R1 unified catalog/scanner item transform", () => {
  it("uses the same add/increment path and preserves explicit manual fields", () => {
    const input = { id: "1", label: "Item", description: "Item" };
    const first = addPosItem([], input);
    expect(first.status).toBe("appended"); expect(first.lines[0].unitPrice).toBe("");
    const priced = { ...first.lines[0], unitPrice: "3.2500", revenueAccountId: "9" };
    const second = addPosItem([priced], input);
    expect(second.status).toBe("incremented"); expect(second.lines[0]).toMatchObject({ quantity: "2.000000", unitPrice: "3.2500", revenueAccountId: "9" });
    expect(addPosItem(Array.from({ length: 50 }, (_, index) => ({ ...priced, inventoryItemId: String(index + 10) })), input).status).toBe("line-limit");
  });
  it("distinguishes zero/missing/invalid/currency-mismatch and never fabricates defaults", () => {
    const line = blankPosLine();
    expect(applyPosSellingProfile(line, item, "1")).toMatchObject({ unitPrice: "0.0000", revenueAccountId: "4", profileVersion: 2, priceSource: "profile" });
    expect(applyPosSellingProfile(line, { ...item, sellingProfile: null, isReady: false }, "1")).toMatchObject({ unitPrice: "", priceSource: "unavailable" });
    expect(applyPosSellingProfile(line, item, "2")).toMatchObject({ unitPrice: "", priceSource: "currency-mismatch" });
    expect(applyPosSellingProfile(line, { ...item, isReady: false }, "1").unitPrice).toBe("");
  });
  it("bounds/encodes search and never reinterprets leading-zero codes", () => {
    const path = new URL(posCatalogPath(2, "0001 & +"), "http://test.local");
    expect(path.searchParams.get("search")).toBe("0001 & +"); expect(path.searchParams.get("pageSize")).toBe("24");
    expect(new URL(posCatalogPath(1, "x".repeat(500)), "http://test.local").searchParams.get("search")?.length).toBe(100);
    expect(new URL(posCatalogPath(10001, "a\nb"), "http://test.local").searchParams.get("page")).toBe("10000");
    expect(new URL(posCatalogPath(1, "a\nb"), "http://test.local").searchParams.get("search")).toBe("ab");
  });
});
