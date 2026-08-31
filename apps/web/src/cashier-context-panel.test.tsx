import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashierContextPanel } from "./CashierContextPanel";
import { createCashierContextController } from "./cashier-context-controller";
import { cashierContextScopeKey } from "./cashier-context-model";
import { cashierReader, cashierScope, cashierValues } from "./cashier-context-test-fixtures";
import { cashierContextDictionaries } from "./i18n/locales/cashier-context";

describe("CashierContextPanel static component contract (not browser/device QA)", () => {
  it.each(["ar", "en", "hi", "ur"] as const)("renders sources, server period, safe controls and reference requirement in %s", async (locale) => {
    const c = createCashierContextController(cashierReader); c.setScope(cashierScope);
    await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } });
    const html = renderToStaticMarkup(<CashierContextPanel controller={c} currentScopeKey={cashierContextScopeKey(cashierScope)} locale={locale} onReviewed={() => { throw new Error("must not apply during render"); }} />);
    const text = cashierContextDictionaries[locale];
    expect(html).toContain(`dir="${locale === "ar" || locale === "ur" ? "rtl" : "ltr"}"`);
    expect(html).toContain(text.title); expect(html).toContain("Period from server"); expect(html).toContain(text.server);
    expect(html).toContain(text.referenceRequired); expect(html).toContain(text.noExchangeRate);
    expect(html).toContain('type="date"'); expect(html).not.toContain("<select"); expect(html).not.toContain('type="submit"');
    expect(html.match(/Reference /g)).toHaveLength(4);
    expect(Object.keys(text).sort()).toEqual(Object.keys(cashierContextDictionaries.ar).sort());
    expect(Object.values(text).every((value) => value.trim().length > 0)).toBe(true);
  });
  it("does not render prior-scope names or ids even before the parent synchronizes its controller", async () => {
    const c = createCashierContextController(cashierReader); c.setScope(cashierScope);
    await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } });
    const html = renderToStaticMarkup(<CashierContextPanel controller={c} currentScopeKey={cashierContextScopeKey({ ...cashierScope, userId: "8" })} locale="en" onReviewed={() => {}} />);
    expect(html).not.toContain("Reference"); expect(html).not.toContain("2026-08-31"); expect(html).toContain(cashierContextDictionaries.en.scopeChanged);
  });
  it("locks all actionable controls during an unknown checkout", async () => {
    const c = createCashierContextController(cashierReader); c.setScope(cashierScope);
    await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } }); c.setLock("checkout-unknown");
    const html = renderToStaticMarkup(<CashierContextPanel controller={c} currentScopeKey={cashierContextScopeKey(cashierScope)} locale="en" onReviewed={() => {}} />);
    expect(html).toContain(cashierContextDictionaries.en.locked);
    for (const control of html.match(/<(?:button|input)\b[^>]*>/g) ?? []) expect(control).toContain("disabled");
  });
});
