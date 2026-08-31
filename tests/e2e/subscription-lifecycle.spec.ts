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
  company,
  subscription: { status: "ACTIVE", version: 3, startsAt: "2026-08-01T00:00:00.000Z", trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  current: currentChange,
  effectiveModules: [{ id: "31", code: "CORE_ACCOUNTING", displayName: "Core accounting", source: "PLAN" }],
  scheduled: null, pending: null, history: [currentChange], meta, generatedAt: "2026-08-30T00:00:00.000Z",
};

const disabledPaymentProvider = {
  available: false,
  provider: "DISABLED",
  environment: "DEVELOPMENT",
  developmentOnly: false,
} as const;

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
    if (path === "/subscription/usage") return json(route, {
      companyId: company.id, measuredAt: "2026-08-30T00:00:00.000Z", consistency: "BEST_EFFORT",
      plan: { id: plan.id, displayName: plan.displayName, billingCycle: plan.billingCycle },
      period: { kind: "STATISTICAL_MONTH_TO_DATE", timezone: "UTC", startsAt: "2026-08-01T00:00:00.000Z",
        endsAtExclusive: "2026-08-30T00:00:00.000Z", billingPeriodStatus: "NOT_CONFIGURED" },
      metrics: {
        users: { used: 1, included: 5, remaining: 4, excess: 0, state: "WITHIN_LIMIT",
          comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_COMPANY_USERS" },
        employees: { used: 1, included: 10, remaining: 9, excess: 0, state: "WITHIN_LIMIT",
          comparisonBasis: "CURRENT_SNAPSHOT", definition: "ACTIVE_OR_ON_LEAVE_EMPLOYEES" },
        postedDocuments: { used: 0, included: 100, remaining: null, excess: null, state: "UNKNOWN",
          comparisonBasis: "UNCONFIRMED_PERIOD", definition: "DOCUMENTS_POSTED_IN_WINDOW" },
      },
    });
    if (path === "/subscription/catalog") return json(route, { plans: [plan], meta });
    if (path === "/subscription/billing/invoices") return json(route, {
      provider: disabledPaymentProvider,
      items: [],
      meta: { ...meta, pageSize: 10, total: 0, totalPages: 0 },
    });
    if (path === "/subscription/billing/payments") return json(route, {
      provider: disabledPaymentProvider,
      items: [],
      meta: { ...meta, pageSize: 10, total: 0, totalPages: 0 },
    });
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
  const usage = page.getByRole("region", { name: "Subscription usage" });
  await expect(usage).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Posted documents", exact: true })).toBeVisible();
  await expect(usage.getByText("Comparison unknown", { exact: true })).toBeVisible();
  await expect(usage.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invoices and electronic payments" })).toBeVisible();
  await expect(page.getByText("Electronic payments are disabled in this environment; invoices remain visible and no card data is collected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review change", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm and send request", exact: true })).toHaveCount(0);
});

test("submits a paid owner change as a pending request without claiming payment", async ({ page }) => {
  const mocked = await mockSubscriptionApp(page, ["subscriptions.view", "subscriptions.manage"]);
  await page.goto("/#subscription?plan=21");

  await expect(page.getByText("A paid change remains pending until the payment provider proves its result; a browser return never activates it.")).toBeVisible();
  await page.getByLabel("Reporting").check();
  await page.getByRole("button", { name: "Review change", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review subscription change request" })).toBeVisible();
  expect(mocked.submitted()).toBeNull();
  const confirm = page.getByRole("button", { name: "Confirm and send request", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("I reviewed the plan, version, add-ons and displayed values and confirm submitting this request.").check();
  await confirm.click();
  await expect(page.locator('.subscription-change-recovery')).toContainText("The server confirmed a request awaiting approval, not an applied plan or a collected payment.");
  expect(mocked.submitted()).toEqual({ expectedCompanyId: company.id, targetPlanVersionId: "21", optionalModuleIds: ["32"], subscriptionVersion: 3 });
});

test("keeps the platform plan center separate and capability-gated", async ({ page }) => {
  await mockSubscriptionApp(page, [], true);
  await page.goto("/#platformSubscriptions");

  await expect(page.getByRole("heading", { name: "Platform plan & subscription center" })).toBeVisible();
  await expect(page.getByText("Database-backed search and pagination.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscription & plan" })).toHaveCount(0);
});
