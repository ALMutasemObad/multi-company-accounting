import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ReceiptError } from "../receipts/receipt-service.js";
import { SalesInvoiceError } from "../sales/sales-invoice-ports.js";
import { PosError, PosService } from "./pos-service.js";

const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

export function createPosRouter(auth: AuthService, service: PosService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/pos/sales", async (request, response) => {
    const context = await authorize(request, "pos.view", false);
    const parsed = page.parse(request.query);
    const result = await service.list(context, parsed);
    response.json({
      data: result.data.map(PosService.saleJson),
      meta: {
        ...parsed,
        total: result.total,
        totalPages: Math.ceil(result.total / parsed.pageSize),
      },
    });
  });

  router.post("/pos/checkouts", async (request, response) => {
    const context = await authorize(request, "pos.checkout", true);
    const key = z.string().min(8).max(200).parse(request.header("Idempotency-Key"));
    response.status(201).json(await service.checkout(
      context,
      bodies.completePosCheckout.parse(request.body),
      key,
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof PosError || error instanceof SalesInvoiceError || error instanceof ReceiptError) {
      const reason = error.reason;
      const status = reason === "NOT_FOUND"
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason)
          ? 409
          : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason });
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
