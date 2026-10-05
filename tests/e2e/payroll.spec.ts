import { randomUUID } from "node:crypto";
import { hash } from "argon2";
import { expect, test, type Page } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/database.js";

test("prepares private payroll and obtains a separate owner approval through the real UI", async ({ browser }) => {
  test.skip(process.env.E2E_PAYROLL_DB !== "true", "Requires isolated local payroll database");
  const url = new URL(process.env.DATABASE_URL!);
  expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
  expect(url.pathname).toBe("/juwar_gpm_acceptance2_20261005");
  const db = createDatabase(url.toString());
  const suffix = randomUUID(), password = `Payroll-test-${randomUUID()}!`;
  const ownerEmail = `payroll-owner-${suffix}@example.test`, makerEmail = `payroll-maker-${suffix}@example.test`;
  try {
    const organization = await db.organization.create({ data: { name: `E2E payroll ${suffix}` } });
    const currency = await db.currency.findUniqueOrThrow({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: "SAR" } } });
    const company = await db.company.create({ data: { organizationId: organization.id, baseCurrencyId: currency.id, name: `E2E payroll ${suffix}`, timezone: "Asia/Riyadh" } });
    const passwordHash = await hash(password);
    const owner = await db.user.create({ data: { emailNormalized: ownerEmail, displayName: "Payroll owner", passwordHash } });
    const maker = await db.user.create({ data: { emailNormalized: makerEmail, displayName: "Payroll preparer", passwordHash } });
    await db.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const role = await db.role.create({ data: { companyId: company.id, code: "PAYROLL_TEST", nameAr: "اختبار الرواتب" } });
    const permissions = await db.permission.findMany({ where: { code: { in: ["payroll.view", "payroll.runs.manage", "payroll.agreements.manage", "approvals.view", "approvals.decide"] } } });
    await db.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: role.id, permissionId: permission.id })) });
    for (const user of [owner, maker]) {
      await db.userCompany.create({ data: { companyId: company.id, userId: user.id } });
      await db.userCompanyRole.create({ data: { companyId: company.id, userId: user.id, roleId: role.id } });
    }
    await db.platformModule.update({ where: { code: "PAYROLL" }, data: { isActive: true } });
    const template = await db.platformSubscription.findFirstOrThrow({ where: { companyId: 1n } });
    const subscription = await db.platformSubscription.create({ data: { companyId: company.id, planVersionId: template.planVersionId, startsAt: new Date("2026-01-01Z") } });
    const modules = await db.platformModule.findMany({ where: { isActive: true } });
    await db.platformSubscriptionEntitlement.createMany({ data: modules.map(module => ({ companyId: company.id, subscriptionId: subscription.id, moduleId: module.id,
      source: "PLAN" as const, effectiveFrom: new Date("2026-01-01Z"), reason: "Isolated payroll browser fixture" })) });
    await db.employee.create({ data: { companyId: company.id, employeeNumber: "PAYROLL-E2E", nameAr: "موظف اختبار المسير", employmentType: "FULL_TIME",
      hireDate: new Date("2026-01-01Z"), createdById: owner.id, updatedById: owner.id } });
    const ownerContext = await browser.newContext(), makerContext = await browser.newContext();
    try {
      async function login(page: Page, email: string) {
        await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
        await page.goto("/");
        const login = page.locator(".login-card");
        await login.locator('[name="email"]').fill(email);
        await login.locator('[name="password"]').fill(password);
        await login.getByRole("button", { name: "Secure sign in" }).click();
        await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
        await page.goto("/#payroll");
        await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
      }
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, ownerEmail);
      await ownerPage.getByRole("combobox", { name: /^Employee/ }).selectOption({ label: "PAYROLL-E2E — موظف اختبار المسير" });
      await ownerPage.getByLabel("Effective from", { exact: true }).fill("2026-01-01");
      await ownerPage.getByLabel("Basic salary (SAR)").fill("7123.45");
      await ownerPage.getByLabel("Fixed allowance (optional)", { exact: true }).fill("200.10");
      const agreementKeys: string[] = [];
      await ownerPage.route("**/api/v1/payroll/agreements", async route => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        agreementKeys.push(route.request().headers()["idempotency-key"]!);
        if (agreementKeys.length === 1) { await route.fetch(); await route.abort("failed"); }
        else await route.continue();
      });
      await ownerPage.getByRole("button", { name: "Save agreement", exact: true }).click();
      await ownerPage.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(ownerPage.getByRole("table").first()).toContainText("7,123.45");
      expect(agreementKeys).toHaveLength(2);
      expect(agreementKeys[0]).toBe(agreementKeys[1]);
      expect(await db.payrollPayAgreement.count({ where: { companyId: company.id } })).toBe(1);
      const makerPage = await makerContext.newPage();
      await login(makerPage, makerEmail);
      expect((await makerPage.request.get("/api/v1/payroll/agreements")).status()).toBe(403);
      expect((await makerPage.request.post("/api/v1/payroll/runs", { data: { periodStart: "2026-08-01", periodEndExclusive: "2026-09-01" }, headers: { "Idempotency-Key": randomUUID() } })).status()).toBe(403);
      await expect(makerPage.getByRole("heading", { name: "Add salary agreement" })).toHaveCount(0);
      await makerPage.getByLabel("Month", { exact: true }).fill("2026-09");
      await makerPage.getByRole("button", { name: "Create monthly run", exact: true }).click();
      await makerPage.getByRole("button", { name: "Calculate", exact: true }).click();
      await expect(makerPage.getByRole("button", { name: "Submit for approval" })).toBeVisible();
      await expect(makerPage.locator("body")).not.toContainText("7,123.45");
      await expect(makerPage.locator("body")).not.toContainText("7,323.55");
      await makerPage.getByRole("button", { name: "Submit for approval" }).click();
      await expect(makerPage.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
      await expect(makerPage.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      const savedRun = await db.payrollRun.findFirstOrThrow({ where: { companyId: company.id } });
      const inboxPage = await ownerContext.newPage();
      await inboxPage.goto("/#approvals");
      const inboxRow = inboxPage.getByRole("row").filter({ hasText: savedRun.publicId });
      await expect(inboxRow).toContainText("Payroll");
      await expect(inboxRow.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(inboxRow.getByRole("link", { name: "Open run", exact: true })).toBeVisible();
      await inboxPage.close();
      await ownerPage.getByRole("button", { name: "Refresh", exact: true }).click();
      await ownerPage.getByRole("button", { name: "Open run", exact: true }).click();
      await expect(ownerPage.locator("body")).toContainText("7,323.55");
      await ownerPage.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(ownerPage.getByText("Approved", { exact: true }).first()).toBeVisible();
      await makerPage.reload();
      await expect(makerPage.getByText("Approved", { exact: true }).first()).toBeVisible();
      await expect(makerPage.locator("body")).not.toContainText("7,323.55");
      await ownerPage.getByLabel("Ends before (date excluded)", { exact: true }).fill("2026-10-01");
      await ownerPage.getByRole("button", { name: "Save end date", exact: true }).click();
      await expect(ownerPage.getByRole("table").first()).toContainText("2026-10-01");
      await ownerPage.evaluate(() => localStorage.setItem("mcap.locale", "ar"));
      // Override the English fixture initializer for subsequent navigation.
      await ownerPage.addInitScript(() => localStorage.setItem("mcap.locale", "ar"));
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await ownerPage.reload();
      await expect(ownerPage.getByRole("heading", { name: "مسير الرواتب", exact: true })).toBeVisible();
      await expect(ownerPage.locator("html")).toHaveAttribute("dir", "rtl");
      await expect.poll(() => ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await ownerPage.screenshot({ path: "test-results/payroll-ar-mobile.png", fullPage: true });
    } finally { await ownerContext.close(); await makerContext.close(); }
    // Preserve this uniquely named isolated fixture as reproducible acceptance evidence.
  } finally { await db.$disconnect(); }
});
