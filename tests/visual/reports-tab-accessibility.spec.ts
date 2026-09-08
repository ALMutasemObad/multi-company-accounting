import { expect, test, type Page } from "@playwright/test";

const auditedProjects = new Set(["mobile-390", "desktop-1440"]);
const tabIds = ["cash", "tax", "costCenters", "trial", "journal", "ledger", "position", "income"] as const;

async function expectSelectedTab(page: Page, selectedIndex: number) {
  const tablist = page.getByRole("tablist", { name: "التقارير المالية" });
  const tabs = tablist.getByRole("tab");
  for (const [index, tabId] of tabIds.entries()) {
    const item = tabs.nth(index);
    await expect(item).toHaveAttribute("id", `reports-tab-${tabId}`);
    await expect(item).toHaveAttribute("aria-controls", "reports-panel");
    const controls = await item.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`#${controls}`)).toHaveCount(1);
    await expect(item).toHaveAttribute("aria-selected", String(index === selectedIndex));
    await expect(item).toHaveAttribute("tabindex", index === selectedIndex ? "0" : "-1");
  }
  const activeId = tabIds[selectedIndex]!;
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute("id", "reports-panel");
  await expect(panel).toHaveAttribute("aria-labelledby", `reports-tab-${activeId}`);
}

test("reports tabs expose one labelled, keyboard-navigable active panel", async ({ page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name), "Reports accessibility evidence is maintained at 390 and 1440.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto("/?qa=reports#reports");

  const tablist = page.getByRole("tablist", { name: "التقارير المالية" });
  await expect(tablist).toBeVisible();
  const tabs = tablist.getByRole("tab");
  await expect(tabs).toHaveCount(tabIds.length);
  await expectSelectedTab(page, 0);

  await tabs.nth(0).focus();
  await tabs.nth(0).press("ArrowLeft");
  await expect(tabs.nth(1)).toBeFocused();
  await expectSelectedTab(page, 1);

  await tabs.nth(1).press("End");
  await expect(tabs.nth(7)).toBeFocused();
  await expectSelectedTab(page, 7);

  await tabs.nth(7).press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await expectSelectedTab(page, 0);

  await tabs.nth(0).press("ArrowRight");
  await expect(tabs.nth(7)).toBeFocused();
  await expectSelectedTab(page, 7);

  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toBeFocused();
  await expectSelectedTab(page, 2);
  await expect(page.locator(".cost-center-activity-report")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
