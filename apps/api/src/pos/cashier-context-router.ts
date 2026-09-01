import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { CashierContextPeriodError } from "../core-accounting/cashier-context-period-policy.js";
import { PosRequestContextError, readWithPosContext } from "../platform/pos-request-context.js";
import { ReferenceOptionInputError } from "../platform/reference-option.js";
import type { CashierContextField, CashierContextService } from "./cashier-context-service.js";

const field = z.enum(["warehouseId", "cashBankAccountId", "paymentMethodId", "currencyId"]);
const id = z.string().min(1).max(20)
  .refine(value => value.charCodeAt(0) >= 49 && value.charCodeAt(0) <= 57 && !/[^0-9]/u.test(value))
  .transform(BigInt).refine(value => value <= 18446744073709551615n);
const optionsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).regex(/^[^\u0000-\u001f\u007f]*$/u).optional(),
});
const ownerPermission: Record<CashierContextField, string> = {
  warehouseId: "warehouses.view", cashBankAccountId: "cash_bank_accounts.view",
  paymentMethodId: "cash_bank_accounts.view", currencyId: "currencies.view",
};

export function createCashierContextRouter(auth: Pick<AuthService, "authorize">,
  service: Pick<CashierContextService, "period" | "reference" | "options">) {
  const router = Router();
  const authorize = (request: Request, permission: string) => auth.authorize({
    sid: Object.fromEntries((request.headers.cookie ?? "").split(";")
      .map(value => value.trim().split("=", 2)).filter(([key, value]) => key && value)).sid,
    csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf: false,
  });
  const authorizeReference = async (request: Request, selected: CashierContextField) => {
    const posActor = await authorize(request, "pos.checkout");
    const ownerActor = await authorize(request, ownerPermission[selected]);
    if (ownerActor.userId !== posActor.userId || ownerActor.companyId !== posActor.companyId) {
      throw new PosRequestContextError("POS_CONTEXT_CHANGED");
    }
    return posActor;
  };

  router.get("/pos/context/identity", async (request, response) => {
    const purpose = z.enum(["checkout", "history"]).default("checkout").parse(request.query.purpose);
    response.json(await readWithPosContext(request, () => authorize(request, purpose === "history" ? "pos.view" : "pos.checkout"), async () => ({}), true));
  });
  router.get("/pos/context/period", async (request, response) => {
    response.json(await readWithPosContext(request, () => authorize(request, "pos.checkout"),
      actor => service.period(actor, z.string().parse(request.query.documentDate)), true));
  });
  router.get("/pos/context/references/:field/:referenceId", async (request, response) => {
    const selected = field.parse(request.params.field);
    response.json(await readWithPosContext(request, () => authorizeReference(request, selected),
      actor => service.reference(actor, selected, id.parse(request.params.referenceId)), true));
  });
  router.get("/pos/context/options/:field", async (request, response) => {
    const selected = field.parse(request.params.field);
    response.json(await readWithPosContext(request, () => authorizeReference(request, selected),
      actor => service.options(actor, selected, optionsQuery.parse(request.query)), true));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError || error instanceof CashierContextPeriodError || error instanceof ReferenceOptionInputError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR" }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
