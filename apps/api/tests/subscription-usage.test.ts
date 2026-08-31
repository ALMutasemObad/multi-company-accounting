import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../src/auth/auth-service.js";
import { SubscriptionUsageService, subscriptionUsageMetric } from "../src/platform-subscriptions/subscription-usage-service.js";
import type { SubscriptionUsagePlan } from "../src/platform-subscriptions/subscription-usage-ports.js";
import { createSubscriptionUsageRouter } from "../src/platform-subscriptions/subscription-usage-router.js";
import { createSubscriptionUsageService } from "../src/composition/create-subscription-usage-service.js";
import { PrismaPlatformAnalyticsQueryAdapter } from "../src/platform-operations/prisma-platform-analytics-query-adapter.js";

const referenceTime = new Date("2026-08-31T21:00:00.000Z");
const plan: SubscriptionUsagePlan = {
  id: "12", displayName: "Test plan", billingCycle: "ANNUAL", includedUsers: 5,
  includedEmployees: 0, includedPostedDocuments: 100, billingPeriodStatus: "NOT_CONFIGURED",
};

function fixture(asOf = referenceTime, currentPlan: SubscriptionUsagePlan | null = plan) {
  const measure = vi.fn().mockResolvedValue({ users: 7, employees: 0, postedDocuments: 101 });
  const plans = { currentPlan: vi.fn().mockResolvedValue(currentPlan) };
  const service = new SubscriptionUsageService({ measure }, plans, () => asOf);
  return { service, measure, plans };
}

describe("subscription usage semantics", () => {
  it("compares instantaneous counts, including zero caps, without converting an annual document quota", async () => {
    const { service, measure } = fixture();
    const result = await service.companyUsage(9n);
    expect(result.metrics.users).toMatchObject({ used: 7, included: 5, remaining: 0, excess: 2, state: "EXCEEDED" });
    expect(result.metrics.employees).toMatchObject({ used: 0, included: 0, remaining: 0, excess: 0, state: "AT_LIMIT" });
    expect(result.metrics.postedDocuments).toMatchObject({ used: 101, included: 100, remaining: null, excess: null, state: "UNKNOWN" });
    expect(result.period).toEqual({ kind: "STATISTICAL_MONTH_TO_DATE", timezone: "UTC", startsAt: "2026-08-01T00:00:00.000Z", endsAtExclusive: referenceTime.toISOString(), billingPeriodStatus: "NOT_CONFIGURED" });
    expect(measure).toHaveBeenCalledExactlyOnceWith({ companyId: 9n, periodStart: new Date("2026-08-01T00:00:00Z"), periodEndExclusive: referenceTime });
  });

  it.each([
    ["2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
    ["2026-08-31T23:59:59.999Z", "2026-08-01T00:00:00.000Z"],
    ["2024-02-29T23:59:59.999Z", "2024-02-01T00:00:00.000Z"],
    ["2027-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ])("uses UTC month boundaries at %s, never company/browser timezone", async (asOf, startsAt) => {
    const result = await fixture(new Date(asOf)).service.companyUsage(9n);
    expect(result.period.startsAt).toBe(startsAt);
    expect(result.period.endsAtExclusive).toBe(asOf);
  });

  it("preserves Legacy/missing quota as unconfigured, and unavailable measurements as unknown", async () => {
    const result = await fixture(referenceTime, null).service.companyUsage(9n);
    expect(result.plan).toBeNull();
    expect(result.metrics.users).toMatchObject({ used: 7, included: null, state: "NOT_CONFIGURED" });
    for (const value of [null, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(subscriptionUsageMetric(value, 5, "CURRENT_SNAPSHOT", "ACTIVE_COMPANY_USERS"))
        .toMatchObject({ used: null, remaining: null, excess: null, state: "UNKNOWN" });
    }
    expect(subscriptionUsageMetric(2, 5, "CURRENT_SNAPSHOT", "ACTIVE_COMPANY_USERS"))
      .toMatchObject({ remaining: 3, excess: 0, state: "WITHIN_LIMIT" });
  });

  it.each(["MONTHLY", "QUARTERLY", "ANNUAL"] as const)("does not infer a billing period from %s or populated dates", async (billingCycle) => {
    const result = await fixture(referenceTime, { ...plan, billingCycle, billingPeriodStatus: "UNCONFIRMED" }).service.companyUsage(9n);
    expect(result.period.kind).toBe("STATISTICAL_MONTH_TO_DATE");
    expect(result.metrics.postedDocuments.state).toBe("UNKNOWN");
  });

  it("does not turn provider failures or missing companies into zero usage", async () => {
    const { service, measure } = fixture();
    measure.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("db unavailable"));
    await expect(service.companyUsage(9n)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.companyUsage(9n)).rejects.toThrow("db unavailable");
    await expect(service.companyUsage(0n)).rejects.toMatchObject({ reason: "FORBIDDEN" });
    expect(measure).toHaveBeenCalledTimes(2);
  });
});

describe("subscription usage authorized read-only router", () => {
  function routerFixture(companyId = 9n) {
    const { service, measure, plans } = fixture();
    const authorize = vi.fn().mockResolvedValue({ sessionId: 1n, userId: 7n, companyId });
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createSubscriptionUsageRouter({ authorize }, service));
    app.use(((error, _request, response, _next) => {
      const status = error instanceof AuthError ? error.reason === "UNAUTHENTICATED" ? 401 : 403 : 400;
      response.status(status).json({ code: error instanceof AuthError ? error.reason : "VALIDATION_ERROR" });
    }) satisfies ErrorRequestHandler);
    return { app, authorize, measure, plans };
  }
  it("authorizes subscriptions.view before querying and scopes company solely from the session", async () => {
    const { app, authorize, measure, plans } = routerFixture(123n);
    const result = await request(app).get("/api/v1/subscription/usage").set("Cookie", "other=x; sid=session; after=y").expect(200);
    expect(authorize).toHaveBeenCalledExactlyOnceWith({ sid: "session", permission: "subscriptions.view", requireCsrf: false });
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(measure.mock.invocationCallOrder[0]!);
    expect(measure.mock.calls[0]?.[0].companyId).toBe(123n);
    expect(plans.currentPlan).toHaveBeenCalledWith(123n, referenceTime);
    expect(result.body.companyId).toBe("123");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(result.body.metrics)).toEqual(["users", "employees", "postedDocuments"]);
    expect(JSON.stringify(result.body)).not.toMatch(/operations|email|userId|employeeId/);
  });
  it.each(["UNAUTHENTICATED", "FORBIDDEN"] as const)("rejects %s before ALL database reads", async (reason) => {
    const { app, authorize, measure, plans } = routerFixture();
    authorize.mockRejectedValue(new AuthError(reason));
    const result = await request(app).get("/api/v1/subscription/usage").expect(reason === "UNAUTHENTICATED" ? 401 : 403);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(measure).not.toHaveBeenCalled();
    expect(plans.currentPlan).not.toHaveBeenCalled();
  });
  it("rejects company overrides and arbitrary periods, with no writable endpoint", async () => {
    const { app, measure } = routerFixture();
    for (const query of ["companyId=10", "periodStart=2020-01-01", "page=1", "companyId=9&companyId=10"]) {
      await request(app).get(`/api/v1/subscription/usage?${query}`).expect(400);
    }
    await request(app).post("/api/v1/subscription/usage").send({ companyId: "10" }).expect(404);
    expect(measure).not.toHaveBeenCalled();
    await request(routerFixture(0n).app).get("/api/v1/subscription/usage").expect(403);
  });
  it("allows safe repeated GETs and returns 404 for a vanished company", async () => {
    const { app, measure } = routerFixture();
    await request(app).get("/api/v1/subscription/usage").expect(200);
    await request(app).get("/api/v1/subscription/usage").expect(200);
    measure.mockResolvedValueOnce(null);
    await request(app).get("/api/v1/subscription/usage").expect(404);
    expect(measure).toHaveBeenCalledTimes(3);
  });
});

describe("composition reuses billing aggregates without loading domain rows", () => {
  it("passes the same scoped range to count queries and handles huge populations with constant result size", async () => {
    const count = 4_000_000_000;
    const userCompany = { count: vi.fn().mockResolvedValue(count) };
    const employee = { count: vi.fn().mockResolvedValue(count) };
    const accountingDocument = { count: vi.fn().mockResolvedValue(count) };
    const auditLog = { count: vi.fn().mockResolvedValue(count) };
    const current = { ...plan, id: 12n };
    const platformSubscription = { findUnique: vi.fn().mockResolvedValue({ id: 8n, currentPeriodStart: null, currentPeriodEnd: null, planVersion: current }) };
    const platformSubscriptionChange = { findFirst: vi.fn().mockResolvedValue({ targetPlanVersion: { ...current, id: 13n, includedUsers: 3 } }) };
    const prisma = { company: { findUnique: vi.fn().mockResolvedValue({ id: 9n }) }, userCompany, employee, accountingDocument, auditLog, platformSubscription, platformSubscriptionChange } as unknown as PrismaClient;
    const service = createSubscriptionUsageService(prisma, new PrismaPlatformAnalyticsQueryAdapter(prisma), () => referenceTime);
    const result = await service.companyUsage(9n);
    expect(result.metrics.users).toMatchObject({ used: count, included: 3, excess: count - 3 });
    expect(result.plan?.id).toBe("13");
    expect(userCompany.count).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 9n, isActive: true, user: { isActive: true } } });
    expect(employee.count).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 9n, status: { in: ["ACTIVE", "ON_LEAVE"] } } });
    const range = { gte: new Date("2026-08-01T00:00:00Z"), lt: referenceTime };
    expect(accountingDocument.count).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 9n, postedAt: range } });
    expect(auditLog.count).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 9n, createdAt: range } });
    expect(platformSubscription.findUnique.mock.calls[0]?.[0].where).toEqual({ companyId: 9n });
    expect(platformSubscriptionChange.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { companyId: 9n, subscriptionId: 8n, state: "APPROVED", effectiveAt: { lte: referenceTime } }, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }] });
    expect(JSON.stringify(result).length).toBeLessThan(1800);
  });
});
