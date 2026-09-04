import { expect, test } from "@playwright/test";

const locales = ["ar", "en", "ur", "hi"] as const;

for (const locale of locales) {
  test(`CRM workspace visual evidence · ${locale}`, async ({ page }, testInfo) => {
    test.skip(!["mobile-390", "desktop-1440"].includes(testInfo.project.name));
    await page.addInitScript((selectedLocale) => {
      window.localStorage.setItem("mcap.locale", selectedLocale);
    }, locale);
    await page.goto("/?qa=crm#crm");
    await expect(page.locator(".crm-page")).toBeVisible();
    await expect(page.locator(".crm-page .loading")).toHaveCount(0);
    await expect(page.locator(".crm-pipeline-card")).toHaveCount(5);
    await expect(page.locator(".crm-boundary-note")).toContainText("F2");
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      page: document.querySelector<HTMLElement>(".crm-page")!.scrollWidth - document.querySelector<HTMLElement>(".crm-page")!.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({
      path: `docs/visual-qa/crm-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });
}
