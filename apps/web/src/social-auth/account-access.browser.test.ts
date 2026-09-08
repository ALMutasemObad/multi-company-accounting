import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

const enabled = process.env.RUN_ACCOUNT_ACCESS_BROWSER_TESTS === "true";
const localeTitles = {
  ar: "تسجيل الدخول",
  en: "Sign in",
  ur: "سائن ان کریں",
  hi: "साइन इन करें",
} as const;

describe.runIf(enabled)("account access browser integration", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("../..", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 },
      optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime"] },
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

  async function useEnglish(page: Page) {
    await page.locator(".auth-language select").selectOption("en");
  }

  async function routeUnauthenticatedShell(page: Page) {
    for (const endpoint of ["auth/companies", "auth/me", "platform/capabilities", "organizations/workspaces"]) {
      await page.route(`**/api/v1/${endpoint}`, (route) => route.fulfill({
        status: 401,
        json: { code: "AUTHENTICATION_REQUIRED" },
      }));
    }
  }

  it("keeps social providers hidden by default and shows only configured providers", async () => {
    const disabled = await browser.newPage();
    await routeUnauthenticatedShell(disabled);
    await disabled.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ json: { google: false, apple: false } }));
    await disabled.goto(`${origin}/#login`);
    await useEnglish(disabled);
    await browserExpect(disabled.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await browserExpect(disabled.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await browserExpect(disabled.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await disabled.close();

    const configured = await browser.newPage();
    await routeUnauthenticatedShell(configured);
    await configured.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ json: { google: true, apple: false } }));
    await configured.goto(`${origin}/#login`);
    await useEnglish(configured);
    await browserExpect(configured.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await browserExpect(configured.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await configured.close();

    const appleOnly = await browser.newPage();
    await routeUnauthenticatedShell(appleOnly);
    await appleOnly.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ json: { google: false, apple: true } }));
    await appleOnly.goto(`${origin}/#login`);
    await useEnglish(appleOnly);
    await browserExpect(appleOnly.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await browserExpect(appleOnly.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
    await appleOnly.close();

    const unavailable = await browser.newPage();
    await routeUnauthenticatedShell(unavailable);
    await unavailable.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } }));
    await unavailable.goto(`${origin}/#login`);
    await useEnglish(unavailable);
    await browserExpect(unavailable.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await browserExpect(unavailable.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
    await unavailable.close();
  }, 60_000);

  for (const [locale, title] of Object.entries(localeTitles)) {
    for (const width of [390, 1440]) {
      it(`renders the ${locale} sign-in entry safely at ${width}px`, async () => {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
        await routeUnauthenticatedShell(page);
        await page.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ json: { google: false, apple: false } }));
        await page.goto(`${origin}/#login`);
        await page.locator(".auth-language select").selectOption(locale);
        await browserExpect(page.getByRole("heading", { name: title })).toBeVisible();
        await browserExpect(page.locator("main")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.close();
      }, 60_000);
    }
  }

  it("completes social onboarding without exposing or collecting identity claims or a password", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let submittedBody: Record<string, unknown> | undefined;
    await routeUnauthenticatedShell(page);
    await page.route("**/api/v1/auth/social/providers", (route) => route.fulfill({ json: { google: true, apple: true } }));
    await page.route("**/api/v1/auth/social/onboarding/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }],
      locales: ["ar", "en", "ur", "hi"],
      timezones: ["UTC"],
      chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/social/onboarding", async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: {
        status: "COMPLETED",
        user: { id: "77", displayName: "Owner" },
        companyId: "88",
        csrfToken: "rotated-csrf",
      } });
    });

    await page.goto(`${origin}/?social=onboarding_required`);
    await useEnglish(page);
    await browserExpect(page.getByRole("heading", { name: "Finish creating your workspace" }).first()).toBeVisible();
    expect(new URL(page.url()).searchParams.has("social")).toBe(false);
    expect(await page.locator('[name="provider"], [name="issuer"], [name="subject"], [name="email"], [name="password"]').count()).toBe(0);

    for (const [name, value] of Object.entries({
      displayName: "Owner",
      organizationName: "Group",
      companyName: "Company",
    })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('[name="consent"]').check();
    await page.getByRole("button", { name: "Create account and workspace" }).click();

    await browserExpect.poll(() => submittedBody).toBeDefined();
    expect(submittedBody).toBeDefined();
    for (const forbidden of ["provider", "issuer", "subject", "email", "password", "passwordConfirmation", "accessToken", "refreshToken"]) {
      expect(submittedBody).not.toHaveProperty(forbidden);
    }
    expect(submittedBody).toMatchObject({
      displayName: "Owner",
      organizationName: "Group",
      companyName: "Company",
      baseCurrencyCode: "SAR",
      timezone: "UTC",
      chartTemplateCode: "SMALL_BUSINESS_GENERAL",
      consent: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  }, 60_000);
});
