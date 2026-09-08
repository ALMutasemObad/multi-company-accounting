import { expect, test, type Page } from "@playwright/test";

const supportedProjects = new Set(["mobile-390", "desktop-1440"]);

async function prepareArabic(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
}

async function openFixture(page: Page, qa: string) {
  await page.goto(`/?qa=${qa}#${qa}`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
}

async function expectNoPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth > document.body.clientWidth + 1,
  }));
  expect(overflow, `${label} must not create page-level horizontal overflow`).toEqual({
    document: false,
    body: false,
  });
}

async function overridePermissions(page: Page, permissions: string[]) {
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({ response, json: { ...authorization, permissions } });
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name), "This practical audit targets 390px and 1440px only.");
  await prepareArabic(page);
});

test("Arabic settings, master-data, inventory and import entry points render at 390px and 1440px", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openFixture(page, "settings");
  await expect(page.getByRole("heading", { name: "إعدادات الشركة", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "عملات الشركة", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "أسعار الصرف", exact: true })).toBeVisible();
  await expectNoPageOverflow(page, "settings");

  await openFixture(page, "accounts");
  await expect(page.getByRole("heading", { name: "دليل الحسابات ومراكز التكلفة", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "مراكز التكلفة", exact: true }).click();
  await expect(page.getByRole("heading", { name: "لا توجد مراكز تكلفة", exact: true })).toBeVisible();
  await expectNoPageOverflow(page, "accounts and cost centers");

  await openFixture(page, "inventory");
  for (const tab of ["المستودعات", "الأرصدة الحالية", "حركات المخزون", "وحدات القياس", "كتالوج الأصناف"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
    await expectNoPageOverflow(page, `inventory: ${tab}`);
  }

  await openFixture(page, "imports");
  await expect(page.getByRole("heading", { name: "مركز الاستيراد الجماعي", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "دفعة استيراد جديدة", exact: true })).toBeVisible();
  await expectNoPageOverflow(page, "imports");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(pageErrors).toEqual([]);
});

test("P1: account creation actions are hidden without accounts.create", async ({ page }) => {
  await openFixture(page, "accounts");

  await expect(page.getByRole("button", { name: "حساب جديد", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إنشاء حساب", exact: true })).toHaveCount(0);
});

test("P1: accounts.view alone can open the chart without cost-center management", async ({ page }) => {
  await overridePermissions(page, ["accounts.view"]);
  await openFixture(page, "accounts");

  await expect(page.getByRole("heading", { name: "دليل الحسابات ومراكز التكلفة", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "مراكز التكلفة", exact: true })).toHaveCount(0);
});

test.fixme("P1: inventory view-only sections do not expose write actions", async ({ page }) => {
  await openFixture(page, "inventory");
  await expect(page.getByRole("button", { name: "إنشاء مستودع", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعديل", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعطيل", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "الأرصدة الحالية", exact: true }).click();
  await expect(page.getByRole("button", { name: "تهيئة التقييم", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "حركات المخزون", exact: true }).click();
  await expect(page.getByRole("button", { name: "إنشاء حركة مخزون", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "وحدات القياس", exact: true }).click();
  await expect(page.getByRole("button", { name: "إنشاء وحدة قياس", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعديل", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعطيل", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "كتالوج الأصناف", exact: true }).click();
  await expect(page.getByRole("button", { name: "إنشاء صنف", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعديل", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعطيل", exact: true })).toHaveCount(0);
});

test.fixme("P1: import preview capability is resolved before file selection", async ({ page }) => {
  await openFixture(page, "imports");

  const importType = page.getByRole("combobox", { name: "نوع البيانات", exact: true });
  const fileInput = page.locator('input[type="file"]');
  const unauthorizedTypes = ["CUSTOMERS", "SUPPLIERS"];

  for (const value of unauthorizedTypes) {
    const option = importType.locator(`option[value="${value}"]`);
    if (await option.count()) {
      if (await option.isDisabled()) {
        await expect(option).toBeDisabled();
      } else {
        await importType.selectOption(value);
        await expect(fileInput).toBeDisabled();
      }
    }
  }

  await importType.selectOption("SALES_INVOICES");
  await expect(fileInput).toBeEnabled();
});

test.fixme("P1 QA: completed chart-template status has a matching account-list fixture", async ({ page }) => {
  await openFixture(page, "accounts");

  await expect(page.getByText("الدليل مكتمل (42 حسابًا)", { exact: false })).toBeVisible();
  await expect(page.locator(".accounting-tree tbody tr")).toHaveCount(42);
  await expect(page.getByRole("heading", { name: "لا توجد حسابات", exact: true })).toHaveCount(0);
});
