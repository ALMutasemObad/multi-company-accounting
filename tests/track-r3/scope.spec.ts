import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.goto("/track-r3/");
});

for (const action of ["Switch company", "Switch user", "Revoke setup access", "No company"]) {
  test(`${action} discards pending evidence synchronously`, async ({ page }) => {
    await page.getByRole("button", { name: "Hold reads", exact: true }).click();
    await page.getByRole("button", { name: "Check available data" }).click();
    await expect(page.locator(".retail-onboarding [role=status]")).toBeVisible();
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.getByRole("button", { name: "Release old reads", exact: true }).click();
    await expect(page.locator(".retail-onboarding [role=status]")).toHaveCount(0);
    if (action === "No company") {
      await expect(page.locator(".retail-onboarding")).toHaveCount(0);
      await expect(page.locator(".retail-empty")).toContainText("Select a company first");
    } else {
      await page.locator(".retail-step-list button").nth(1).click();
      await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", action === "Revoke setup access" ? "unavailable" : "notChecked");
      if (action !== "Revoke setup access") {
        await page.getByRole("button", { name: "Check available data" }).click();
        await expect(page.locator("[data-fact=items]")).toHaveAttribute("data-state", "empty");
      }
    }
    await expect(page.locator('[data-state="found"]')).toHaveCount(0);
  });
}

test("optional target callback preserves section, while fallback opens only the real view", async ({ page }) => {
  await page.locator(".retail-step-list button").nth(1).click();
  await page.locator("[data-setup-action=items]").click();
  await expect(page.getByTestId("navigation-target")).toHaveText("inventory");
  await expect(page.locator(".retail-destination-note")).toBeVisible();
  await page.getByRole("button", { name: "Connect section callback" }).click();
  await page.locator("[data-setup-action=items]").click();
  await expect(page.getByTestId("navigation-target")).toHaveText('{"view":"inventory","section":"items"}');
  await expect(page.locator(".retail-destination-note")).toHaveCount(0);
});
