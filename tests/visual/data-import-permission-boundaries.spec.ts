import { expect, test, type Page } from "@playwright/test";

const supportedProjects = new Set(["mobile-390", "desktop-1440"]);
const forbiddenMessage = "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.";

async function openImports(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.goto("/?qa=imports#imports");
  await expect(page.getByRole("heading", { name: "مركز الاستيراد الجماعي", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-page .loading")).toHaveCount(0);
}

async function alterPermissions(
  page: Page,
  update: (permissions: string[]) => string[],
) {
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({
      response,
      json: { ...authorization, permissions: update(authorization.permissions) },
    });
  });
}

async function fulfillValidPreview(page: Page) {
  await page.route("**/api/v1/data-imports/preview", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      json: {
        batch: {
          id: "00000000-0000-4000-8000-000000000001",
          importType: "SALES_INVOICES",
          sourceFormat: "CSV",
          rowCount: 1,
          validRowCount: 1,
          errorRowCount: 0,
          status: "PREVIEWED",
          expiresAt: "2026-09-08T13:00:00.000Z",
          committedAt: null,
          createdAt: "2026-09-08T12:00:00.000Z",
        },
        errors: [],
      },
    });
  });
}

async function previewSyntheticSalesCsv(page: Page) {
  await page.getByRole("combobox", { name: "صيغة الملف", exact: true }).selectOption("CSV");
  await page.locator('input[type="file"]').setInputFiles({
    name: "sales-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("invoice_number,document_date\nQA-1,2026-09-08\n", "utf8"),
  });
  await page.getByRole("button", { name: "فحص ومعاينة", exact: true }).click();
  await expect(page.getByText("الدفعة جاهزة للاعتماد", { exact: true })).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name), "Permission boundaries are maintained at 390px and 1440px.");
});

test("enables only import types the visual-QA user can preview", async ({ page }) => {
  await openImports(page);

  const type = page.getByRole("combobox", { name: "نوع البيانات", exact: true });
  await expect(type.locator('option[value="CUSTOMERS"]')).toHaveAttribute("disabled", "");
  await expect(type.locator('option[value="CUSTOMERS"]')).toHaveAttribute("aria-label", `العملاء: ${forbiddenMessage}`);
  await expect(type.locator('option[value="SUPPLIERS"]')).toHaveAttribute("disabled", "");
  await expect(type.locator('option[value="SUPPLIERS"]')).toHaveAttribute("aria-label", `الموردون: ${forbiddenMessage}`);
  await expect(type.locator('option[value="SALES_INVOICES"]')).not.toHaveAttribute("disabled", "");
  await expect(type.locator('option[value="PURCHASE_INVOICES"]')).not.toHaveAttribute("disabled", "");
  await expect(type).toHaveValue("SALES_INVOICES");
  const typeExplanationId = await type.getAttribute("aria-describedby");
  expect(typeExplanationId).toBeTruthy();
  await expect(page.locator(`[id="${typeExplanationId}"]`)).toContainText(forbiddenMessage);
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await expect(page.getByRole("button", { name: "تنزيل القالب", exact: true })).toBeEnabled();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("keeps history visible but blocks every builder action for data-import view-only", async ({ page }) => {
  const attemptedWrites: string[] = [];
  await alterPermissions(page, () => ["data_imports.view"]);
  page.on("request", (request) => {
    if (request.method() !== "GET") attemptedWrites.push(request.url());
  });

  await openImports(page);

  const type = page.getByRole("combobox", { name: "نوع البيانات", exact: true });
  await expect(type).toBeDisabled();
  await expect(type.locator("option:enabled")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "صيغة الملف", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(page.getByRole("button", { name: "تنزيل القالب", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "فحص ومعاينة", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: forbiddenMessage })).toBeVisible();
  await expect(page.getByRole("heading", { name: "سجل الدفعات", exact: true })).toBeVisible();
  await expect(page.getByText("لا توجد دفعات استيراد بعد.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "فحص ومعاينة", exact: true }).click({ force: true });
  expect(attemptedWrites.filter((url) => url.includes("/data-imports/preview"))).toEqual([]);
});

test("keeps commit disabled when preview is allowed but data-import execute is absent", async ({ page }) => {
  const commitRequests: string[] = [];
  await fulfillValidPreview(page);
  page.on("request", (request) => {
    if (request.url().includes("/data-imports/") && request.url().endsWith("/commit")) {
      commitRequests.push(request.url());
    }
  });

  await openImports(page);
  await previewSyntheticSalesCsv(page);

  const commit = page.getByRole("button", { name: "اعتماد الدفعة", exact: true });
  await expect(commit).toBeDisabled();
  const commitExplanationId = await commit.getAttribute("aria-describedby");
  expect(commitExplanationId).toBeTruthy();
  await expect(page.locator(`[id="${commitExplanationId}"]`)).toContainText(forbiddenMessage);
  await commit.click({ force: true });
  expect(commitRequests).toEqual([]);
});

test("enables commit only when execute and the selected type permission are both present", async ({ page }) => {
  await alterPermissions(page, (permissions) => [...permissions, "data_imports.execute"]);
  await fulfillValidPreview(page);
  await openImports(page);
  await previewSyntheticSalesCsv(page);

  await expect(page.getByRole("button", { name: "اعتماد الدفعة", exact: true })).toBeEnabled();
});
