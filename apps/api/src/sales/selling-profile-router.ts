import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { SellingProfileError } from "./selling-profile-policy.js";
import type { SellingProfileService } from "./selling-profile-service.js";
import { readWithPosContext } from "../platform/pos-request-context.js";

const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().max(100).regex(/^[^\u0000-\u001f\u007f]*$/).optional() });
const itemId = z.string().regex(/^[1-9][0-9]{0,19}$/).transform(BigInt)
  .refine(value => value <= 18446744073709551615n);
const key = z.string().min(8).max(200);

export function createSellingProfileRouter(auth: Pick<AuthService, "authorize">,
  service: Pick<SellingProfileService, "list" | "get" | "create" | "update">) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: Object.fromEntries((request.headers.cookie ?? "").split(";").map(v => v.trim().split("=", 2)).filter(([k, v]) => k && v)).sid,
    csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf,
  });
  router.get("/sales/catalog", async (request, response) => {
    response.json(await readWithPosContext(request, () => authorize(request, "sales_catalog.view", false),
      context => service.list(context, query.parse(request.query))));
  });
  router.get("/sales/catalog/items/:inventoryItemId", async (request, response) => {
    response.json(await readWithPosContext(request, () => authorize(request, "sales_catalog.view", false),
      context => service.get(context, itemId.parse(request.params.inventoryItemId))));
  });
  router.post("/sales/catalog/items/:inventoryItemId/selling-profile", async (request, response) => {
    const context = await authorize(request, "sales_catalog.manage", true);
    const input = bodies.createItemSellingProfile.parse(request.body);
    response.status(201).json(await service.create(context, itemId.parse(request.params.inventoryItemId),
      { ...input, taxRateId: input.taxRateId ?? null }, key.parse(request.header("Idempotency-Key"))));
  });
  router.patch("/sales/catalog/items/:inventoryItemId/selling-profile", async (request, response) => {
    const context = await authorize(request, "sales_catalog.manage", true);
    const input = bodies.updateItemSellingProfile.parse(request.body);
    response.json(await service.update(context, itemId.parse(request.params.inventoryItemId),
      { version: input.version,
        ...(input.unitPrice === undefined ? {} : { unitPrice: input.unitPrice }),
        ...(input.currencyId === undefined ? {} : { currencyId: input.currencyId }),
        ...(input.revenueAccountId === undefined ? {} : { revenueAccountId: input.revenueAccountId }),
        ...(input.taxRateId === undefined ? {} : { taxRateId: input.taxRateId }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }) }, key.parse(request.header("Idempotency-Key"))));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues }); return;
    }
    if (error instanceof SellingProfileError) {
      const reason = error.reason;
      const status = reason === "NOT_FOUND" ? 404
        : ["PROFILE_EXISTS", "VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason) ? 409
          : ["INVALID_PAGINATION", "INVALID_SEARCH"].includes(reason) ? 400 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason }); return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      response.status(422).json({ status: 422, code: "BUSINESS_RULE_VIOLATION", reason: "INVALID_REFERENCE" }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
