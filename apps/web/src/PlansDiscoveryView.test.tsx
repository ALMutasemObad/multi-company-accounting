import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./i18n";
import { createTranslator, loadLocale, localeDetails, type Locale } from "./i18n/core";
import { PublicPlansCatalog, PublicPlansPage } from "./PublicPlansPage";
import { PlansDiscoveryFeatures } from "./PlansDiscoveryFeatures";
import { PlansDiscoveryJourney, PlansDiscoveryPlanActions } from "./PlansDiscoveryJourney";
import { discoveryTestCatalog, discoveryTestPlan } from "./PlansDiscovery.test-fixtures";
import { captureSubscriptionPlanPreference, preferredSubscriptionPlan, registrationPlanHref, rememberSubscriptionPlan } from "./public-plans";

const state = vi.hoisted(() => ({ locale: "ar" as Locale }));
// Only context is substituted for direct event-handler unit calls. Rendering
// uses React DOM server and actual dictionaries; this is not a browser test.
vi.mock("./i18n", async (original) => ({
  ...await original<typeof import("./i18n")>(),
  useI18n: () => ({
    t: createTranslator(state.locale), dir: localeDetails[state.locale].dir,
    intlLocale: localeDetails[state.locale].intl,
    formatNumber: (value: number) => value.toLocaleString(localeDetails[state.locale].intl),
  }),
}));
const values = new Map<string, string>();
beforeAll(async () => { for (const locale of ["ar", "en", "ur", "hi"] as const) await loadLocale(locale); });
beforeEach(() => {
  state.locale = "en"; values.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", { localStorage: { getItem: () => state.locale } });
});
afterEach(() => vi.unstubAllGlobals());
const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
const renderCatalog = (props: Partial<Parameters<typeof PublicPlansCatalog>[0]> = {}) => render(<PublicPlansCatalog loading={false} failed={false} catalog={discoveryTestCatalog()} page={1} onPage={() => {}} onRetry={() => {}} {...props} />);

describe("public discovery semantics and localized links", () => {
  it.each(["ar", "en", "ur", "hi"] as const)("renders readable %s direction, landmarks, unique plan labels and a visible feature table", (locale) => {
    state.locale = locale;
    const t = createTranslator(locale);
    const page = render(<PublicPlansPage />);
    expect(page).toContain(`dir="${localeDetails[locale].dir}"`);
    expect(page).toContain('<main>'); expect(page).toContain('href="#plans-catalog"');
    expect(page).toContain('aria-labelledby="plans-journey-title"');
    expect(page).toContain(t("publicPlans.listingScope"));
    expect(page).not.toContain('href="/plans#plans-features-title"'); // no dangling anchor during loading
    const html = renderCatalog();
    expect(html).toContain(`aria-label="${t("publicPlans.choose")} — ${discoveryTestPlan.displayName}"`);
    expect(html).toContain(`aria-label="${t("publicPlans.loginPlan")} — ${discoveryTestPlan.displayName}"`);
    expect(html).toContain('href="/#register?plan=9007199254740993"');
    expect(html).toContain('href="/#login?plan=9007199254740993"');
    expect(html).toContain('id="plans-selection-storage"');
    const features = render(<PlansDiscoveryFeatures catalog={discoveryTestCatalog()} />);
    expect(features).toContain('<caption class="sr-only">'); expect(features).toContain('scope="col"'); expect(features).toContain('scope="row"');
    expect(features).toContain('role="region" tabindex="0"');
    expect(features).toContain('aria-describedby="plans-features-scope plans-features-terms plans-features-help"');
    expect(features).not.toContain('<details'); expect(features).not.toMatch(/publicPlans\.|subscription\./);
    expect(features).toContain(t("publicPlans.featuresScope", { page: 1, count: 1 }));
    expect(features).toContain(t("publicPlans.featureUsers"));
    expect(features).toContain(t("publicPlans.featureIncluded"));
    expect(features).toContain(t("publicPlans.cycle.ANNUAL"));
    expect(preferredSubscriptionPlan()).toBeNull();
  });
  it("shows exact included, optional, absent, zero and unconfigured values without claiming grocery features", () => {
    const other = { ...discoveryTestPlan, id: "2", displayName: "Other", currencyCode: "USD", modules: [
      { code: "POS", displayName: "Test checkout", selectionMode: "OPTIONAL" as const, additionalRecurringFee: "0.0000" },
      { code: "INVENTORY", displayName: "Test stock", selectionMode: "OPTIONAL" as const, additionalRecurringFee: null },
    ] };
    const html = render(<PlansDiscoveryFeatures catalog={discoveryTestCatalog([discoveryTestPlan, other])} />);
    const t = createTranslator("en");
    for (const key of ["platformSubscriptions.includedModule", "platformSubscriptions.optionalModule", "publicPlans.notOffered", "subscription.notConfigured"] as const) expect(html).toContain(t(key));
    expect(html).toContain('<td>0</td>'); expect(html).toMatch(/<bdi>USD\s0<\/bdi>/); expect(html).toContain('<bdi>');
    expect(html).not.toContain('Test purchases');
    expect(renderCatalog()).toContain('123.4567');
    expect(renderCatalog()).toContain('Test offer');
  });
  it("distinguishes loading, read failure and empty listing without phantom plan CTAs", () => {
    const loading = renderCatalog({ loading: true });
    const failed = renderCatalog({ failed: true });
    const empty = renderCatalog({ catalog: discoveryTestCatalog([]) });
    expect(loading).toContain('role="status"'); expect(loading).toContain('aria-hidden="true"');
    expect(failed).toContain('role="alert"'); expect(failed).toContain(createTranslator("en")("common.retry"));
    expect(empty).toContain('No public offers right now'); expect(empty).not.toContain('being prepared');
    expect(empty).toContain('existing subscription'); expect(empty).toContain('href="/#register"');
    for (const html of [loading, failed, empty]) { expect(html).not.toContain('Test offer'); expect(html).not.toContain('?plan='); }
    expect(renderCatalog({ catalog: null })).toContain('role="alert"');
  });
  it("explains a changed later page and the browsing limit without navigating automatically", () => {
    const onPage = vi.fn();
    const empty = renderCatalog({ catalog: discoveryTestCatalog([], 2, 1), page: 2, onPage });
    expect(empty).toContain('Return to first page'); expect(onPage).not.toHaveBeenCalled();
    const last = renderCatalog({ catalog: discoveryTestCatalog([discoveryTestPlan], 1000, 9001), page: 1000, onPage });
    expect(last).toContain('Only the first 1000 public pages');
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
    expect(last).toContain('9001'); expect(onPage).not.toHaveBeenCalled();
  });
  it("never renders stale plan choices under the next page number", () => {
    const html = renderCatalog({ page: 2, catalog: discoveryTestCatalog() });
    expect(html).toContain('role="status"');
    expect(html).toContain(createTranslator("en")("publicPlans.loading"));
    expect(html).not.toContain('Test offer'); expect(html).not.toContain('?plan=');
  });
  it("keeps an explicit missing plan across empty/error/render/paging and general account links", () => {
    rememberSubscriptionPlan("777");
    renderCatalog(); renderCatalog({ failed: true }); renderCatalog({ catalog: discoveryTestCatalog([]) });
    const links = render(<PlansDiscoveryJourney />);
    expect(links).toContain('href="/#subscription"'); expect(links).toContain('href="/#login"');
    expect(links).not.toContain('?plan='); expect(preferredSubscriptionPlan()).toBe("777");
  });
});

describe("integrated explicit plan-link contract", () => {
  const actionLinks = () => {
    const element = PlansDiscoveryPlanActions({ plan: discoveryTestPlan });
    return React.Children.toArray(element.props.children).filter(React.isValidElement) as ReactElement<{ href: string; onClick: () => void }>[];
  };
  it("writes only on an explicit registration or login click, preserving BIGINT text", () => {
    const links = actionLinks();
    expect(preferredSubscriptionPlan()).toBeNull();
    expect(links.map((link) => link.props.href)).toEqual([registrationPlanHref(discoveryTestPlan.id), "/#login?plan=9007199254740993"]);
    links[1]!.props.onClick(); expect(preferredSubscriptionPlan()).toBe(discoveryTestPlan.id);
    rememberSubscriptionPlan("44"); links[0]!.props.onClick(); expect(preferredSubscriptionPlan()).toBe(discoveryTestPlan.id);
  });
  it("round trips the supported registration URL on direct load/reload and preserves it through plain auth switching", async () => {
    const url = new URL(registrationPlanHref(discoveryTestPlan.id), "https://example.invalid");
    captureSubscriptionPlanPreference(url.hash);
    vi.resetModules();
    const reloaded = await import("./public-plans");
    reloaded.captureSubscriptionPlanPreference(url.hash);
    expect(reloaded.preferredSubscriptionPlan()).toBe(discoveryTestPlan.id);
    for (const hash of ["#login", "#register", "#subscription"]) {
      reloaded.captureSubscriptionPlanPreference(hash);
      expect(reloaded.preferredSubscriptionPlan()).toBe(discoveryTestPlan.id);
    }
    // This verifies helper/storage compatibility, not main/App's full auth lifecycle.
  });
  it("keeps the explicit login URL intent when storage is disabled or a link opens without a click", () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} });
    const links = actionLinks();
    expect(() => links[1]!.props.onClick()).not.toThrow();
    expect(preferredSubscriptionPlan()).toBeNull();
    expect(links[1]!.props.href).toBe("/#login?plan=9007199254740993");
    expect(links[0]!.props.href).toBe("/#register?plan=9007199254740993");
    expect(renderCatalog()).toContain('Plan-selection links carry your preference for review');
  });
});
