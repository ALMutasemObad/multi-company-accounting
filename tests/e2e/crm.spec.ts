import { expect, test } from "@playwright/test";
import { authMeResponse, e2eCompany } from "./auth-me-mock.js";

const owner = { id: "813503e9-6353-4b7c-83ef-d1a2f7d15275", employeeNumber: "EMP-000014", nameAr: "نورة القحطاني", nameEn: "Noura Alqahtani" };
const leadId = "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4";
const opportunityId = "158ce96b-a55d-45f0-9de0-96f817aab615";

for (const viewport of [{ name: "mobile-390", width: 390, height: 844 }, { name: "desktop-1440", width: 1440, height: 900 }]) {
  test(`lead to opportunity to activity to customer through the UI · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => localStorage.setItem("mcap.locale", "ar"));
    let leads: Array<Record<string, unknown>> = [];
    let opportunities: Array<Record<string, unknown>> = [];
    let activities: Array<Record<string, unknown>> = [];
    const commands: Array<{ path: string; key: string }> = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v1", "");
      if (path === "/auth/companies") return route.fulfill({ json: { data: [e2eCompany] } });
      if (path === "/auth/me") return route.fulfill({ json: authMeResponse(["crm.view", "crm.manage", "crm.activities.manage", "crm.convert"], ["SALES", "HUMAN_RESOURCES"]) });
      if (path === "/platform/capabilities") return route.fulfill({ json: { platformOperations: false } });
      if (path === "/organizations/workspaces") return route.fulfill({ json: { data: [] } });
      if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
      if (request.method() !== "GET") commands.push({ path, key: request.headers()["idempotency-key"] ?? "" });
      if (path === "/crm/options") return route.fulfill({ json: { owners: [owner], currencies: [{ id: "1", code: "SAR", nameAr: "ريال سعودي", decimals: 2 }], customers: [{ id: "9", code: "CUS-000009", nameAr: "شركة قائمة", nameEn: "Existing Co" }] } });
      if (path === "/crm/pipeline") return route.fulfill({ json: { data: opportunities.map(() => ({ stage: "DISCOVERY", currencyId: "1", opportunityCount: 1, estimatedAmount: "1250.0000", weightedAmount: "375.0000" })) } });
      if (path === "/crm/leads" && request.method() === "GET") return route.fulfill({ json: { data: leads, meta: { page: 1, pageSize: 8, total: leads.length, totalPages: leads.length ? 1 : 0 } } });
      if (path === "/crm/leads" && request.method() === "POST") {
        const body = request.postDataJSON();
        leads = [{ id: leadId, code: "LED-000001", ...body, status: "NEW", owner, phone: null, email: null, version: 0 }];
        return route.fulfill({ status: 201, json: { lead: leads[0] } });
      }
      if (path.endsWith("/qualify")) {
        leads = leads.map((lead) => ({ ...lead, status: "QUALIFIED", version: 1 }));
        opportunities = [{ id: opportunityId, code: "OPP-000001", leadId, customerId: null, title: "فرصة أولى", stage: "DISCOVERY", owner, estimatedAmount: "1250.0000", currencyId: "1", probabilityBps: 3000, expectedCloseDate: null, version: 0 }];
        return route.fulfill({ status: 201, json: { opportunity: opportunities[0] } });
      }
      if (path === "/crm/opportunities") return route.fulfill({ json: { data: opportunities, meta: { page: 1, pageSize: 8, total: opportunities.length, totalPages: opportunities.length ? 1 : 0 } } });
      if (path === "/crm/activities" && request.method() === "GET") return route.fulfill({ json: { data: activities, meta: { page: 1, pageSize: 8, total: activities.length, totalPages: activities.length ? 1 : 0 } } });
      if (path === "/crm/activities" && request.method() === "POST") {
        const body = request.postDataJSON();
        activities = [{ id: "1178507b-fddf-40d7-8e66-7e08a8c00e65", ...body, assignee: owner, status: "OPEN", version: 0 }];
        return route.fulfill({ status: 201, json: { activity: activities[0] } });
      }
      if (path.endsWith("/convert")) {
        leads = leads.map((lead) => ({ ...lead, status: "CONVERTED", version: 2 }));
        return route.fulfill({ json: { leadId, customerId: "9" } });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#crm");
    await expect(page.locator(".crm-page")).toBeVisible();
    await page.getByRole("button", { name: "عميل محتمل جديد", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator('[name="displayName"]').fill("شركة الرحلة");
    await dialog.locator('[name="ownerEmployeeId"]').selectOption(owner.id);
    await dialog.getByRole("button", { name: "إنشاء", exact: true }).click();
    const lead = page.locator(".crm-record").filter({ hasText: "شركة الرحلة" });
    await expect(lead).toContainText("جديد");

    await lead.getByRole("button", { name: "تأهيل", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator('[name="title"]').fill("فرصة أولى");
    await dialog.locator('[name="estimatedAmount"]').fill("1250.0000");
    await dialog.locator('[name="currencyId"]').selectOption("1");
    await dialog.getByRole("button", { name: "تأهيل", exact: true }).click();
    const opportunity = page.locator(".crm-record.opportunity").filter({ hasText: "فرصة أولى" });
    await expect(opportunity).toBeVisible();

    await opportunity.getByRole("button", { name: "إضافة متابعة", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator('[name="assignedEmployeeId"]').selectOption(owner.id);
    await dialog.locator('[name="subject"]').fill("مكالمة متابعة");
    await dialog.getByRole("button", { name: "إضافة متابعة", exact: true }).click();
    await expect(page.locator(".crm-activity").filter({ hasText: "مكالمة متابعة" })).toBeVisible();

    await lead.getByRole("button", { name: "تحويل إلى عميل", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator('[name="customerId"]').selectOption("9");
    await dialog.getByRole("button", { name: "تحويل إلى عميل", exact: true }).click();
    await expect(lead).toContainText("محوّل");

    expect(commands.map(({ path }) => path)).toEqual([
      "/crm/leads",
      `/crm/leads/${leadId}/qualify`,
      "/crm/activities",
      `/crm/leads/${leadId}/convert`,
    ]);
    expect(commands.every(({ key }) => key.length >= 16)).toBe(true);
    await expect(page.locator(".crm-boundary-note")).toContainText("F2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
