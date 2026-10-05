import { expect, test } from "@playwright/test";

test("manages a standalone service catalogue in a real browser and database", async ({ page }) => {
  test.skip(process.env.E2E_SERVICE_CATALOG_DB !== "true", "Requires an isolated local service-catalog database");
  const password = process.env.E2E_SERVICE_CATALOG_PASSWORD;
  expect(password, "A test-only seeded password is required").toBeTruthy();
  const suffix = Date.now().toString(36);
  const categoryName = `فئة اختبار ${suffix}`;
  const serviceName = `خدمة اختبار ${suffix}`;
  const variantName = `بديل اختبار ${suffix}`;

  await page.addInitScript(() => {
    if (!localStorage.getItem("mcap.locale")) localStorage.setItem("mcap.locale", "en");
  });
  await page.goto("/");
  const login = page.locator(".login-card");
  await login.locator('[name="email"]').fill("admin@mcap.local");
  await login.locator('[name="password"]').fill(password!);
  await login.getByRole("button", { name: "Secure sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.goto("/#services");
  await expect(page.getByRole("heading", { name: "Service management" }).first()).toBeVisible();

  await page.getByRole("button", { name: "New category" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Arabic name").fill(categoryName);
  await dialog.getByLabel("Service or category description (optional)").fill("تصنيف لا يخص مهنة بعينها");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(categoryName)).toBeVisible();

  await page.getByRole("button", { name: "New service" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Arabic name").fill(serviceName);
  await dialog.getByLabel("Search categories by name").fill(categoryName);
  await expect(dialog.getByRole("combobox", { name: "Category" }).locator("option").filter({ hasText: categoryName })).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "Category" }).selectOption({ label: categoryName });
  await dialog.getByRole("button", { name: "Save" }).click();
  const offerings = page.locator("#service-offerings-title").locator("..").locator("..");
  await expect(offerings).toContainText(serviceName);
  await offerings.getByRole("button", { name: new RegExp(serviceName) }).click();

  await page.getByRole("button", { name: "New variant" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Arabic name").fill(variantName);
  await dialog.getByLabel("Service unit").selectOption("SESSION");
  await dialog.getByRole("button", { name: "Save" }).click();
  const variants = page.locator("#service-variants-title").locator("..").locator("..");
  await expect(variants).toContainText(variantName);
  const variantRow = variants.locator("li").filter({ hasText: variantName });
  await variantRow.getByRole("button", { name: "Activate" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason for change").fill("Browser acceptance activation");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(variantRow).toContainText("Active");

  const offeringRow = page.locator("#service-offerings-title").locator("..").locator("..").locator("li")
    .filter({ hasText: serviceName });
  await offeringRow.getByRole("button", { name: "Activate" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason for change").fill("Browser acceptance activation");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(offeringRow).toContainText("Active");

  await page.getByLabel("Search services by name or code").fill(serviceName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(offeringRow).toBeVisible();

  // A failed load for a different offering must not relabel the previous variants.
  const otherService = `Other service ${suffix}`;
  await page.getByRole("button", { name: "New service" }).click();
  await page.getByRole("dialog").getByLabel("Arabic name").fill(otherService);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Search services by name or code").fill(otherService);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  let failVariants = true;
  await page.route("**/service-catalog/offerings/*/variants?*", async route => {
    if (failVariants) {
      failVariants = false;
      await route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } });
    } else await route.continue();
  });
  await offerings.getByRole("button", { name: new RegExp(otherService) }).click();
  await expect(variants.getByRole("alert")).toBeVisible();
  await expect(variants.getByText(variantName)).toHaveCount(0);
  await variants.getByRole("button", { name: "Try again" }).click();
  await expect(variants.getByRole("alert")).toHaveCount(0);
  await expect(variants.locator("li")).toHaveCount(0);
  await page.unroute("**/service-catalog/offerings/*/variants?*");

  // Simulate another writer winning, then recover without losing the open draft.
  const categoryRow = page.locator("#service-categories-title").locator("..").locator("..").locator("li").filter({ hasText: categoryName });
  await categoryRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  const draftName = `${categoryName} draft`;
  await dialog.getByLabel("Arabic name").fill(draftName);
  let collide = true;
  let priorVersion = 0;
  await page.route("**/service-catalog/categories/*", async route => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    const body = route.request().postDataJSON();
    if (collide) {
      collide = false; priorVersion = body.expectedVersion;
      const competing = await route.fetch({ postData: JSON.stringify({ ...body, nameAr: `${categoryName} concurrent` }) });
      expect(competing.ok()).toBe(true);
      await route.fulfill({ status: 409, json: { code: "BUSINESS_RULE_VIOLATION", reason: "VERSION_CONFLICT" } });
    } else {
      expect(body.expectedVersion).toBeGreaterThan(priorVersion);
      expect(body.nameAr).toBe(draftName);
      await route.continue();
    }
  });
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByRole("alert").getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Arabic name")).toHaveValue(draftName);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(draftName, { exact: true })).toBeVisible();
  await page.unroute("**/service-catalog/categories/*");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Service management" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);

  await page.evaluate(() => localStorage.setItem("mcap.locale", "ar"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "إدارة الخدمات" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
});
