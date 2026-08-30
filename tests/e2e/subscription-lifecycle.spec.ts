import { expect, test, type Page, type Route } from "@playwright/test";

const company = { id: "1", name: "North Star Services", timezone: "Asia/Riyadh" };
const meta = { page: 1, pageSize: 20, total: 1, totalPages: 1 };
const plan = {
  id: "21", planId: "11", planCode: "BASIC_REVIEW", versionNumber: 1,
  displayName: "Basic review", description: "A configured paid plan", billingCycle: "MONTHLY",
  currencyCode: "SAR", recurringFee: "100.0000",
  includedUsers: 5, pricePerAdditionalUser: "10.0000",
  includedEmployees: 10, pricePerAdditionalEmployee: null,
  includedPostedDocuments: 100, pricePerAdditionalPostedDocument: null,
  taxRate: "0.0000", paymentTermsDays: 0, trialDays: 0,
  effectiveFrom: "2026-08-01T00:00:00.000Z", selfServicePolicy: "REQUEST_ONLY",
  publicationStatus: "PUBLISHED", publishedAt: "2026-08-01T00:00:00.000Z", retiredAt: null,
  version: 2,
  modules: [
    { id: "31", code: "CORE_ACCOUNTING", displayName: "Core accounting", active: true, selectionMode: "INCLUDED", additionalRecurringFee: null, dependencyIds: [] },
    { id: "32", code: "REPORTING", displayName: "Reporting", active: true, selectionMode: "OPTIONAL", additionalRecurringFee: "20.0000", dependencyIds: ["31"] },
  ],
} as const;

const currentChange = {
  id: "9c2cc170-6f32-4eca-9f51-5423428b0f0f", state: "APPROVED", source: "MIGRATION",
  requestedAt: "2026-08-01T00:00:00.000Z", effectiveAt: "2026-08-01T00:00:00.000Z",
  decidedAt: "2026-08-01T00:00:00.000Z", decisionReason: null,
  quote: { currencyCode: "SAR", baseRecurringFee: "100.0000", optionalRecurringFee: "0.0000", totalRecurringFee: "100.0000" },
  plan, modules: [{ id: "31", code: "CORE_ACCOUNTING", displayName: "Core accounting", selectionMode: "INCLUDED" }],
};

const snapshot = {
  subscription: { status: "ACTIVE", version: 3, startsAt: "2026-08-01T00:00:00.000Z", trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  current: currentChange,
  effectiveModules: [{ id: "31", code: "CORE_ACCOUNTING", displayName: "Core accounting", source: "PLAN" }],
  scheduled: null, pending: null, history: [currentChange], meta, generatedAt: "2026-08-30T00:00:00.000Z",
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockSubscriptionApp(page: Page, permissions: string[], platformOperations = false) {
  let submittedBody: unknown = null;
  await page.addInitScript(() => localStorage.setItem("mcap.locale", "en"));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/u, "");
    if (path === "/auth/companies") return json(route, { data: [company] });
    if (path === "/auth/me") return json(route, {
      user: { id: "1", displayName: "E2E Operator" }, selectedCompany: company,
      modules: [], permissions,
    });
    if (path === "/auth/context") return route.fulfill({ status: 204, body: "" });
    if (path === "/platform/capabilities") return json(route, { platformOperations });
    if (path === "/subscription" && request.method() === "GET") return json(route, snapshot);
    if (path === "/subscription/catalog") return json(route, { plans: [plan], meta });
    if (path === "/subscription/change-requests" && request.method() === "POST") {
      submittedBody = request.postDataJSON();
      return json(route, { change: { state: "PENDING_APPROVAL" }, subscriptionVersion: 4, paymentCollected: false }, 201);
    }
    if (path === "/platform/subscription-modules") return json(route, { modules: [] });
    if (path === "/platform/subscription-plans") return json(route, {
      plans: [{ id: "11", code: "BASIC_REVIEW", active: true, version: 0, latestVersion: plan, updatedAt: "2026-08-30T00:00:00.000Z" }], meta,
    });
    if (path === "/platform/subscriptions") return json(route, { subscriptions: [], meta: { ...meta, total: 0, totalPages: 0 } });
    if (request.method() === "GET") return json(route, { data: [], meta: { ...meta, total: 0, totalPages: 0 } });
    return route.fulfill({ status: 204, body: "" });
  });
  return { submitted: () => submittedBody };
}

test("keeps the subscription page reachable without business modules and hides management without permission", async ({ page }) => {
  await mockSubscriptionApp(page, ["subscriptions.view"]);
  await page.goto("/#subscription");

  await expect(page.getByRole("heading", { name: "Subscription & plan" })).toBeVisible();
  await expect(page.getByText("Basic review").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Included limits" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit change request" })).toHaveCount(0);
});

test("submits a paid owner change as a pending request without claiming payment", async ({ page }) => {
  const mocked = await mockSubscriptionApp(page, ["subscriptions.view", "subscriptions.manage"]);
  await page.goto("/#subscription");

  await expect(page.getByText("Any paid change becomes a pending request; this flow makes no electronic-payment claim.")).toBeVisible();
  await page.getByLabel("Reporting").check();
  await page.getByRole("button", { name: "Submit change request" }).click();
  await expect(page.getByText("The request was stored safely and is awaiting approval.")).toBeVisible();
  expect(mocked.submitted()).toEqual({ targetPlanVersionId: "21", optionalModuleIds: ["32"], subscriptionVersion: 3 });
});

test("keeps the platform plan center separate and capability-gated", async ({ page }) => {
  await mockSubscriptionApp(page, [], true);
  await page.goto("/#platformSubscriptions");

  await expect(page.getByRole("heading", { name: "Platform plan & subscription center" })).toBeVisible();
  await expect(page.getByText("Database-backed search and pagination.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscription & plan" })).toHaveCount(0);
});
