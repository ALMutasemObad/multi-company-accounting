import { expect, test } from "@playwright/test";

const locales = ["ar", "en", "ur", "hi"] as const;
const department = { id: "97259274-b795-4c1e-a6df-6ffcf06fe9b5", code: "DEP-000001", nameAr: "الاستشارات", nameEn: "Advisory", description: null, isActive: true, version: 1, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" };
const secondDepartment = { id: "0dbca485-5eab-4303-84c0-7921fb67c962", code: "DEP-000002", nameAr: "العمليات", nameEn: "Operations", description: null, isActive: true, version: 1, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" };
const position = { id: "c0d151ec-5973-4118-ab5e-d21a9945a489", code: "JOB-000001", nameAr: "مستشار", nameEn: "Consultant", description: null, isActive: true, version: 1, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" };
const secondPosition = { id: "e527f1b3-733a-4d04-8fa9-7f67551320fc", code: "JOB-000002", nameAr: "منسق عمليات", nameEn: "Operations coordinator", description: null, isActive: true, version: 1, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" };

const employees = [
  employee("2ef7ba4b-6fab-4a9d-9cf6-9117b0dcd105", "EMP-000041", "سارة العتيبي", "Sarah Alotaibi", "ACTIVE", department, position, true),
  employee("7f6166dd-8037-447c-9fb6-e3132130a824", "EMP-000052", "راشد السالم", "Rashed Alsalem", "ON_LEAVE", secondDepartment, secondPosition, true),
  employee("5a09a009-3218-4ca6-864c-2375bfd3b50f", "EMP-000019", "هند الهاشمي", "Hind Alhashimi", "TERMINATED", department, position, false),
];

function employee(id: string, employeeNumber: string, nameAr: string, nameEn: string, status: "ACTIVE" | "ON_LEAVE" | "TERMINATED", employeeDepartment: typeof department, employeePosition: typeof position, hasActiveContract: boolean) {
  return {
    id, employeeNumber, nameAr, nameEn, status, hasActiveContract,
    employmentType: "FULL_TIME", hireDate: "2025-03-12",
    terminationDate: status === "TERMINATED" ? "2026-07-31" : null,
    terminationReason: status === "TERMINATED" ? "انتهاء العلاقة التعاقدية" : null,
    workLocation: "الرياض", department: employeeDepartment, position: employeePosition,
    manager: null, linkedUser: status === "ACTIVE" ? { id: "user-1", displayName: nameEn, nameEn } : null,
    version: 2, createdAt: "2025-03-12T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z",
  };
}

const contracts = [{
  id: "d913db4a-c391-44be-ab0d-846a2d0bb0b5", contractType: "PERMANENT", titleAr: "عقد عمل دائم", titleEn: "Permanent employment contract",
  startDate: "2025-03-12", endDate: null, status: "ACTIVE", notes: null, endReason: null, endedAt: null,
  version: 1, createdAt: "2025-03-12T08:00:00.000Z", updatedAt: "2025-03-12T08:00:00.000Z",
}];

function list(data: typeof employees, pageSize = 12) {
  return { data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length ? 1 : 0 } };
}

for (const locale of locales) {
  test(`human resources daily workspace · ${locale}`, async ({ page }, testInfo) => {
    await page.addInitScript((selectedLocale) => window.localStorage.setItem("mcap.locale", selectedLocale), locale);
    await page.route("**/api/v1/hr/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/hr/departments") return json({ data: [department, secondDepartment] });
      if (path === "/hr/positions") return json({ data: [position, secondPosition] });
      if (path === "/hr/employees") {
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search")?.toLocaleLowerCase();
        const departmentId = url.searchParams.get("departmentId");
        const filtered = employees.filter((item) => (!status || item.status === status)
          && (!departmentId || item.department.id === departmentId)
          && (!search || [item.employeeNumber, item.nameAr, item.nameEn].some((value) => value.toLocaleLowerCase().includes(search))));
        return json(list(filtered, Number(url.searchParams.get("pageSize") ?? 12)));
      }
      const selected = employees.find((item) => path === `/hr/employees/${item.id}`);
      if (selected) return json({ employee: selected });
      const contractOwner = employees.find((item) => path === `/hr/employees/${item.id}/contracts`);
      if (contractOwner) return json({ data: contractOwner.hasActiveContract ? contracts : [] });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
    });

    await page.goto("/#humanResources");
    await expect(page.locator(".hr-experience")).toBeVisible();
    await expect(page.locator(".hr-status-filters > button")).toHaveCount(4);
    await expect(page.locator(".hr-current-total")).toContainText(/[3٣]/u);
    await expect(page.locator(".hr-person-card")).toHaveCount(3);
    await expect(page.locator(".hr-contract-list > li")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" || locale === "ur" ? "rtl" : "ltr");
    await expect(page.locator(".hr-experience")).not.toContainText(/(?:hr|common)\.[A-Za-z]/u);
    await expectNoOverflow(page);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: testInfo.outputPath(`employees-${locale}-${testInfo.project.name}.png`), fullPage: true });

    const employeeTab = page.locator("#hr-employees-tab");
    const structureTab = page.locator("#hr-structure-tab");
    await expect(employeeTab).toHaveAttribute("tabindex", "0");
    await expect(structureTab).toHaveAttribute("tabindex", "-1");
    await employeeTab.focus();
    await page.keyboard.press(locale === "ar" || locale === "ur" ? "ArrowLeft" : "ArrowRight");
    await expect(structureTab).toBeFocused();
    await expect(structureTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".hr-structure-grid")).toBeVisible();
    await expect(page.locator("#hr-structure-panel")).toHaveAttribute("aria-labelledby", "hr-structure-tab");
    await expect(page.locator(".hr-reference-list").first().locator("li")).toHaveCount(2);
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`structure-${locale}-${testInfo.project.name}.png`), fullPage: true });
  });
}

async function expectNoOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    main: document.querySelector<HTMLElement>("main")!.scrollWidth - document.querySelector<HTMLElement>("main")!.clientWidth,
    page: document.querySelector<HTMLElement>(".hr-experience")!.scrollWidth - document.querySelector<HTMLElement>(".hr-experience")!.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.main).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);
}
