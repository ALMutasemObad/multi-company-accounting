import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { SalesInvoiceError, SalesInvoiceService } from "./sales-invoice-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  documentType: z.enum(["SALES_INVOICE", "SALES_CREDIT_NOTE"]).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]).optional(),
  customerId: id.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  outstandingOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((value) => value.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createSalesInvoiceRouter(auth: AuthService, service: SalesInvoiceService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf: csrf });
  const idempotencyKey = (request: Request) => z.string().min(8).max(200).parse(request.header("Idempotency-Key"));

  router.get("/sales-invoices", async (request, response) => {
    const context = await authorize(request, "sales_invoices.view", false);
    const parsed = query.parse(request.query);
    const result = await service.list(context, parsed);
    response.json({ data: result.data.map(SalesInvoiceService.json), meta: { page: parsed.page, pageSize: parsed.pageSize, total: result.total, totalPages: Math.ceil(result.total / parsed.pageSize) } });
  });

  router.post("/sales-invoices", async (request, response) => {
    const context = await authorize(request, "sales_invoices.create", true);
    response.status(201).json(SalesInvoiceService.json(await service.create(context, bodies.createSalesInvoice.parse(request.body))));
  });

  router.get("/sales-invoices/:invoiceId", async (request, response) => {
    const context = await authorize(request, "sales_invoices.view", false);
    response.json(SalesInvoiceService.json(await service.get(context, id.parse(request.params.invoiceId))));
  });

  router.patch("/sales-invoices/:invoiceId", async (request, response) => {
    const context = await authorize(request, "sales_invoices.update", true);
    response.json(SalesInvoiceService.json(await service.update(context, id.parse(request.params.invoiceId), bodies.updateSalesInvoice.parse(request.body))));
  });

  router.post("/sales-invoices/:invoiceId/post", async (request, response) => {
    const context = await authorize(request, "sales_invoices.post", true);
    const body = bodies.postSalesInvoice.parse(request.body);
    response.json(SalesInvoiceService.commandJson(await service.post(context, id.parse(request.params.invoiceId), body.version, idempotencyKey(request))));
  });

  router.post("/sales-invoices/:invoiceId/cancel", async (request, response) => {
    const context = await authorize(request, "sales_invoices.cancel", true);
    const body = bodies.cancelSalesInvoice.parse(request.body);
    response.json(SalesInvoiceService.commandJson(await service.cancel(context, id.parse(request.params.invoiceId), body.version, body.reason)));
  });

  router.post("/sales-invoices/:invoiceId/reverse", async (request, response) => {
    const context = await authorize(request, "sales_invoices.reverse", true);
    const body = bodies.reverseSalesInvoice.parse(request.body);
    response.json(SalesInvoiceService.commandJson(await service.reverse(context, id.parse(request.params.invoiceId), body, idempotencyKey(request))));
  });

  router.get("/reports/receivables-aging", async (request, response) => {
    const context = await authorize(request, "reports.receivables.view", false);
    const parsed = z.object({ asOf: isoDate, customerId: id.optional() }).parse(request.query);
    response.json(await service.receivablesAging(context, parsed));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof SalesInvoiceError) {
      const status = error.reason === "NOT_FOUND" ? 404 : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "ALREADY_REVERSED"].includes(error.reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ status: 409, code: "CONFLICT", reason: "DUPLICATE_VALUE" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
