import { expect, test, type Page, type TestInfo } from "@playwright/test";

const auditedProjects = new Set(["mobile-390", "desktop-1440"]);
const readiness = {
  policyVersion: "BP1_GLOBAL_2026_09",
  policySource: "ADR-018",
  effectiveAt: "2026-08-29T00:00:00.000Z",
  enforcementMode: "ADVISORY",
  grandfathered: false,
  completedRequirements: 8,
  totalRequirements: 8,
  missingRequirements: [],
  requirements: [
    ["TRADE_NAME", "BASIC", "COMPLETE", "RECORDED"],
    ["COUNTRY", "BASIC", "COMPLETE", "RECORDED"],
    ["PRIMARY_BUSINESS_ACTIVITY", "BASIC", "COMPLETE", "RECORDED"],
    ["BUSINESS_PHONE", "OPERATIONAL", "COMPLETE", "RECORDED"],
    ["LEGAL_NAME", "COMMERCIAL", "COMPLETE", "RECORDED"],
    ["COMMERCIAL_REGISTRATION", "COMMERCIAL", "COMPLETE", "RECORDED"],
    ["NATIONAL_ADDRESS", "COMMERCIAL", "COMPLETE", "RECORDED"],
    ["TAX_REGISTRATION", "REGULATED", "COMPLETE", "RECORDED"],
    ["SA_COMMERCIAL_REGISTRATION", "COMMERCIAL", "OPTIONAL", "NO_VERIFIED_JURISDICTION_REQUIREMENT"],
    ["SA_VAT_REGISTRATION", "REGULATED", "OPTIONAL", "NO_VERIFIED_JURISDICTION_REQUIREMENT"],
    ["SA_NATIONAL_ADDRESS", "COMMERCIAL", "OPTIONAL", "NO_VERIFIED_JURISDICTION_REQUIREMENT"],
  ].map(([code, level, status, reason]) => ({ code, level, status, blocking: false, reason })),
};
const brandingAssets = ["LOGO", "LETTERHEAD"].map(kind => ({
  kind, status: "STORAGE_POLICY_REQUIRED", uploadSupported: false, metadataAccepted: false,
}));
const profile = {
  profile: {
    companyId: "1", tradeName: "شركة أفق الرياض", countryCode: "SA", preferredLocale: "ar",
    phone: "+966500000000", email: "office@afaq.example", website: "https://afaq.example",
    primaryContactName: "إدارة الشركة",
    primaryBusinessActivity: { code: "RETAIL_TRADE", nameAr: "تجارة التجزئة", nameEn: "Retail trade" },
    initialChartTemplateCode: "RETAIL_INVENTORY", grandfatheredAt: null, version: 4,
    updatedAt: "2026-09-09T08:00:00.000Z",
  },
  readiness,
  brandingAssets,
  options: {
    countries: [
      { code: "SA", nameAr: "المملكة العربية السعودية", nameEn: "Saudi Arabia" },
      { code: "YE", nameAr: "اليمن", nameEn: "Yemen" },
    ],
    activities: [
      { code: "RETAIL_TRADE", nameAr: "تجارة التجزئة", nameEn: "Retail trade" },
      { code: "PROFESSIONAL_SERVICES", nameAr: "خدمات مهنية", nameEn: "Professional services" },
    ],
  },
};
const compliance = {
  version: 4,
  countryCode: "SA",
  legalName: "شركة أفق الرياض للتجارة",
  legalForm: "شركة ذات مسؤولية محدودة",
  commercialRegistration: {
    id: "11", documentType: "COMMERCIAL_REGISTRATION", numberLast4: "6789", issuingAuthority: "وزارة التجارة",
    issuedAt: "2024-01-01", expiresAt: "2027-01-01", status: "VERIFIED", renewalStatus: "CURRENT",
    verifiedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  },
  taxRegistration: {
    id: "12", registrationType: "VAT", countryCode: "SA", numberLast4: "4321",
    issuedAt: "2024-02-01", expiresAt: "2027-02-01", status: "VERIFIED", renewalStatus: "CURRENT",
    verifiedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  },
  nationalAddress: {
    id: "13", line1: "طريق الملك فهد", line2: null, district: "العليا", city: "الرياض",
    subdivision: "منطقة الرياض", postalCode: "12214", countryCode: "SA", displayAddress: "العليا، الرياض",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  readiness,
  brandingAssets,
};

async function prepare(page: Page, permissions: string[]) {
  let profileRequests = 0;
  let complianceRequests = 0;
  await page.addInitScript(() => window.localStorage.setItem("mcap.locale", "ar"));
  await page.route("**/api/v1/auth/me", async route => {
    const response = await route.fetch();
    const authorization = await response.json();
    await route.fulfill({ response, body: JSON.stringify({ ...authorization, permissions }) });
  });
  await page.route("**/api/v1/company-profile", route => {
    profileRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/api/v1/company-compliance", route => {
    complianceRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(compliance) });
  });
  return { requests: () => ({ profile: profileRequests, compliance: complianceRequests }) };
}

async function attachState(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("company profile and compliance tabs are responsive and keyboard complete", async ({ page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name), "Company profile visual evidence is maintained at 390 and 1440.");
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  const traffic = await prepare(page, [
    "companies.profile.view", "companies.profile.manage",
    "companies.compliance.view", "companies.compliance.manage",
  ]);
  await page.goto("/?qa=settings#settings");

  const tablist = page.getByRole("tablist", { name: "ملف المنشأة" });
  const businessTab = tablist.getByRole("tab", { name: "الملف التجاري" });
  const complianceTab = tablist.getByRole("tab", { name: "البيانات النظامية" });
  await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
  await expect(businessTab).toHaveAttribute("aria-selected", "true");
  await expect(businessTab).toHaveAttribute("aria-controls", "company-profile-business-panel");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "company-profile-business-tab");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "company-profile-business-panel");
  await attachState(page, testInfo, "business-profile");

  await businessTab.focus();
  await businessTab.press("ArrowLeft");
  await expect(complianceTab).toBeFocused();
  await expect(complianceTab).toHaveAttribute("aria-selected", "true");
  await expect(complianceTab).toHaveAttribute("aria-controls", "company-profile-compliance-panel");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "company-profile-compliance-panel");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "company-profile-compliance-tab");
  await expect(page.getByRole("heading", { name: "الهوية القانونية والتجارية والضريبية" })).toBeVisible();
  await attachState(page, testInfo, "company-compliance");

  await complianceTab.press("Home");
  await expect(businessTab).toBeFocused();
  await businessTab.press("End");
  await expect(complianceTab).toBeFocused();
  await complianceTab.press("ArrowRight");
  await expect(businessTab).toBeFocused();
  expect(traffic.requests().profile).toBeGreaterThan(0);
  expect(traffic.requests().compliance).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("partial compliance permission discovers only its authorized settings section", async ({ page }, testInfo) => {
  test.skip(!auditedProjects.has(testInfo.project.name), "Company profile visual evidence is maintained at 390 and 1440.");
  const traffic = await prepare(page, ["companies.compliance.view"]);
  await page.goto("/?qa=settings#settings");

  const tab = page.getByRole("tab", { name: "البيانات النظامية" });
  await expect(page.getByRole("tablist", { name: "ملف المنشأة" })).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "company-profile-compliance-panel");
  await expect(page.getByRole("tab", { name: "الملف التجاري" })).toHaveCount(0);
  await expect(page.locator(".currency-settings-card")).toHaveCount(0);
  await expect(page.locator(".workspace-page > .settings-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "حفظ البيانات النظامية" })).toHaveCount(0);
  expect(traffic.requests().profile).toBe(0);
  expect(traffic.requests().compliance).toBeGreaterThan(0);
  await attachState(page, testInfo, "compliance-read-only");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
