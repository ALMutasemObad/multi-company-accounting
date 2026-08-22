import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { PurchaseInvoiceError, PurchaseInvoiceService } from "./purchase-invoice-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  documentType: z.enum(["PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE"]).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]).optional(),
  supplierId: id.optional(),
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

export function createPurchaseInvoiceRouter(auth: AuthService, service: PurchaseInvoiceService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf: csrf });
  const idempotencyKey = (request: Request) => z.string().min(8).max(200).parse(request.header("Idempotency-Key"));

  router.get("/purchase-invoices", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.view", false);
    const parsed = query.parse(request.query);
    const result = await service.list(context, parsed as any);
    response.json({ data: result.data.map(PurchaseInvoiceService.json), meta: { page: parsed.page, pageSize: parsed.pageSize, total: result.total, totalPages: Math.ceil(result.total / parsed.pageSize) } });
  });

  router.post("/purchase-invoices", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.create", true);
    response.status(201).json(PurchaseInvoiceService.json(await service.create(context, bodies.createPurchaseInvoice.parse(request.body))));
  });

  router.get("/purchase-invoices/:invoiceId", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.view", false);
    response.json(PurchaseInvoiceService.json(await service.get(context, id.parse(request.params.invoiceId))));
  });

  router.patch("/purchase-invoices/:invoiceId", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.update", true);
    response.json(PurchaseInvoiceService.json(await service.update(context, id.parse(request.params.invoiceId), bodies.updatePurchaseInvoice.parse(request.body))));
  });

  router.post("/purchase-invoices/:invoiceId/post", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.post", true);
    const body = bodies.postPurchaseInvoice.parse(request.body);
    response.json(PurchaseInvoiceService.commandJson(await service.post(context, id.parse(request.params.invoiceId), body.version, idempotencyKey(request))));
  });

  router.post("/purchase-invoices/:invoiceId/cancel", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.cancel", true);
    const body = bodies.cancelPurchaseInvoice.parse(request.body);
    response.json(PurchaseInvoiceService.commandJson(await service.cancel(context, id.parse(request.params.invoiceId), body.version, body.reason)));
  });

  router.post("/purchase-invoices/:invoiceId/reverse", async (request, response) => {
    const context = await authorize(request, "purchase_invoices.reverse", true);
    const body = bodies.reversePurchaseInvoice.parse(request.body);
    response.json(PurchaseInvoiceService.commandJson(await service.reverse(context, id.parse(request.params.invoiceId), body, idempotencyKey(request))));
  });

  router.get("/reports/payables-aging", async (request, response) => {
    const context = await authorize(request, "reports.payables.view", false);
    const parsed = z.object({ asOf: isoDate, supplierId: id.optional() }).parse(request.query);
    response.json(await service.payablesAging(context, parsed as any));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof PurchaseInvoiceError) {
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
