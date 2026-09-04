import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("employee expenses journey is responsive and records review evidence", async ({ page }, testInfo) => {
  test.skip(!["mobile-390", "desktop-1440"].includes(testInfo.project.name), "Acceptance evidence uses the requested widths only.");
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto("/?qa=employeeExpenses#employeeExpenses");
  await expect(page.locator(".employee-expenses-workspace")).toBeVisible();
  await expect(page.locator(".employee-expenses-workspace .loading")).toHaveCount(0);
  await expect(page.locator(".employee-expense-claim")).toHaveCount(3);
  await expect(page.locator(".employee-expense-ready")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const viewport = testInfo.project.name === "mobile-390" ? "390" : "1440";
  const evidenceDirectory = resolve("docs/evidence/employee-expenses-20260904");
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(evidenceDirectory, `employee-expenses-${viewport}.png`),
    fullPage: true,
  });
});

const localeDirections = {
  ar: "rtl",
  en: "ltr",
  ur: "rtl",
  hi: "ltr",
} as const;

for (const [locale, direction] of Object.entries(localeDirections)) {
  test(`employee expenses is complete and contained in ${locale}`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.addInitScript((selectedLocale) => {
      window.localStorage.setItem("mcap.locale", selectedLocale);
    }, locale);
    await page.goto(`/?qa=employeeExpenses-${locale}#employeeExpenses`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.locator(".employee-expense-claim")).toHaveCount(3);
    await expect(page.locator(".employee-expense-form")).toBeVisible();
    await expect(page.locator(".employee-expense-ready")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(runtimeErrors).toEqual([]);
  });
}
