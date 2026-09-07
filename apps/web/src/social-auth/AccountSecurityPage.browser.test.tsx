import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const enabled = process.env.RUN_SOCIAL_ACCOUNT_BROWSER_TESTS === "true";
const locales = ["ar", "en", "ur", "hi"] as const;
const titles = {
  ar: "أمان الحساب ووسائل الدخول",
  en: "Account security and sign-in methods",
  ur: "اکاؤنٹ سیکیورٹی اور لاگ اِن طریقے",
  hi: "खाता सुरक्षा और साइन-इन तरीके",
};

describe.runIf(enabled)("social account security browser journey", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      server: { host: "127.0.0.1", port: 0 },
      optimizeDeps: { entries: [], include: ["react", "react-dom/client", "react/jsx-runtime"] },
      esbuild: { jsx: "automatic" },
      plugins: [{
        name: "social-account-security-test-harness",
        configureServer(vite) {
          vite.middlewares.use("/__social-account-security-test", async (request, response, next) => {
            if (request.url?.includes("html-proxy")) { next(); return; }
            response.setHeader("Content-Type", "text/html");
            response.end(await vite.transformIndexHtml("/__social-account-security-test", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
              import React from 'react';
              import { createRoot } from 'react-dom/client';
              import { I18nProvider, loadLocale } from '/apps/web/src/i18n/index.ts';
              import { AccountSecurityPage } from '/apps/web/src/social-auth/AccountSecurityPage.tsx';
              import '/apps/web/src/styles.css';
              const locale = new URLSearchParams(location.search).get('locale') || 'en';
              await Promise.all(['ar', 'en', 'ur', 'hi'].map(loadLocale));
              createRoot(document.getElementById('root')).render(React.createElement(I18nProvider, {initialLocale: locale}, React.createElement(AccountSecurityPage, {notify: (message, tone) => {document.body.dataset.notice = message; document.body.dataset.tone = tone || 'success'}})));
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

  for (const locale of locales) {
    it(`renders configured providers only in ${locale} with the correct direction`, async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route("**/api/v1/auth/social/accounts", (route) => route.fulfill({ json: {
        data: [{ provider: "GOOGLE", status: "LINKED", linkedAt: "2026-09-06T12:00:00.000Z" }],
        recentAuthenticationRequired: false,
      } }));
      await page.goto(`${origin}/__social-account-security-test?locale=${locale}`);
      await browserExpect(page.getByRole("heading", { name: titles[locale] })).toBeVisible();
      await browserExpect(page.getByRole("heading", { name: "Google" })).toBeVisible();
      await browserExpect(page.getByRole("heading", { name: "Apple" })).toHaveCount(0);
      await browserExpect(page.locator("section.social-account-security")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.close();
    }, 60_000);
  }

  it("requires explicit confirmation and refreshes after unlink", async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    let linked = true;
    let deletes = 0;
    await page.route("**/api/v1/auth/social/accounts/*", (route) => {
      linked = false; deletes += 1;
      return route.fulfill({ status: 204, body: "" });
    });
    await page.route("**/api/v1/auth/social/accounts", (route) => {
      return route.fulfill({ headers: { "cache-control": "no-store" }, json: {
        data: [{ provider: "GOOGLE", status: linked ? "LINKED" : "NOT_LINKED", linkedAt: linked ? "2026-09-06T12:00:00.000Z" : null }],
        recentAuthenticationRequired: false,
      } });
    });
    await page.goto(`${origin}/__social-account-security-test?locale=en`);
    const unlink = page.getByRole("button", { name: "Disconnect" });
    await browserExpect(unlink).toBeDisabled();
    await page.getByRole("checkbox").check();
    await unlink.click();
    await browserExpect(page.getByRole("button", { name: "Connect provider" })).toBeVisible();
    expect(deletes).toBe(1);
    await browserExpect(page.locator("body")).toHaveAttribute("data-tone", "success");
    await page.close();
  }, 60_000);
});
