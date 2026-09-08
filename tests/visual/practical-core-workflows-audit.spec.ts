import { expect, test, type Page } from "@playwright/test";

const supportedProjects = new Set(["mobile-390", "desktop-1440"]);

const auditedJourneys = [
  { qa: "customers", marker: "CUS-000001" },
  { qa: "suppliers", marker: "لا يوجد موردون مطابقون" },
  { qa: "receipts", marker: "لا توجد سندات قبض" },
  { qa: "payments", marker: "لا توجد سندات صرف" },
  { qa: "journals", marker: "القيود اليومية" },
  { qa: "fiscal", marker: "السنة المالية 2026" },
  { qa: "settings", marker: "المنطقة الزمنية" },
  { qa: "audit", marker: "نوع الكيان" },
  { qa: "security", marker: "لا توجد أحداث مطابقة" },
] as const;

async function prepareArabic(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
}

async function openFixture(page: Page, qa: string) {
  await page.goto(`/?qa=${qa}#${qa}`);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name), "This practical audit targets 390px and 1440px only.");
  await prepareArabic(page);
});

test("Arabic core workflows render at 390px and 1440px without blank screens or page overflow", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const journey of auditedJourneys) {
    await test.step(journey.qa, async () => {
      await openFixture(page, journey.qa);
      await expect(page.locator(".workspace-page").getByText(journey.marker, { exact: false }).first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        body: document.body.scrollWidth > document.body.clientWidth + 1,
      }));
      expect(overflow, `${journey.qa} must not create page-level horizontal overflow`).toEqual({
        document: false,
        body: false,
      });
    });
  }

  expect(pageErrors).toEqual([]);
});

test.fixme("P1 QA: customer details remain rendered when the synthetic customer is opened", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openFixture(page, "customers");
  await page.getByRole("button", { name: "شركة الأفق", exact: true }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".workspace-page")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("view-only journal and fiscal users cannot initiate mutations", async ({ page }) => {
  await openFixture(page, "journals");
  await expect(page.getByRole("button", { name: "قيد يومية جديد", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إنشاء قيد", exact: true })).toHaveCount(0);

  await openFixture(page, "fiscal");
  await expect(page.getByRole("button", { name: "سنة مالية جديدة", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعديل السنة", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إغلاق", exact: true })).toHaveCount(0);
});

test.fixme("P1: a new manual journal starts inside the selected open fiscal period", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({
      response,
      json: {
        ...authorization,
        permissions: [...authorization.permissions, "manual_journals.create"],
      },
    });
  });

  await openFixture(page, "journals");
  await page.getByRole("button", { name: "قيد يومية جديد", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const selectedPeriod = dialog.locator("select").first();
  await expect(selectedPeriod).toHaveValue("1001");

  const documentDate = dialog.getByLabel("تاريخ المستند");
  const journalDate = dialog.getByLabel("تاريخ القيد").first();
  await expect(documentDate).toHaveValue(/2026-12-/);
  await expect(journalDate).toHaveValue(/2026-12-/);
});

test.fixme("P2: view-only empty states do not instruct users to create unavailable records", async ({ page }) => {
  for (const qa of ["suppliers", "receipts", "payments"] as const) {
    await openFixture(page, qa);
    await expect(page.locator(".empty-state")).not.toContainText(/أضف|أنشئ/u);
  }
});

test.fixme("P2: Arabic audit filters do not expose raw internal codes", async ({ page }) => {
  await openFixture(page, "audit");

  const visibleOptionLabels = await page.locator("select option").evaluateAll((options) =>
    options
      .filter((option) => (option as HTMLOptionElement).value)
      .map((option) => option.textContent?.trim() ?? "")
      .filter(Boolean),
  );

  expect(visibleOptionLabels).not.toEqual(expect.arrayContaining(["CREATE", "UPDATE", "CURRENCY"]));
  expect(visibleOptionLabels.filter((label) => /^[A-Z][A-Z_]+$/u.test(label))).toEqual([]);
});
