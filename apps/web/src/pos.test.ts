import { describe, expect, it } from "vitest";
import { allows } from "./authorization";
import { isNavigationItemVisible, navigationItems, posPermissionPolicies, type NavigationAccess } from "./app-navigation";
import { normalizePosRate, reapplyPosProfilesForCurrency } from "./PosPage";
import type { PosDraftLine } from "./pos-experience-cart";
import type { PosCatalogItem } from "./pos-experience-catalog";

describe("واجهة نقاط البيع", () => {
  it("ترسل سعر الصرف بدقة العقد ذات الثماني منازل", () => {
    expect(normalizePosRate("1")).toBe("1.00000000");
    expect(normalizePosRate("3.75")).toBe("3.75000000");
    expect(normalizePosRate("0.12345678")).toBe("0.12345678");
  });

  it("لا تخفي مدخلًا غير صالح بتقريب صامت", () => {
    expect(normalizePosRate("1.123456789")).toBe("1.123456789");
    expect(normalizePosRate("rate")).toBe("rate");
  });

  it("تفصل سجل المبيعات عن تشغيل الصندوق وتسمح بالوصول لأي من القدرتين", () => {
    const item = navigationItems.find((value) => value.view === "pos")!;
    const access = (permissions: string[], posModule = true): NavigationAccess => ({ hasSelectedCompany: true, platformOperations: false,
      moduleSet: new Set(posModule ? ["POS"] : []), permissionSet: new Set(permissions) });
    expect(isNavigationItemVisible(item, access(["pos.view"]))).toBe(true);
    expect(allows(access(["pos.view"]).permissionSet, posPermissionPolicies.history)).toBe(true);
    expect(allows(access(["pos.view"]).permissionSet, posPermissionPolicies.checkout)).toBe(false);
    expect(isNavigationItemVisible(item, access(["pos.checkout"]))).toBe(true);
    expect(allows(access(["pos.checkout"]).permissionSet, posPermissionPolicies.checkout)).toBe(true);
    expect(allows(access(["pos.checkout"]).permissionSet, posPermissionPolicies.history)).toBe(false);
    expect(allows(access(["pos.view", "pos.checkout"]).permissionSet, posPermissionPolicies.checkout)).toBe(true);
    expect(isNavigationItemVisible(item, access(["pos.view", "pos.checkout"], false))).toBe(false);
  });

  it("يعيد سعر ملف البيع ومراجعه عند اعتماد العملة المطابقة بعد إضافة الصنف", () => {
    const line: PosDraftLine = { key: "line-1", inventoryItemId: "1", inventoryItemLabel: "ITM-1", description: "Item",
      quantity: "1.000000", unitPrice: "", discountAmount: "0.0000", revenueAccountId: "", revenueAccountLabel: "",
      taxRateId: "", taxRateLabel: "", priceSource: "currency-mismatch", profileVersion: null, profileCurrencyId: null };
    const item: PosCatalogItem = { inventoryItemId: "1", code: "ITM-1", nameAr: "صنف", nameEn: "Item", description: null, isActive: true,
      unitOfMeasure: { id: "2", code: "EA", nameAr: "وحدة", nameEn: "Each", decimalPlaces: 0, isActive: true },
      sellingProfile: { id: "3", unitPrice: "30.0000", currencyId: "1", currencyCode: "SAR", revenueAccountId: "357", taxRateId: null, isActive: true, version: 4 },
      isReady: true, readinessReason: null };
    const restored = reapplyPosProfilesForCurrency([line], new Map([[line.key, item]]), "1")[0]!;
    expect(restored).toMatchObject({ unitPrice: "30.0000", revenueAccountId: "357", priceSource: "profile", profileCurrencyId: "1", profileVersion: 4 });
    expect(reapplyPosProfilesForCurrency([restored], new Map([[line.key, item]]), "2")[0]).toMatchObject({ unitPrice: "", revenueAccountId: "", priceSource: "currency-mismatch" });
  });
});
