import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activeIntlLocale, createTranslator, dictionaryFor, loadLocale, localeDetails, localizedReferenceName, resolveLocale, supportedLocales } from "./index";
import { setActiveLocale } from "./core";

beforeAll(async () => Promise.all(supportedLocales.map(loadLocale)));
afterEach(() => setActiveLocale("ar"));

describe("translation dictionaries", () => {
  it("keeps every locale aligned to the Arabic source keys", () => {
    expect(supportedLocales).toContain("ar");
    expect(supportedLocales).toContain("en");
    expect(supportedLocales).toContain("ur");
    expect(supportedLocales).toContain("hi");
    const sourceKeys = Object.keys(dictionaryFor("ar")).sort();
    for (const locale of supportedLocales) expect(Object.keys(dictionaryFor(locale)).sort()).toEqual(sourceKeys);
  });

  it("keeps interpolation placeholders identical and rejects unfinished catalogue entries", () => {
    const placeholders = (message: string) => [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]).sort();
    const arabic = dictionaryFor("ar");
    for (const key of Object.keys(arabic) as Array<keyof typeof arabic>) {
      for (const locale of supportedLocales) {
        const message = dictionaryFor(locale)[key];
        expect(message.trim(), `${locale}.${key} must not be empty`).not.toBe("");
        expect(message, `${locale}.${key} contains a migration marker`).not.toMatch(/TODO|__MCAP_/u);
        expect(placeholders(message), `${locale}.${key} placeholders`).toEqual(placeholders(arabic[key]));
      }
    }
  });

  it("translates and interpolates values without hiding missing placeholders", () => {
    expect(createTranslator("ar")("settings.pageOf", { page: 2, totalPages: 5 })).toBe("صفحة 2 من 5");
    expect(createTranslator("en")("app.booting", { productName: "Jowar" })).toBe("Preparing Jowar");
    expect(createTranslator("ur")("language.label")).toBe("زبان");
    expect(createTranslator("hi")("language.label")).toBe("भाषा");
    expect(createTranslator("en")("app.booting")).toContain("{productName}");
  });

  it("uses the correct direction and Latin digits for every Intl locale", () => {
    expect(localeDetails.ur).toMatchObject({ dir: "rtl", intl: "ur-PK-u-nu-latn" });
    expect(localeDetails.hi).toMatchObject({ dir: "ltr", intl: "hi-IN-u-nu-latn" });
    for (const locale of supportedLocales) {
      setActiveLocale(locale);
      expect(new Intl.NumberFormat(activeIntlLocale()).format(1234567890)).not.toMatch(/[٠-٩۰-۹०-९]/u);
    }
  });

  it("preserves Arabic as the safe default for unknown or empty locale values", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ur")).toBe("ur");
    expect(resolveLocale("hi")).toBe("hi");
    expect(resolveLocale("unknown-locale")).toBe("ar");
    expect(resolveLocale(null)).toBe("ar");
  });

  it("uses localized reference names and falls back safely when English is unavailable", () => {
    setActiveLocale("en");
    expect(localizedReferenceName({ nameAr: "ريال يمني", nameEn: "Legacy English", names: { en: "Yemeni rial" } })).toBe("Yemeni rial");
    expect(localizedReferenceName({ nameAr: "ريال يمني", nameEn: "Yemeni rial" })).toBe("Yemeni rial");
    expect(localizedReferenceName({ nameAr: "عملة مخصصة" })).toBe("عملة مخصصة");
    setActiveLocale("ar");
    expect(localizedReferenceName({ nameAr: "ريال يمني", nameEn: "Yemeni rial" })).toBe("ريال يمني");
  });
});
