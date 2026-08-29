import { Router, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  PLATFORM_BILLING_DEFAULT_PAGE_SIZE,
  PLATFORM_BILLING_MAX_PAGE_SIZE,
  PlatformBillingError,
  type PlatformBillingService,
} from "./platform-billing-service.js";
import {
  PlatformOperationsError,
  type PlatformOperationsService,
} from "./platform-operations-service.js";

const querySchema = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform((value) => Number(value) as 7 | 30 | 90),
});
const companyListQuery = querySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const billingListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PLATFORM_BILLING_MAX_PAGE_SIZE)
    .default(PLATFORM_BILLING_DEFAULT_PAGE_SIZE),
});
const companyId = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const analyticsQuery = z.object({
  from: dateText,
  to: dateText,
  comparison: z.enum(["PREVIOUS_PERIOD", "PREVIOUS_YEAR", "NONE"]).default("PREVIOUS_PERIOD"),
  companyId: companyId.optional(),
}).superRefine((value, context) => {
  const from = new Date(`${value.from}T00:00:00.000Z`);
  const to = new Date(`${value.to}T00:00:00.000Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 366) context.addIssue({ code: "custom", message: "Date range must be between 1 and 366 days" });
});

const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const previousYearDate = (value: Date) => {
  const year = value.getUTCFullYear() - 1;
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  const shifted = new Date(Date.UTC(year, month, day));
  return shifted.getUTCMonth() === month ? shifted : new Date(Date.UTC(year, month + 1, 0));
};

function sid(request: Request) {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

export function createPlatformOperationsRouter(
  auth: AuthService,
  platform: PlatformOperationsService,
  billing: PlatformBillingService,
) {
  const router = Router();
  const authenticate = (request: Request, requireCsrf = false) => auth.authenticate({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    requireCsrf,
  });

  router.get("/platform/capabilities", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await platform.capabilities(actor.userId));
  });

  router.get("/platform/overview", async (request, response) => {
    const actor = await authenticate(request);
    const query = querySchema.parse(request.query);
    response.json(await platform.overview(actor.userId, query.days));
  });

  router.get("/platform/analytics", async (request, response) => {
    const actor = await authenticate(request);
    const query = analyticsQuery.parse(request.query);
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const toInclusive = new Date(`${query.to}T00:00:00.000Z`);
    const toExclusive = addUtcDays(toInclusive, 1);
    const duration = toExclusive.getTime() - from.getTime();
    const comparisonFrom = query.comparison === "PREVIOUS_PERIOD"
      ? new Date(from.getTime() - duration)
      : query.comparison === "PREVIOUS_YEAR" ? previousYearDate(from) : null;
    const comparisonToExclusive = query.comparison === "PREVIOUS_PERIOD"
      ? from
      : query.comparison === "PREVIOUS_YEAR" ? addUtcDays(previousYearDate(toInclusive), 1) : null;
    response.json(await platform.analyticsDashboard(actor.userId, {
      from,
      toExclusive,
      comparison: query.comparison,
      comparisonFrom,
      comparisonToExclusive,
      companyId: query.companyId,
    }));
  });

  router.get("/platform/companies", async (request, response) => {
    const actor = await authenticate(request);
    const query = companyListQuery.parse(request.query);
    response.json(await platform.listCompanies(actor.userId, query));
  });

  router.get("/platform/companies/:companyId", async (request, response) => {
    const actor = await authenticate(request);
    const query = querySchema.parse(request.query);
    response.json(await platform.companyDetails(actor.userId, companyId.parse(request.params.companyId), query.days));
  });

  router.get("/platform/billing/summary", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await billing.summary(actor.userId, billingListQuery.parse(request.query)));
  });

  router.get("/platform/companies/:companyId/billing", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await billing.companyBilling(
      actor.userId,
      companyId.parse(request.params.companyId),
      billingListQuery.parse(request.query),
    ));
  });

  router.put("/platform/companies/:companyId/billing-account", async (request, response) => {
      const actor = await authenticate(request, true);
      response.json(await billing.upsertAccount(actor.userId, companyId.parse(request.params.companyId), {
        ...bodies.upsertPlatformBillingAccount.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      }));
  });

  router.post("/platform/companies/:companyId/invoices", async (request, response) => {
      const actor = await authenticate(request, true);
      response.status(201).json(await billing.issueInvoice(actor.userId, companyId.parse(request.params.companyId), {
        ...bodies.issuePlatformBillingInvoice.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      }));
  });

  router.post("/platform/invoices/:invoiceId/payments", async (request, response) => {
      const actor = await authenticate(request, true);
      response.status(201).json(await billing.recordPayment(actor.userId, publicId.parse(request.params.invoiceId), {
        ...bodies.recordPlatformBillingPayment.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      }));
  });

  router.post("/platform/invoices/:invoiceId/void", async (request, response) => {
      const actor = await authenticate(request, true);
      response.json(await billing.voidInvoice(actor.userId, publicId.parse(request.params.invoiceId), {
        ...bodies.voidPlatformBillingInvoice.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      }));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof PlatformOperationsError) {
      const status = error.reason === "NOT_FOUND" ? 404 : 403;
      response.status(status).json({
        type: "about:blank",
        title: status === 404 ? "Platform company not found" : "Platform operations access denied",
        status,
        code: error.reason,
      });
      return;
    }
    if (error instanceof PlatformBillingError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : ["VERSION_CONFLICT", "PERIOD_ALREADY_INVOICED", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({
        type: "about:blank", title: "Platform billing business rule violation",
        status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason,
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
