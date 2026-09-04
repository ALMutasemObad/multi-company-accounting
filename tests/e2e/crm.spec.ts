import { expect, test } from "@playwright/test";
import { authMeResponse, e2eCompany } from "./auth-me-mock.js";

const owner = { id: "813503e9-6353-4b7c-83ef-d1a2f7d15275", employeeNumber: "EMP-000014", nameAr: "نورة القحطاني", nameEn: "Noura Alqahtani" };
const leadId = "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4";

test("lead to opportunity to next action to safe customer conversion", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  let leads: Array<Record<string, unknown>> = [];
  let opportunities: Array<Record<string, unknown>> = [];
  let activities: Array<Record<string, unknown>> = [];
  const commandHeaders: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/companies") return route.fulfill({ json: { data: [e2eCompany] } });
    if (path === "/auth/me") return route.fulfill({ json: authMeResponse(["crm.view", "crm.manage", "crm.activities.manage", "crm.convert"], ["SALES", "HUMAN_RESOURCES"]) });
    if (path === "/platform/capabilities") return route.fulfill({ json: { platformOperations: false } });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (request.method() !== "GET") commandHeaders.push(request.headers()["idempotency-key"] ?? "");
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
      opportunities = [{ id: "158ce96b-a55d-45f0-9de0-96f817aab615", code: "OPP-000001", leadId, customerId: null, title: "فرصة أولى", stage: "DISCOVERY", owner, estimatedAmount: "1250.0000", currencyId: "1", probabilityBps: 3000, expectedCloseDate: null, version: 0 }];
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
  await page.evaluate(async ({ ownerId, leadPublicId }) => {
    const post = (path: string, body: object, key: string) => fetch(`/api/v1${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "e2e-csrf", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }).then((response) => { if (!response.ok) throw new Error(`CRM E2E request failed: ${response.status}`); return response.json(); });
    await post("/crm/leads", { kind: "ORGANIZATION", displayName: "شركة الرحلة", source: "MANUAL", ownerEmployeeId: ownerId }, "crm-e2e-create-lead-key");
    await post(`/crm/leads/${leadPublicId}/qualify`, { version: 0, title: "فرصة أولى", estimatedAmount: "1250.0000", currencyId: "1", probabilityBps: 3000 }, "crm-e2e-qualify-lead-key");
    await post("/crm/activities", { parentType: "OPPORTUNITY", parentId: "158ce96b-a55d-45f0-9de0-96f817aab615", type: "CALL", subject: "مكالمة متابعة", assignedEmployeeId: ownerId }, "crm-e2e-next-action-key");
    await post(`/crm/leads/${leadPublicId}/convert`, { version: 1, mode: "EXISTING", customerId: "9" }, "crm-e2e-convert-lead-key");
  }, { ownerId: owner.id, leadPublicId: leadId });
  await page.reload();
  await expect(page.locator(".crm-page")).toBeVisible();

  expect(commandHeaders).toHaveLength(4);
  expect(commandHeaders.every((value) => value.length >= 16)).toBe(true);
  await expect(page.getByText("Converted")).toBeVisible();
  await expect(page.getByText("فرصة أولى")).toBeVisible();
  await expect(page.getByText("مكالمة متابعة")).toBeVisible();
  await expect(page.locator(".crm-boundary-note")).toContainText("F2");
});
