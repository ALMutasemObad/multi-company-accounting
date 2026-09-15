import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashierContextPanel } from "./CashierContextPanel";
import { createCashierContextController } from "./cashier-context-controller";
import { cashierContextScopeKey } from "./cashier-context-model";
import { cashierReader, cashierScope, cashierValues } from "./cashier-context-test-fixtures";
import { cashierContextDictionaries } from "./i18n/locales/cashier-context";
import type { NavigationAccess } from "./app-navigation";

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
  it("keeps wizard-embedded context free of duplicate review, draft, refresh, and remember controls", async () => {
    const c = createCashierContextController(cashierReader); c.setScope(cashierScope);
    await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } });
    const text = cashierContextDictionaries.en;
    const html = renderToStaticMarkup(<CashierContextPanel compact controller={c} currentScopeKey={cashierContextScopeKey(cashierScope)} locale="en" onReviewed={() => {}} />);
    expect(html).toContain('type="date"');
    for (const duplicate of [text.review, text.saveDraft, text.refresh, text.remember, text.rememberHelp]) expect(html).not.toContain(duplicate);
  });
  it("locks all actionable controls during an unknown checkout", async () => {
    const c = createCashierContextController(cashierReader); c.setScope(cashierScope);
    await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } }); c.setLock("checkout-unknown");
    const html = renderToStaticMarkup(<CashierContextPanel controller={c} currentScopeKey={cashierContextScopeKey(cashierScope)} locale="en" onReviewed={() => {}} />);
    expect(html).toContain(cashierContextDictionaries.en.locked);
    for (const control of html.match(/<(?:button|input)\b[^>]*>/g) ?? []) expect(control).toContain("disabled");
  });

  it("renders exact readiness causes and only safe authorized setup navigation", async () => {
    const c = createCashierContextController({ ...cashierReader,
      period: async ({ documentDate }) => ({ documentDate, status: "MISSING" }),
    });
    c.setScope(cashierScope); await c.startSale({ documentDate: "2026-08-31", requiresWarehouse: true });
    const setupAccess: NavigationAccess = { hasSelectedCompany: true, platformOperations: false,
      moduleSet: new Set(["POS", "INVENTORY", "TREASURY", "SALES", "CORE_ACCOUNTING"]),
      permissionSet: new Set([...cashierScope.permissions, "warehouses.manage", "cash_bank_accounts.manage",
        "fiscal_periods.view", "fiscal_periods.manage", "inventory_catalog.view", "sales_catalog.view", "sales_catalog.manage"]),
    };
    const html = renderToStaticMarkup(<CashierContextPanel controller={c} currentScopeKey={cashierContextScopeKey(cashierScope)} locale="en"
      onReviewed={() => {}} readiness={{ warehouseId: "empty", cashBankAccountId: "forbidden", paymentMethodId: "timeout", currencyId: "error", catalog: "ready" }}
      setupAccess={setupAccess} onOpenSetupTarget={() => {}} onRetryReadiness={() => {}} />);
    const text = cashierContextDictionaries.en;
    for (const id of ["warehouseId", "period", "cashBankAccountId", "paymentMethodId", "currencyId", "catalog"]) expect(html).toContain(`data-pos-requirement="${id}"`);
    for (const message of [text.missingWarehouse, text.MISSING, text.readinessForbidden, text.readinessTimeout, text.readinessError, text.readinessReady]) expect(html).toContain(message);
    expect(html.match(new RegExp(text.openSetup, "g"))).toHaveLength(2);
    expect(html.replaceAll("&#x27;", "'")).toContain(text.readinessHelp); expect(html).toContain(text.retryReadiness);
  });
});
