import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import {
  arOrganizationOwner,
  enOrganizationOwner,
  hiOrganizationOwner,
  urOrganizationOwner,
} from "../../apps/web/src/i18n/locales/organization-owner";

const dictionaries = {
  ar: arOrganizationOwner,
  en: enOrganizationOwner,
  ur: urOrganizationOwner,
  hi: hiOrganizationOwner,
};
const supportedProjects = new Set(["mobile-390", "desktop-1440"]);
const capture = process.env.UPDATE_ORGANIZATION_OWNER_SCREENSHOTS === "1";
const screenshotDirectory = resolve("docs/visual-qa");

async function contained(page: Page) {
  return page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth <= document.body.clientWidth + 1,
    content: document.querySelector<HTMLElement>(".content")!.scrollWidth <= document.querySelector<HTMLElement>(".content")!.clientWidth + 1,
  }));
}

for (const locale of ["ar", "en", "ur", "hi"] as const) {
  test(`${locale}: organization owner workspace is isolated, translated, and responsive`, async ({ page }, testInfo) => {
    test.skip(!supportedProjects.has(testInfo.project.name), "Organization owner evidence is maintained at 390 and 1440.");
    const width = testInfo.project.name === "mobile-390" ? 390 : 1440;
    await page.addInitScript((selectedLocale) => localStorage.setItem("mcap.locale", selectedLocale), locale);
    await page.goto("/?qa=organization-owner#organizationOwner");

    const workspace = page.locator(".organization-owner-page");
    await expect(workspace).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
    await expect(workspace.getByRole("heading", { name: dictionaries[locale]["organization.title"] })).toBeVisible();
    await expect(workspace.locator(".organization-company")).toHaveCount(4);
    await expect(workspace.locator(".organization-boundary")).toContainText(dictionaries[locale]["organization.boundary.title"]);
    await expect(workspace.locator(".organization-members tbody tr")).toHaveCount(3);
    await expect(workspace.locator(".organization-member-notice")).toContainText(dictionaries[locale]["organization.members.externalNotice"]);
    expect(await contained(page)).toEqual({ document: true, body: true, content: true });

    const fontSizes = await workspace.evaluate((root) => [...new Set([...root.querySelectorAll("h1, h2, h3, p, dt, dd, small")]
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => getComputedStyle(element).fontSize))]);
    expect(fontSizes.length).toBeLessThanOrEqual(2);

    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    if (capture) await page.screenshot({
      path: resolve(screenshotDirectory, `organization-owner-${locale}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
