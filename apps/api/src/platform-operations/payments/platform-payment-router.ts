import { Router, type ErrorRequestHandler, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthService } from "../../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../../generated/openapi-request-guards.js";
import {
  PLATFORM_PAYMENT_DEFAULT_PAGE_SIZE,
  PLATFORM_PAYMENT_MAX_PAGE_SIZE,
  PlatformPaymentError,
  type PlatformPaymentService,
} from "./platform-payment-service.js";

const publicId = z.string().uuid();
const companyId = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const state = z.enum(["CHECKOUT", "PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"]);
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PLATFORM_PAYMENT_MAX_PAGE_SIZE).default(PLATFORM_PAYMENT_DEFAULT_PAGE_SIZE),
});
const invoiceListQuery = pagination.extend({
  status: z.enum(["ALL", "ISSUED", "PAID", "OVERDUE", "VOID"]).default("ALL"),
});
const paymentListQuery = pagination.extend({ state: state.or(z.literal("ALL")).default("ALL") });
const operatorPaymentListQuery = paymentListQuery.extend({ companyId: companyId.optional() });
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));

function sid(request: Request) {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

function paymentProblem(error: PlatformPaymentError) {
  const status = error.reason === "NOT_FOUND" ? 404
    : error.reason === "FORBIDDEN" ? 403
      : error.reason === "WEBHOOK_VERIFICATION_FAILED" ? 401
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "PAYMENT_ALREADY_IN_PROGRESS", "WEBHOOK_REPLAY_MISMATCH"].includes(error.reason) ? 409
          : error.reason === "PROVIDER_UNAVAILABLE" ? 503 : 422;
  return {
    status,
    body: {
      type: "about:blank",
      title: status === 404 ? "Platform payment resource not found"
        : status === 401 ? "Payment webhook verification failed"
          : status === 503 ? "Payment provider unavailable" : "Platform payment business rule violation",
      status,
      code: status === 409 ? "CONFLICT"
        : status === 503 ? "PROVIDER_UNAVAILABLE"
          : status === 422 ? "BUSINESS_RULE_VIOLATION" : error.reason,
      reason: error.reason,
    },
  };
}

export function createPlatformPaymentRouter(auth: AuthService, payments: PlatformPaymentService) {
  const router = Router();
  const companyActor = (request: Request, permission: "subscriptions.view" | "subscriptions.manage", requireCsrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf,
    });
  const platformActor = (request: Request, requireCsrf = false) => auth.authenticate({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    requireCsrf,
  });

  router.get("/subscription/billing/payment-provider", async (request, response) => {
    await companyActor(request, "subscriptions.view", false);
    response.json(payments.providerCapabilities());
  });

  router.get("/subscription/billing/invoices", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.view", false);
    response.json(await payments.listOwnerInvoices(actor.companyId, invoiceListQuery.parse(request.query)));
  });

  router.get("/subscription/billing/payments", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.view", false);
    response.json(await payments.listOwnerPayments(actor.companyId, paymentListQuery.parse(request.query)));
  });

  router.post("/subscription/billing/invoices/:invoiceId/checkout", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.manage", true);
    response.status(201).json(await payments.createCheckout(
      actor,
      publicId.parse(request.params.invoiceId),
      { ...bodies.createPlatformPaymentCheckout.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  router.post("/subscription/billing/payments/:paymentId/retry", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.manage", true);
    response.status(201).json(await payments.retryCheckout(
      actor,
      publicId.parse(request.params.paymentId),
      { ...bodies.retryPlatformPaymentCheckout.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  router.post("/subscription/billing/payments/:paymentId/cancel", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.manage", true);
    response.json(await payments.cancelCheckout(
      actor,
      publicId.parse(request.params.paymentId),
      { ...bodies.cancelPlatformPaymentCheckout.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  router.post("/subscription/billing/payments/:paymentId/simulate", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.manage", true);
    const body = bodies.simulatePlatformPaymentEvent.parse(request.body);
    response.status(202).json(await payments.simulateDevelopmentEvent(
      actor,
      publicId.parse(request.params.paymentId),
      body.eventType,
    ));
  });

  router.get("/platform/electronic-payments", async (request, response) => {
    const actor = await platformActor(request);
    response.json(await payments.listOperatorPayments(actor.userId, operatorPaymentListQuery.parse(request.query)));
  });

  router.post("/platform/electronic-payments/:paymentId/refund", async (request, response) => {
    const actor = await platformActor(request, true);
    response.status(202).json(await payments.requestFullRefund(
      actor.userId,
      publicId.parse(request.params.paymentId),
      { ...bodies.refundPlatformPayment.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof PlatformPaymentError)) {
      next(error);
      return;
    }
    const problem = paymentProblem(error);
    response.status(problem.status).json(problem.body);
  };
  router.use(errors);
  return router;
}

export function createPlatformPaymentWebhookHandler(payments: PlatformPaymentService): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) throw new PlatformPaymentError("WEBHOOK_VERIFICATION_FAILED", "INVALID_PAYLOAD");
      const result = await payments.handleWebhook({
        providerCode: z.string().regex(/^[a-z0-9_-]{1,64}$/u).parse(request.params.providerCode),
        rawBody: request.body,
        signature: request.header("X-Platform-Payment-Signature") ?? undefined,
      });
      response.status(202).json(result);
    } catch (error) {
      if (!(error instanceof PlatformPaymentError)) {
        next(error);
        return;
      }
      const problem = paymentProblem(error);
      response.status(problem.status).json(problem.body);
    }
  };
}
