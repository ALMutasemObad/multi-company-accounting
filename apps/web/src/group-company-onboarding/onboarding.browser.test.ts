import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Real React and Chromium; only HTTP responses are simulated in these UI tests.
describe.runIf(process.env.RUN_GROUP_ONBOARDING_BROWSER_TESTS === "true")("group onboarding browser behavior", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let origin: string;
  beforeAll(async () => {
    server = await createServer({ configFile: false, root: process.cwd(), server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime"] }, esbuild: { jsx: "automatic" }, plugins: [{ name: "onboarding-test-harness", configureServer(vite) {
    vite.middlewares.use("/__group-company-test", async (request, response, next) => {
      // Vite serves the transformed inline module through its html-proxy middleware.
      if (request.url?.includes("html-proxy")) { next(); return; }
      response.setHeader("Content-Type", "text/html");
      response.end(await vite.transformIndexHtml("/__group-company-test", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { I18nProvider, LanguageSwitcher, loadLocale } from '/src/i18n/index.ts';
        import { CreateGroupCompany } from '/src/group-company-onboarding/CreateGroupCompany.tsx';
        import { RegistrationPage } from '/src/RegistrationPage.tsx';
        import { OrganizationOwnerPage } from '/src/OrganizationOwnerPage.tsx';
        import '/src/styles.css';
        import '@fontsource/cairo/400.css';
        import '/src/organization-owner.css';
        await loadLocale('ar');
        const registration = location.search.includes('registration');
        const owner = location.search.includes('owner');
        const content = owner ? React.createElement(React.Fragment, null, React.createElement(LanguageSwitcher), React.createElement(OrganizationOwnerPage, {onSwitchCompany: async () => {document.body.dataset.switched='true'}, notify: () => {}})) : React.createElement(registration ? RegistrationPage : CreateGroupCompany, registration ? {onBackToLogin: () => {document.body.dataset.login='true'}} : {organizationId: '1', onCreated: async result => {document.body.dataset.created='true'; if (location.search.includes('refresh-fail')) throw new Error('refresh failed'); return { ...result.company, isActive: true, canSwitch: true, metricAccess: {activeUsers: true, postedDocuments: true, postedSales: true, postedPurchases: true}, activeUsers: 1, postedDocuments: 0, postedSalesBase: '0', postedPurchasesBase: '0' }}, onOpenCreated: async () => {document.body.dataset.switched='true'}, onPendingChange: value => {document.body.dataset.pending=String(value)}});
        createRoot(document.getElementById('root')).render(React.createElement(I18nProvider, { initialLocale: 'ar' }, content));
      </script></body></html>`));
    });
    } }] });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing browser test server");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => { await browser?.close(); await server?.close(); });

  it("retains the exact request and key after uncertain failure, prevents double submit, then shows success", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const calls: Array<{ key: string | undefined; body: string | null }> = [];
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }));
    await page.route("**/api/v1/organizations/1/companies", async route => {
      calls.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      if (calls.length === 1) await route.fulfill({ status: 503, json: { code: "COMPANY_SETUP_UNAVAILABLE" } });
      else await route.fulfill({ status: 201, json: { organizationId: "1", company: { id: "2", code: "generated", name: "شركة جديدة", timezone: "UTC", baseCurrencyCode: "SAR" } } });
    });
    await page.goto(`${origin}/__group-company-test`);
    await page.locator('input[name="companyName"]').fill("شركة جديدة");
    if (process.env.GROUP_ONBOARDING_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.GROUP_ONBOARDING_ARTIFACT_DIR}/company-create-390.png`, fullPage: true });
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await browserExpect(page.locator('input[name="companyName"]')).toBeDisabled();
    await browserExpect(page.locator("body")).toHaveAttribute("data-pending", "true");
    await page.locator('button[type="submit"]').dblclick();
    await browserExpect(page.locator("body")).toHaveAttribute("data-created", "true");
    await browserExpect(page.getByText("تم إنشاء شركة شركة جديدة.")).toBeVisible();
    expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  }, 60_000);

  it("allows correction after confirmed validation rejection while preserving fields", async () => {
    const page = await browser.newPage();
    const keys: Array<string | undefined> = [];
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }, { code: "USD", nameAr: "دولار" }], timezones: ["UTC", "Asia/Riyadh"] } }));
    await page.route("**/api/v1/organizations/1/companies", route => { keys.push(route.request().headers()["idempotency-key"]); return route.fulfill({ status: 422, json: { code: "BUSINESS_RULE_VIOLATION" } }); });
    await page.goto(`${origin}/__group-company-test`);
    await page.locator('input[name="companyName"]').fill("Preserved company");
    await page.locator('select[name="timezone"]').selectOption("Asia/Riyadh");
    await page.locator('select[name="baseCurrencyCode"]').selectOption("USD");
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await browserExpect(page.locator('input[name="companyName"]')).toBeEnabled();
    await browserExpect(page.locator('input[name="companyName"]')).toHaveValue("Preserved company");
    await browserExpect(page.locator('select[name="timezone"]')).toHaveValue("Asia/Riyadh");
    await browserExpect(page.locator('select[name="baseCurrencyCode"]')).toHaveValue("USD");
    await page.locator('button[type="submit"]').click();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    await page.close();
  }, 60_000);

  it("keeps a confirmed create after refresh failure and never repeats the POST", async () => {
    const page = await browser.newPage();
    let posts = 0;
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }));
    await page.route("**/api/v1/organizations/1/companies", route => { posts += 1; return route.fulfill({ status: 201, json: { organizationId: "1", company: { id: "2", code: "generated", name: "شركة مؤكدة", timezone: "UTC", baseCurrencyCode: "SAR" } } }); });
    await page.goto(`${origin}/__group-company-test?refresh-fail`);
    await page.locator('input[name="companyName"]').fill("شركة مؤكدة");
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByText("تم إنشاء شركة شركة مؤكدة.")).toBeVisible();
    await browserExpect(page.getByText(/تم إنشاء الشركة، لكن تعذر تحديث القائمة/)).toBeVisible();
    await page.getByRole("button", { name: "تحديث قائمة الشركات" }).click();
    await browserExpect(page.getByText(/تم إنشاء الشركة، لكن تعذر تحديث القائمة/)).toBeVisible();
    expect(posts).toBe(1);
    await page.close();
  }, 60_000);

  it("discovers creation from the owner header and opens the confirmed company after refresh", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let dashboards = 0;
    let posts = 0;
    await page.route("**/api/v1/organizations/workspaces", route => route.fulfill({ json: { data: [{ id: "1", code: "GROUP", name: "Group", role: "OWNER" }] } }));
    await page.route("**/api/v1/organizations/1/dashboard?*", route => {
      dashboards += 1;
      const companies = dashboards > 1 ? [{ id: "2", code: "generated", name: "شركة جاهزة", timezone: "UTC", baseCurrencyCode: "SAR", isActive: true, canSwitch: true, metricAccess: { activeUsers: true, postedDocuments: true, postedSales: true, postedPurchases: true }, activeUsers: 1, postedDocuments: 0, postedSalesBase: "0", postedPurchasesBase: "0" }] : [];
      return route.fulfill({ json: { generatedAt: "2026-09-08T00:00:00Z", period: { days: 30, from: "2026-08-01", to: "2026-09-01" }, organization: { id: "1", code: "GROUP", name: "Group", role: "OWNER", memberCount: 1, canManageMembers: true, canManageOwners: true }, companies, boundaries: { companyAccessRequired: true, companyPermissionsRequired: true, subscriptionEntitlementRequired: true, aggregation: "NONE", currencyConversion: "NONE" } } });
    });
    await page.route("**/api/v1/organizations/1/members", route => route.fulfill({ json: { data: [] } }));
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }));
    await page.route("**/api/v1/organizations/1/companies", route => { posts += 1; return route.fulfill({ status: 201, json: { organizationId: "1", company: { id: "2", code: "generated", name: "شركة جاهزة", timezone: "UTC", baseCurrencyCode: "SAR" } } }); });
    await page.goto(`${origin}/__group-company-test?owner`);
    await page.getByRole("button", { name: "إنشاء شركة أخرى" }).click();
    await browserExpect(page.locator('input[name="companyName"]')).toBeFocused();
    await page.locator('input[name="companyName"]').fill("شركة جاهزة");
    await page.locator('.group-company-create button[type="submit"]').click();
    await page.locator("#group-company-create").getByRole("button", { name: "فتح الشركة" }).click();
    await browserExpect(page.locator("body")).toHaveAttribute("data-switched", "true");
    expect(posts).toBe(1);
    await page.close();
  }, 60_000);

  it("ignores late options and dashboard responses after the organization changes", async () => {
    const page = await browser.newPage();
    let releaseOldOptions!: () => void;
    let releaseOldDashboard!: () => void;
    const oldOptionsReady = new Promise<void>(resolve => { releaseOldOptions = resolve; });
    const oldDashboardReady = new Promise<void>(resolve => { releaseOldDashboard = resolve; });
    await page.route("**/api/v1/organizations/workspaces", route => route.fulfill({ json: { data: [
      { id: "1", code: "OLD", name: "Old group", role: "OWNER" },
      { id: "2", code: "NEW", name: "New group", role: "OWNER" },
    ] } }));
    await page.route("**/api/v1/organizations/1/company-options", async route => { await oldOptionsReady; await route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }); });
    await page.route("**/api/v1/organizations/1/dashboard?*", async route => { await oldDashboardReady; await route.fulfill({ json: { generatedAt: "2026-09-08T00:00:00Z", period: { days: 30, from: "2026-08-01", to: "2026-09-01" }, organization: { id: "1", code: "OLD", name: "Old group", role: "OWNER", memberCount: 1, canManageMembers: false, canManageOwners: true }, companies: [], boundaries: {} } }); });
    await page.route("**/api/v1/organizations/2/company-options", route => route.fulfill({ json: { currencies: [{ code: "USD", nameAr: "دولار" }], timezones: ["America/New_York"] } }));
    await page.route("**/api/v1/organizations/2/dashboard?*", route => route.fulfill({ json: { generatedAt: "2026-09-08T00:00:00Z", period: { days: 30, from: "2026-08-01", to: "2026-09-01" }, organization: { id: "2", code: "NEW", name: "New group", role: "OWNER", memberCount: 1, canManageMembers: false, canManageOwners: true }, companies: [], boundaries: {} } }));
    await page.goto(`${origin}/__group-company-test?owner`);
    await page.locator(".organization-filters select").first().selectOption("2");
    await browserExpect(page.locator('select[name="baseCurrencyCode"]')).toHaveValue("USD");
    await browserExpect(page.locator('select[name="timezone"]')).toHaveValue("America/New_York");
    releaseOldOptions();
    releaseOldDashboard();
    await page.waitForTimeout(50);
    await browserExpect(page.locator(".organization-filters select").first()).toHaveValue("2");
    await browserExpect(page.locator('select[name="baseCurrencyCode"]')).toHaveValue("USD");
    await browserExpect(page.locator('select[name="timezone"]')).toHaveValue("America/New_York");
    await page.close();
  }, 60_000);

  it("keeps an uncertain attempt through a real owner dashboard locale reload", async () => {
    const page = await browser.newPage();
    const calls: Array<string | undefined> = [];
    await page.route("**/api/v1/organizations/workspaces", route => route.fulfill({ json: { data: [{ id: "1", code: "GROUP", name: "Group", role: "OWNER" }] } }));
    await page.route("**/api/v1/organizations/1/dashboard?*", route => route.fulfill({ json: { period: { from: "2026-08-01", to: "2026-09-01" }, organization: { id: "1", role: "OWNER", memberCount: 1, canManageMembers: true, canManageOwners: true }, companies: [] } }));
    await page.route("**/api/v1/organizations/1/members", route => route.fulfill({ json: { data: [] } }));
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }));
    await page.route("**/api/v1/organizations/1/companies", route => {
      calls.push(route.request().headers()["idempotency-key"]);
      return route.fulfill({ status: 503, json: { code: "COMPANY_SETUP_UNAVAILABLE" } });
    });
    await page.goto(`${origin}/__group-company-test?owner`);
    await page.locator('input[name="companyName"]').fill("Same attempt");
    await page.locator('.group-company-create button[type="submit"]').click();
    await browserExpect(page.locator(".group-company-create [role=alert]")).toBeVisible();
    await browserExpect(page.locator(".organization-filters select").first()).toBeDisabled();
    await browserExpect(page.locator(".organization-filters select").last()).toBeDisabled();
    await page.locator(".language-switcher select").selectOption("en");
    await browserExpect(page.locator("html")).toHaveAttribute("lang", "en");
    await browserExpect(page.locator('input[name="companyName"]')).toBeDisabled();
    await browserExpect(page.locator('input[name="companyName"]')).toHaveValue("Same attempt");
    await page.locator('.group-company-create button[type="submit"]').click();
    await browserExpect(page.locator(".group-company-create [role=alert]")).toBeVisible();
    expect(calls).toHaveLength(2); expect(calls[0]).toBe(calls[1]);
    await page.close();
  }, 60_000);

  it("shows a generic registration result and routes existing users to sign-in or recovery", async () => {
    const page = await browser.newPage();
    await page.route("**/api/v1/auth/register/options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }], locales: ["ar"], timezones: ["UTC"], chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }], passwordPolicy: { minLength: 12, maxLength: 1024 } } }));
    await page.route("**/api/v1/auth/csrf", route => route.fulfill({ json: { csrfToken: "test" } }));
    await page.route("**/api/v1/auth/register", route => route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } }));
    await page.goto(`${origin}/__group-company-test?registration`);
    for (const [name, value] of Object.entries({ displayName: "Owner", email: "owner@example.test", password: "long-test-password", passwordConfirmation: "long-test-password", organizationName: "Group", companyName: "Company" })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByRole("heading", { name: "تم استلام الطلب" })).toBeVisible();
    await browserExpect(page.getByText(/هذه الرسالة لا تؤكد إرسال بريد/)).toBeVisible();
    await browserExpect(page.getByRole("link", { name: "استعادة كلمة المرور للحساب الحالي" })).toHaveAttribute("href", "#reset-password");
    await page.getByRole("button", { name: "العودة لتسجيل الدخول" }).click();
    await browserExpect(page.locator("body")).toHaveAttribute("data-login", "true");
    await page.getByRole("link", { name: "استعادة كلمة المرور للحساب الحالي" }).click();
    await browserExpect(page.getByRole("heading", { name: "نسيت كلمة المرور" })).toBeVisible();
    await page.close();
  }, 60_000);
});
