import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ReceiptError } from "../receipts/receipt-service.js";
import { SalesInvoiceError } from "../sales/sales-invoice-ports.js";
import { PosError, PosService } from "./pos-service.js";
import type { PosRecoveryService } from "./recovery-service.js";
import { IdempotentCommandRejection } from "../platform/idempotent-command-executor.js";
import { readPosCheckoutRejection } from "./checkout-rejection.js";
import { bindPosRequestContext, readWithPosContext } from "../platform/pos-request-context.js";

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

export function createPosRouter(auth: AuthService, service: PosService, recovery?: PosRecoveryService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/pos/sales", async (request, response) => {
    response.json(await readWithPosContext(request, () => authorize(request, "pos.view", false), async context => {
      const parsed = page.parse(request.query);
      const result = await service.list(context, parsed);
      return { data: result.data.map(PosService.saleJson), meta: {
        ...parsed, total: result.total, totalPages: Math.ceil(result.total / parsed.pageSize),
      } };
    }, true));
  });

  router.post("/pos/checkouts", async (request, response) => {
    const binding = bindPosRequestContext(request, () => authorize(request, "pos.checkout", true), true);
    const context = await binding.authorize();
    const key = z.string().min(8).max(200).parse(request.header("Idempotency-Key"));
    const result = await service.checkout(
      context,
      bodies.completePosCheckout.parse(request.body),
      key,
    );
    await binding.authorize();
    response.status(201).json(binding.response(result));
  });

  router.post("/pos/checkouts/recovery", async (request, response) => {
    // Reauthorize the live session on both sides of lookup, including CSRF and POS entitlement.
    if (!recovery) throw new Error("POS recovery service is not configured");
    const binding = bindPosRequestContext(request, () => authorize(request, "pos.checkout", true), true);
    const { attemptKey } = bodies.recoverPosCheckout.parse(request.body);
    response.json(binding.response(await recovery.recover(binding.authorize, attemptKey)));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof IdempotentCommandRejection && error.responseStatus === 422) {
      const rejection = readPosCheckoutRejection(error.responseBody);
      if (rejection) {
        // A hint to read recovery, not a client-side permission to clear the marker.
        response.status(422).json({ status: 422, ...rejection });
        return;
      }
    }
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
