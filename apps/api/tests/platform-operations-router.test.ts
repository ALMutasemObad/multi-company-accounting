import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { createPlatformOperationsRouter } from "../src/platform-operations/platform-operations-router.js";
import {
  PlatformBillingError,
  type PlatformBillingService,
} from "../src/platform-operations/platform-billing-service.js";
import type { PlatformOperationsService } from "../src/platform-operations/platform-operations-service.js";

function fixture() {
  const authenticate = vi.fn().mockResolvedValue({ sessionId: 2n, userId: 7n });
  const platform = {
    capabilities: vi.fn(), overview: vi.fn(), analyticsDashboard: vi.fn().mockResolvedValue({ generatedAt: "2026-08-29T00:00:00.000Z" }),
    listCompanies: vi.fn(), companyDetails: vi.fn(),
  } as unknown as PlatformOperationsService;
  const billing = {
    summary: vi.fn(), companyBilling: vi.fn(), upsertAccount: vi.fn().mockResolvedValue({ account: { id: "1" } }),
    issueInvoice: vi.fn(), recordPayment: vi.fn(), voidInvoice: vi.fn(),
  } as unknown as PlatformBillingService;
  const app = express();
  app.use(express.json());
  app.use(createPlatformOperationsRouter({ authenticate } as unknown as AuthService, platform, billing));
  app.use(((error, _request, response, _next) => {
    response.status(400).json({ code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "invalid" });
  }) satisfies ErrorRequestHandler);
  return { app, authenticate, billing, platform };
}

describe("platform operations router guards", () => {
  it("normalizes bounded billing pagination for summary and company history", async () => {
    const { app, billing } = fixture();
    vi.mocked(billing.summary).mockResolvedValue({} as never);
    vi.mocked(billing.companyBilling).mockResolvedValueOnce({} as never);

    await request(app).get("/platform/billing/summary?page=2&pageSize=25").expect(200);
    await request(app).get("/platform/companies/10/billing?page=3&pageSize=7").expect(200);
    await request(app).get("/platform/billing/summary").expect(200);

    expect(billing.summary).toHaveBeenNthCalledWith(1, 7n, { page: 2, pageSize: 25 });
    expect(billing.summary).toHaveBeenNthCalledWith(2, 7n, { page: 1, pageSize: 10 });
    expect(billing.companyBilling).toHaveBeenCalledWith(7n, 10n, { page: 3, pageSize: 7 });
  });

  it("rejects platform billing pages above the small query budget", async () => {
    const { app, billing } = fixture();

    await request(app).get("/platform/billing/summary?pageSize=26").expect(400);
    await request(app).get("/platform/companies/10/billing?page=0").expect(400);

    expect(billing.summary).not.toHaveBeenCalled();
    expect(billing.companyBilling).not.toHaveBeenCalled();
  });

  it("requires authenticated CSRF and idempotency for platform billing writes", async () => {
    const { app, authenticate, billing } = fixture();
    const response = await request(app)
      .put("/platform/companies/10/billing-account")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .set("Idempotency-Key", "platform-account-123456")
      .send({
        status: "ACTIVE", planName: "Business", billingCycle: "MONTHLY", currencyCode: "SAR",
        recurringFee: "100", includedUsers: 5, pricePerAdditionalUser: "10",
        includedEmployees: 5, pricePerAdditionalEmployee: "5", includedPostedDocuments: 100,
        pricePerAdditionalPostedDocument: "0.5", taxRate: "15", paymentTermsDays: 30, version: 0,
      });

    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({ sid: "session-token", csrfToken: "csrf-token", requireCsrf: true });
    expect(billing.upsertAccount).toHaveBeenCalledWith(7n, 10n, expect.objectContaining({
      planName: "Business", idempotencyKey: "platform-account-123456",
    }));
  });

  it("rejects a missing idempotency key before invoking a billing command", async () => {
    const { app, billing } = fixture();
    const response = await request(app)
      .put("/platform/companies/10/billing-account")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .send({
        status: "ACTIVE", planName: "Business", billingCycle: "MONTHLY", currencyCode: "SAR",
        recurringFee: "100", includedUsers: 5, pricePerAdditionalUser: "10",
        includedEmployees: 5, pricePerAdditionalEmployee: "5", includedPostedDocuments: 100,
        pricePerAdditionalPostedDocument: "0.5", taxRate: "15", paymentTermsDays: 30,
      });

    expect(response.status).toBe(400);
    expect(billing.upsertAccount).not.toHaveBeenCalled();
  });

  it("returns the stable currency-history reason as a billing business-rule violation", async () => {
    const { app, billing } = fixture();
    vi.mocked(billing.upsertAccount).mockRejectedValueOnce(
      new PlatformBillingError("CURRENCY_CHANGE_WITH_HISTORY"),
    );
    const response = await request(app)
      .put("/platform/companies/10/billing-account")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .set("Idempotency-Key", "platform-currency-change")
      .send({
        status: "ACTIVE", planName: "Business", billingCycle: "MONTHLY", currencyCode: "USD",
        recurringFee: "100", includedUsers: 5, pricePerAdditionalUser: "10",
        includedEmployees: 5, pricePerAdditionalEmployee: "5", includedPostedDocuments: 100,
        pricePerAdditionalPostedDocument: "0.5", taxRate: "15", paymentTermsDays: 30, version: 0,
      });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "BUSINESS_RULE_VIOLATION",
      reason: "CURRENCY_CHANGE_WITH_HISTORY",
    });
  });

  it("normalizes an analytics range, comparison window, and company scope", async () => {
    const { app, authenticate, platform } = fixture();
    const response = await request(app)
      .get("/platform/analytics?from=2026-08-01&to=2026-08-30&comparison=PREVIOUS_PERIOD&companyId=10")
      .set("Cookie", "sid=session-token");

    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({ sid: "session-token", csrfToken: undefined, requireCsrf: false });
    expect(platform.analyticsDashboard).toHaveBeenCalledWith(7n, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      toExclusive: new Date("2026-08-31T00:00:00.000Z"),
      comparison: "PREVIOUS_PERIOD",
      comparisonFrom: new Date("2026-07-02T00:00:00.000Z"),
      comparisonToExclusive: new Date("2026-08-01T00:00:00.000Z"),
      companyId: 10n,
    });
  });

  it("rejects invalid or overlong analytics ranges before querying the service", async () => {
    const { app, platform } = fixture();
    const invalidCalendar = await request(app).get("/platform/analytics?from=2026-02-30&to=2026-03-01");
    const overlong = await request(app).get("/platform/analytics?from=2025-01-01&to=2026-08-30");

    expect(invalidCalendar.status).toBe(400);
    expect(overlong.status).toBe(400);
    expect(platform.analyticsDashboard).not.toHaveBeenCalled();
  });
});
