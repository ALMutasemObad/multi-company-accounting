import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { arCrm } from "../../apps/web/src/i18n/locales/crm";
import { arEmployeeExpenses } from "../../apps/web/src/i18n/locales/employee-expenses";
import { arOrganizationOwner } from "../../apps/web/src/i18n/locales/organization-owner";

const destinations = [
  { label: arOrganizationOwner["nav.organizationOwner"], hash: "organizationOwner", ready: ".organization-owner-page" },
  { label: arCrm["nav.crm"], hash: "crm", ready: ".crm-page" },
  { label: arEmployeeExpenses["nav.employeeExpenses"], hash: "employeeExpenses", ready: ".employee-expenses-workspace" },
] as const;

test("رحلة الموجة الثانية تبدأ من الرئيسية وتصل إلى الوحدات الثلاث", async ({ page }, testInfo) => {
  test.skip(!["mobile-390", "desktop-1440"].includes(testInfo.project.name), "The unified Arabic release journey is verified at 390 and 1440.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto("/?qa=wave2-release-candidate#home");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".system-home-page")).toBeVisible();

  for (const destination of destinations) {
    const card = page.locator("button.system-card").filter({ hasText: destination.label });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`#${destination.hash}$`));
    await expect(page.locator(destination.ready)).toBeVisible();
    await expect(page.locator(`${destination.ready} .loading`)).toHaveCount(0);
    const mobileMenu = page.getByRole("button", { name: "فتح القائمة" });
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await page.locator(".sidebar nav button").filter({ hasText: "الرئيسية" }).click();
    await expect(page).toHaveURL(/#home$/u);
    await expect(page.locator(".system-home-page")).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({
    path: resolve("docs/visual-qa", `wave2-release-candidate-ar-${testInfo.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
});
