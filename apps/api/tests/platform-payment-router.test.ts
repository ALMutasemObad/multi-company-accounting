import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/auth/auth-service.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import {
  createPlatformPaymentRouter,
  createPlatformPaymentWebhookHandler,
} from "../src/platform-operations/payments/platform-payment-router.js";

function fixture(allow = true) {
  const actor = { sessionId: 1n, userId: 7n, companyId: 9n };
  const authorize = vi.fn().mockImplementation(() => allow
    ? Promise.resolve(actor)
    : Promise.reject(new AuthError("FORBIDDEN")));
  const authenticate = vi.fn().mockResolvedValue({ sessionId: 1n, userId: 7n, companyId: null });
  const payments = {
    providerCapabilities: vi.fn().mockReturnValue({ available: true, provider: "DEVELOPMENT_SIMULATOR", environment: "DEVELOPMENT", developmentOnly: true }),
    listOwnerInvoices: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }),
    listOwnerPayments: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }),
    createCheckout: vi.fn().mockResolvedValue({ payment: { id: "00000000-0000-4000-8000-000000000001" } }),
    retryCheckout: vi.fn(),
    cancelCheckout: vi.fn(),
    simulateDevelopmentEvent: vi.fn(),
    listOperatorPayments: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }),
    requestFullRefund: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformPaymentRouter({ authorize, authenticate } as never, payments as never));
  app.use(((error, _request, response, _next) => {
    response.status(error instanceof AuthError ? 403 : 400).json({ code: error instanceof AuthError ? error.reason : "VALIDATION_ERROR" });
  }) satisfies ErrorRequestHandler);
  return { app, authorize, authenticate, payments };
}

describe("platform payment router authorization and query guards", () => {
  it("accepts the partial invoice filter and its strict response contract", async () => {
    const { app, payments } = fixture();
    await request(app).get("/subscription/billing/invoices?status=PARTIALLY_PAID")
      .set("Cookie", "sid=session").expect(200);
    expect(payments.listOwnerInvoices).toHaveBeenCalledWith(9n, { page: 1, pageSize: 10, status: "PARTIALLY_PAID" });
    const page = {
      provider: payments.providerCapabilities(),
      items: [{
        id: "00000000-0000-4000-8000-000000000010", invoiceNumber: "SUB-0001", status: "PARTIALLY_PAID",
        issueDate: "2051-05-01", dueDate: "2051-12-31", currencyCode: "SAR",
        totalAmount: "100.0000", paidAmount: "25.0000", refundedAmount: "0.0000", balance: "75.0000",
        version: 1, latestPaymentState: null,
      }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    expect(parseOpenApiResponseBody("listCompanySubscriptionBillingInvoices", 200, page)).toEqual(page);
  });

  it("scopes owner reads to the authorized company and bounds database pagination", async () => {
    const { app, authorize, payments } = fixture();
    await request(app).get("/subscription/billing/invoices?page=2&pageSize=25&status=OVERDUE")
      .set("Cookie", "sid=session").expect(200);
    await request(app).get("/subscription/billing/payments?page=3&pageSize=7&state=FAILED")
      .set("Cookie", "sid=session").expect(200);
    await request(app).get("/subscription/billing/invoices?pageSize=26").expect(400);

    expect(authorize.mock.calls.map(([input]) => [input.permission, input.requireCsrf])).toEqual([
      ["subscriptions.view", false],
      ["subscriptions.view", false],
      ["subscriptions.view", false],
    ]);
    expect(payments.listOwnerInvoices).toHaveBeenCalledWith(9n, { page: 2, pageSize: 25, status: "OVERDUE" });
    expect(payments.listOwnerPayments).toHaveBeenCalledWith(9n, { page: 3, pageSize: 7, state: "FAILED" });
    expect(payments.listOwnerInvoices).toHaveBeenCalledTimes(1);
  });

  it("requires manage permission, CSRF, version and Idempotency-Key for checkout", async () => {
    const { app, authorize, payments } = fixture();
    const invoiceId = "00000000-0000-4000-8000-000000000010";
    await request(app).post(`/subscription/billing/invoices/${invoiceId}/checkout`)
      .set("Cookie", "sid=session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "checkout-request-0001")
      .send({ invoiceVersion: 4 })
      .expect(201);
    await request(app).post(`/subscription/billing/invoices/${invoiceId}/checkout`)
      .set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .send({ invoiceVersion: 4 })
      .expect(400);

    expect(authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({
      permission: "subscriptions.manage", requireCsrf: true, csrfToken: "csrf",
    }));
    expect(payments.createCheckout).toHaveBeenCalledTimes(1);
    expect(payments.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7n, companyId: 9n }),
      invoiceId,
      { invoiceVersion: 4, idempotencyKey: "checkout-request-0001" },
    );
  });

  it("does not let a missing tenant permission reach payment data", async () => {
    const { app, payments } = fixture(false);
    await request(app).get("/subscription/billing/payments").set("Cookie", "sid=session").expect(403);
    expect(payments.listOwnerPayments).not.toHaveBeenCalled();
  });

  it("passes only the authenticated global user and explicit filters to the operator list", async () => {
    const { app, authenticate, payments } = fixture();
    await request(app).get("/platform/electronic-payments?companyId=12&state=PAID&page=2&pageSize=10")
      .set("Cookie", "sid=session").expect(200);
    expect(authenticate).toHaveBeenCalledWith({ sid: "session", csrfToken: undefined, requireCsrf: false });
    expect(payments.listOperatorPayments).toHaveBeenCalledWith(7n, {
      companyId: 12n, state: "PAID", page: 2, pageSize: 10,
    });
  });
});

describe("platform payment webhook transport", () => {
  it("preserves exact raw JSON bytes and signature for verification", async () => {
    const handleWebhook = vi.fn().mockResolvedValue({ accepted: true, duplicate: false, result: "PAYMENT_PAID" });
    const app = express();
    app.post("/webhooks/:providerCode", express.raw({ type: "application/json" }), createPlatformPaymentWebhookHandler({ handleWebhook } as never));
    const raw = Buffer.from('{"id":"evt_1", "exactSpacing":true}');
    await request(app).post("/webhooks/development_simulator")
      .set("Content-Type", "application/json")
      .set("X-Platform-Payment-Signature", "t=1,v1=abc")
      .send(raw.toString("utf8"))
      .expect(202);

    expect(handleWebhook).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: "development_simulator",
      signature: "t=1,v1=abc",
      rawBody: expect.any(Buffer),
    }));
    expect(Buffer.from(handleWebhook.mock.calls[0]![0].rawBody).equals(raw)).toBe(true);
  });
});
