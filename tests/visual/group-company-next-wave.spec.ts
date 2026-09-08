import { expect, test } from "@playwright/test";
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

for (const locale of ["ar", "en", "ur", "hi"] as const) {
  test(`${locale}: group company creation is discoverable and bounded`, async ({ page }, testInfo) => {
    test.skip(!supportedProjects.has(testInfo.project.name), "Group company evidence is maintained at 390 and 1440.");
    await page.addInitScript((selectedLocale) => localStorage.setItem("mcap.locale", selectedLocale), locale);
    await page.goto("/?qa=organization-owner#organizationOwner");

    const workspace = page.locator(".organization-owner-page");
    const creation = workspace.locator("#group-company-create");
    await expect(workspace).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
    await expect(workspace.getByRole("button", { name: dictionaries[locale]["organization.create.cta"] })).toBeVisible();
    await expect(creation.getByRole("heading", { name: dictionaries[locale]["organization.create.title"] })).toBeVisible();
    await expect(creation.locator(".group-company-boundary")).toContainText(dictionaries[locale]["organization.create.boundary"]);
    await expect(creation.locator('input[name="companyName"]')).toBeVisible();
    await expect(creation.locator('select[name="timezone"]')).toBeVisible();
    await expect(creation.locator('select[name="baseCurrencyCode"]')).toBeVisible();

    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      body: document.body.scrollWidth <= document.body.clientWidth + 1,
      creation: document.querySelector<HTMLElement>("#group-company-create")!.scrollWidth <= document.querySelector<HTMLElement>("#group-company-create")!.clientWidth + 1,
    }))).toEqual({ document: true, body: true, creation: true });

    const fontSizes = await creation.evaluate((root) => [...new Set([...root.querySelectorAll("h2, p, label, input, select, button")]
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => getComputedStyle(element).fontSize))]);
    expect(fontSizes.length).toBeLessThanOrEqual(2);
  });
}
