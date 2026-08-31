import { describe, expect, it } from "vitest";
import { initialSellingProfileFields, sellingProfileSaveCommand } from "./selling-profile-editor-model";
import { sellingProfileDictionaries } from "./i18n/locales/selling-profile";

const refs = { currencies: [{ id: "2", label: "SAR", isAvailable: true }],
  accounts: [{ id: "3", label: "Revenue", isAvailable: true }], taxes: [] };
const profile = { id: "7", unitPrice: "0.0000", currencyId: "2", currencyCode: "SAR", revenueAccountId: "3",
  taxRateId: null, isActive: true, version: 4 };

describe("selling profile editor draft", () => {
  it("never manufactures price, currency or account for a new item", () => {
    const blank = initialSellingProfileFields(null);
    expect(blank.unitPrice).toBe(""); expect(blank.currencyId).toBe(""); expect(blank.revenueAccountId).toBe("");
    expect(sellingProfileSaveCommand("1", null, blank, refs)).toBeNull();
  });
  it("preserves zero and a maximum decimal as exact strings", () => {
    for (const price of ["0", "999999999999999.9999"]) {
      const result = sellingProfileSaveCommand("1", null, { ...initialSellingProfileFields(profile), unitPrice: price }, refs);
      expect(result?.body.unitPrice).toBe(price === "0" ? "0.0000" : price);
    }
  });
  it("requires present, available current currency and revenue references", () => {
    expect(sellingProfileSaveCommand("1", profile, initialSellingProfileFields(profile), { ...refs, currencies: [] })).toBeNull();
    expect(sellingProfileSaveCommand("1", profile, initialSellingProfileFields(profile), { ...refs, accounts: [{ ...refs.accounts[0]!, isAvailable: false }] })).toBeNull();
  });
  it("allows explicit disabling without replacing unavailable references", () => {
    const result = sellingProfileSaveCommand("1", profile, { ...initialSellingProfileFields(profile), isActive: false },
      { currencies: [], accounts: [], taxes: [] });
    expect(result).toMatchObject({ kind: "update", body: { version: 4, currencyId: "2", revenueAccountId: "3", isActive: false } });
  });
  it("requires valid explicit tax selection and rejects exponent/excess scale", () => {
    const fields = initialSellingProfileFields(profile);
    expect(sellingProfileSaveCommand("1", profile, { ...fields, taxRateId: "9" }, refs)).toBeNull();
    for (const price of ["", "-1", "1e2", "1.00001", "NaN"]) {
      expect(sellingProfileSaveCommand("1", profile, { ...fields, unitPrice: price }, refs)).toBeNull();
    }
  });
  it("has matching Arabic, English, Hindi and Urdu dictionary keys", () => {
    for (const dictionary of Object.values(sellingProfileDictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(sellingProfileDictionaries.ar).sort());
      expect(Object.values(dictionary).every(text => text.trim())).toBe(true);
    }
  });
});
