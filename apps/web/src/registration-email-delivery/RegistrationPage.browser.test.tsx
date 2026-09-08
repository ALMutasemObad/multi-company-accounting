import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { localeManifestPlugin } from "../../vite.config";
import copy from "./copy.json";

const enabled = process.env.RUN_REGISTRATION_EMAIL_BROWSER_TESTS === "true";
const locales = ["ar", "en", "ur", "hi"] as const;

describe.runIf(enabled)("registration email browser journey", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("../..", import.meta.url)),
      cacheDir: fileURLToPath(new URL("../../node_modules/.vite/registration-email-delivery", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 },
      optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime"] },
      esbuild: { jsx: "automatic" },
      plugins: [localeManifestPlugin(), {
        name: "registration-email-test-harness",
        configureServer(vite) {
          vite.middlewares.use("/__registration-email-test", async (request, response, next) => {
            if (request.url?.includes("html-proxy")) { next(); return; }
            response.setHeader("Content-Type", "text/html");
            response.end(await vite.transformIndexHtml("/__registration-email-test", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
              import React from 'react';
              import { createRoot } from 'react-dom/client';
              import { I18nProvider, loadLocale } from '/src/i18n/index.ts';
              import { RegistrationPage } from '/src/RegistrationPage.tsx';
              import '/src/styles.css';
              const locale = new URLSearchParams(location.search).get('locale') || 'en';
              await Promise.all(['ar', 'en', 'ur', 'hi'].map(loadLocale));
              createRoot(document.getElementById('root')).render(React.createElement(I18nProvider, {initialLocale: locale}, React.createElement(RegistrationPage, {onBackToLogin: () => {document.body.dataset.login = 'true'}})));
            </script></body></html>`));
          });
        },
      }],
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing browser test server");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function openRegistration(locale: typeof locales[number], resendFailures = 0) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let resendCalls = 0;
    await page.route("**/api/v1/auth/register/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }],
      locales,
      timezones: ["UTC"],
      chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/register/resend", (route) => {
      resendCalls += 1;
      return resendCalls <= resendFailures
        ? route.fulfill({ status: 503, json: { code: "REGISTRATION_UNAVAILABLE" } })
        : route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } });
    });
    await page.route("**/api/v1/auth/register", (route) => route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } }));
    await page.goto(`${origin}/__registration-email-test?locale=${locale}`);
    for (const [name, value] of Object.entries({
      displayName: "Owner", email: `${locale}@example.test`, password: "long-test-password",
      passwordConfirmation: "long-test-password", organizationName: "Group", companyName: "Company",
    })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('button[type="submit"]').click();
    return { page, resendCalls: () => resendCalls };
  }

  for (const locale of locales) {
    for (const width of [390, 1440]) {
      it(`shows truthful pending delivery copy in ${locale} at ${width}px with the correct direction`, async () => {
        const { page } = await openRegistration(locale);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await browserExpect(page.getByRole("heading", { name: copy[locale].acceptedTitle })).toBeVisible();
        await browserExpect(page.getByText(copy[locale].acceptedDescription)).toBeVisible();
        await browserExpect(page.locator("main")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.close();
      }, 60_000);
    }
  }

  it("keeps failure visible, retries, reports request acceptance, and offers sign-in and recovery", async () => {
    const { page, resendCalls } = await openRegistration("en", 1);
    const resend = page.getByRole("button", { name: "Resend verification link" });
    await resend.click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await browserExpect(resend).toBeEnabled();
    await resend.click();
    await browserExpect(page.getByRole("status")).toHaveText(copy.en.resendAccepted);
    expect(resendCalls()).toBe(2);
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await browserExpect(page.locator("body")).toHaveAttribute("data-login", "true");
    await page.getByRole("link", { name: "Reset your existing account password" }).click();
    await browserExpect(page.getByRole("heading", { name: "Forgot your password" })).toBeVisible();
    await page.close();
  }, 60_000);

  it("guards registration and resend against duplicate clicks", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let registrationCalls = 0;
    let resendCalls = 0;
    await page.route("**/api/v1/auth/register/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }], locales,
      timezones: ["UTC"], chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/register/resend", async (route) => {
      resendCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } });
    });
    await page.route("**/api/v1/auth/register", async (route) => {
      registrationCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } });
    });
    await page.goto(`${origin}/__registration-email-test?locale=en`);
    for (const [name, value] of Object.entries({
      displayName: "Owner", email: "duplicate@example.test", password: "long-test-password",
      passwordConfirmation: "long-test-password", organizationName: "Group", companyName: "Company",
    })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('button[type="submit"]').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await browserExpect(page.getByRole("heading", { name: copy.en.acceptedTitle })).toBeVisible();
    expect(registrationCalls).toBe(1);

    const resend = page.getByRole("button", { name: "Resend verification link" });
    await resend.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await browserExpect(page.getByRole("status")).toHaveText(copy.en.resendAccepted);
    expect(resendCalls).toBe(1);
    await page.close();
  }, 60_000);

  it("preserves every registration input after a definitive server failure", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const values = {
      displayName: "Persistent Owner", email: "preserved@example.test", password: "long-test-password",
      passwordConfirmation: "long-test-password", organizationName: "Persistent Group", companyName: "Persistent Company",
    };
    await page.route("**/api/v1/auth/register/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }], locales,
      timezones: ["UTC"], chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/register", (route) => route.fulfill({ status: 503, json: { code: "REGISTRATION_UNAVAILABLE" } }));
    await page.goto(`${origin}/__registration-email-test?locale=en`);
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('button[type="submit"]').click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    for (const [name, value] of Object.entries(values)) await browserExpect(page.locator(`[name="${name}"]`)).toHaveValue(value);
    await page.close();
  }, 60_000);

  it("preserves every registration input when the request times out", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.install();
    const values = {
      displayName: "Timeout Owner", email: "timeout@example.test", password: "long-test-password",
      passwordConfirmation: "long-test-password", organizationName: "Timeout Group", companyName: "Timeout Company",
    };
    await page.route("**/api/v1/auth/register/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }], locales,
      timezones: ["UTC"], chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/register", () => { /* Deliberately leave the fetch pending. */ });
    await page.goto(`${origin}/__registration-email-test?locale=en`);
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('button[type="submit"]').click();
    await page.clock.fastForward(15_100);
    await browserExpect(page.getByRole("alert")).toBeVisible();
    for (const [name, value] of Object.entries(values)) await browserExpect(page.locator(`[name="${name}"]`)).toHaveValue(value);
    await page.close();
  }, 60_000);
});
