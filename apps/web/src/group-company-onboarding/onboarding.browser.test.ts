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
        const content = owner ? React.createElement(React.Fragment, null, React.createElement(LanguageSwitcher), React.createElement(OrganizationOwnerPage, {onSwitchCompany: async () => {}, notify: () => {}})) : React.createElement(registration ? RegistrationPage : CreateGroupCompany, registration ? {onBackToLogin: () => {document.body.dataset.login='true'}} : {organizationId: '1', onCreated: async () => {document.body.dataset.created='true'}, onPendingChange: value => {document.body.dataset.pending=String(value)}});
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
    await page.route("**/api/v1/organizations/1/company-options", route => route.fulfill({ json: { currencies: [{ code: "SAR", nameAr: "ريال" }], timezones: ["UTC"] } }));
    await page.route("**/api/v1/organizations/1/companies", route => route.fulfill({ status: 422, json: { code: "BUSINESS_RULE_VIOLATION" } }));
    await page.goto(`${origin}/__group-company-test`);
    await page.locator('input[name="companyName"]').fill("Preserved company");
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await browserExpect(page.locator('input[name="companyName"]')).toBeEnabled();
    await browserExpect(page.locator('input[name="companyName"]')).toHaveValue("Preserved company");
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
