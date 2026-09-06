import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import copy from "../registration-email-delivery/copy.json";

const enabled = process.env.RUN_ACCOUNT_ACCESS_BROWSER_TESTS === "true";

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
  }, 60_000);

  it("falls back safely from social onboarding to the ordinary privacy-preserving registration flow", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let submittedBody: Record<string, unknown> | undefined;
    await page.route("**/api/v1/auth/register/options", (route) => route.fulfill({ json: {
      currencies: [{ code: "SAR", nameAr: "ريال", decimals: 2 }],
      locales: ["ar", "en", "ur", "hi"],
      timezones: ["UTC"],
      chartTemplates: [{ code: "SMALL_BUSINESS_GENERAL", nameAr: "عام", nameEn: "General" }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    } }));
    await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "browser-test" } }));
    await page.route("**/api/v1/auth/register", async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 202, json: { status: "PENDING_VERIFICATION" } });
    });

    await page.goto(`${origin}/?social=onboarding_required`);
    await useEnglish(page);
    await browserExpect(page.getByRole("heading", { name: "Create your account and company" })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("social")).toBe(false);
    expect(await page.locator('[name="provider"], [name="issuer"], [name="subject"]').count()).toBe(0);

    for (const [name, value] of Object.entries({
      displayName: "Owner",
      email: "new-owner@example.test",
      password: "long-test-password",
      passwordConfirmation: "long-test-password",
      organizationName: "Group",
      companyName: "Company",
    })) await page.locator(`[name="${name}"]`).fill(value);
    await page.getByRole("button", { name: "Send verification link" }).click();

    await browserExpect(page.getByRole("heading", { name: copy.en.acceptedTitle })).toBeVisible();
    await browserExpect(page.getByText(copy.en.acceptedDescription)).toBeVisible();
    expect(submittedBody).toBeDefined();
    expect(submittedBody).not.toHaveProperty("provider");
    expect(submittedBody).not.toHaveProperty("issuer");
    expect(submittedBody).not.toHaveProperty("subject");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  }, 60_000);
});
