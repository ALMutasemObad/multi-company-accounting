import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { storageKey } from "./branding";
import { loadLocale, setActiveLocale, type Locale } from "./i18n/core";
import { I18nProvider, useI18n } from "./i18n/react";
import { readLocalStorageItem, writeLocalStorageItem } from "./safe-local-storage";

const key = storageKey("locale");

beforeAll(async () => { await loadLocale("ar"); await loadLocale("en"); });
afterEach(() => { vi.unstubAllGlobals(); setActiveLocale("ar"); });

function installStorage(failure?: "getter" | "getItem" | "setItem", saved = "en") {
  const values = new Map([[key, saved]]);
  const storage = {
    getItem(itemKey: string) {
      if (failure === "getItem") throw new Error("Storage read denied");
      return values.get(itemKey) ?? null;
    },
    setItem(itemKey: string, value: string) {
      if (failure === "setItem") throw new Error("Storage write denied");
      values.set(itemKey, value);
    },
  };
  vi.stubGlobal("window", {
    get localStorage() {
      if (failure === "getter") throw new Error("Storage access denied");
      return storage;
    },
  });
  return values;
}

function LocaleProbe() {
  const { locale, dir, t } = useI18n();
  return <p lang={locale} dir={dir}>{t("language.label")}</p>;
}

const renderLocale = (initialLocale?: Locale) => renderToStaticMarkup(
  <I18nProvider initialLocale={initialLocale}><LocaleProbe /></I18nProvider>,
);

describe("optional local storage preferences", () => {
  it("reads and persists preferences when storage is available", () => {
    const values = installStorage();
    expect(readLocalStorageItem(key)).toBe("en");
    writeLocalStorageItem(key, "ar");
    expect(values.get(key)).toBe("ar");
    expect(readLocalStorageItem("missing")).toBeNull();
  });

  it.each(["getter", "getItem"] as const)("treats a denied %s as an absent preference", failure => {
    installStorage(failure);
    expect(readLocalStorageItem(key)).toBeNull();
  });

  it.each(["getter", "setItem"] as const)("does not throw when %s prevents saving", failure => {
    const values = installStorage(failure);
    expect(() => writeLocalStorageItem(key, "ar")).not.toThrow();
    expect(values.get(key)).toBe("en");
  });

  it("does not require a browser window", () => {
    vi.stubGlobal("window", undefined);
    expect(readLocalStorageItem(key)).toBeNull();
    expect(() => writeLocalStorageItem(key, "en")).not.toThrow();
  });
});

describe("locale rendering with unavailable preference storage", () => {
  it.each(["getter", "getItem"] as const)("renders the existing Arabic default when %s fails", failure => {
    installStorage(failure);
    const markup = renderLocale();
    expect(markup).toContain('lang="ar" dir="rtl"');
    expect(markup).toContain("اللغة");
  });

  it("retains a valid saved locale", () => {
    installStorage();
    expect(renderLocale()).toContain('lang="en" dir="ltr"');
  });

  it("uses the locale already loaded by bootstrap even when storage cannot be read", () => {
    installStorage("getter");
    expect(renderLocale("en")).toContain('lang="en" dir="ltr"');
  });

  it("keeps bootstrap's Arabic fallback when the old preference cannot be overwritten", () => {
    const values = installStorage("setItem");
    writeLocalStorageItem(key, "ar");
    expect(values.get(key)).toBe("en");
    expect(renderLocale("ar")).toContain('lang="ar" dir="rtl"');
  });
});
