import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

type ShowcaseLocale = "ar" | "en";

const captureScreenshots = process.env.UPDATE_SHOWCASE_SCREENSHOTS === "1";
const screenshotDirectory = resolve("docs/visual-qa");
const supportedProjects = new Set(["mobile-390", "desktop-1440"]);

async function prepare(page: Page, locale: ShowcaseLocale) {
  await page.addInitScript((selectedLocale) => {
    window.localStorage.setItem("mcap.locale", selectedLocale);
  }, locale);
}

async function openWorkspace(page: Page, view: "home" | "dashboard" | "platform") {
  await page.goto(`/?qa=showcase-${view}#${view}`);
  await expect(page.locator(`.${view === "home" ? "system-home-page" : view === "dashboard" ? "dashboard-page" : "platform-page"}`)).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
  });
}

async function expectContained(page: Page) {
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth <= document.body.clientWidth + 1,
    content: document.querySelector<HTMLElement>(".content")!.scrollWidth <= document.querySelector<HTMLElement>(".content")!.clientWidth + 1,
  }))).toEqual({ document: true, body: true, content: true });
}

for (const locale of ["ar", "en"] as const) {
  test(`${locale}: product showcase connects company work and platform operations`, async ({ page }, testInfo) => {
    test.skip(!supportedProjects.has(testInfo.project.name), "Showcase references are maintained at 390 and 1440 only.");
    const width = testInfo.project.name === "mobile-390" ? 390 : 1440;
    await prepare(page, locale);

    await openWorkspace(page, "home");
    await expect(page.locator(".home-quick-card")).toHaveCount(4);
    await expect(page.locator(".home-platform-entry")).toBeVisible();
    await expectContained(page);
    if (captureScreenshots) await page.screenshot({ path: resolve(screenshotDirectory, `home-${locale}-${width}.png`), fullPage: true, animations: "disabled" });

    await openWorkspace(page, "dashboard");
    await expect(page.locator(".dashboard-quick-actions button")).toHaveCount(3);
    await expect(page.locator(".metric-card")).toHaveCount(4);
    await expectContained(page);
    if (captureScreenshots) await page.screenshot({ path: resolve(screenshotDirectory, `dashboard-${locale}-${width}.png`), fullPage: true, animations: "disabled" });

    await openWorkspace(page, "platform");
    await expect(page.locator(".platform-scope-banner")).toBeVisible();
    await expect(page.locator(".platform-analytics-shortcuts")).toBeVisible();
    await expect(page.locator(".platform-analytics-kpi")).toHaveCount(8);
    await expectContained(page);
    if (captureScreenshots) await page.screenshot({ path: resolve(screenshotDirectory, `platform-${locale}-${width}.png`), fullPage: true, animations: "disabled" });

    await page.locator(".platform-analytics-shortcuts").getByRole("button").first().click();
    await expect(page.locator(".platform-tabs button.active")).toHaveText(locale === "ar" ? "الشركات والاستخدام" : "Companies & usage");
    await expect(page.locator(".platform-list-panel tbody tr")).toHaveCount(3);
  });
}
