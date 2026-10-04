import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ServiceCatalogPolicyError } from "./service-offering-policy.js";
import { ServiceCatalogError, type ServiceCatalogService } from "./service-catalog-service.js";

const publicId = z.string().uuid();
const categoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "RETIRED"]).optional(),
});
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createServiceCatalogRouter(auth: AuthService, catalog: ServiceCatalogService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission, requireCsrf,
  });

  router.get("/service-catalog/categories", async (request, response) => {
    const context = await authorize(request, "services.view", false);
    response.json(await catalog.listCategories(context, categoryQuery.parse(request.query)));
  });
  router.get("/service-catalog/categories/:categoryId", async (request, response) => {
    const context = await authorize(request, "services.view", false);
    response.json(await catalog.getCategory(context, publicId.parse(request.params.categoryId)));
  });
  router.post("/service-catalog/categories", async (request, response) => {
    const context = await authorize(request, "services.manage", true);
    response.status(201).json(await catalog.createCategory(context, {
      ...bodies.createServiceCategory.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.patch("/service-catalog/categories/:categoryId", async (request, response) => {
    const context = await authorize(request, "services.manage", true);
    response.json(await catalog.updateCategory(context, publicId.parse(request.params.categoryId), {
      ...bodies.updateServiceCategory.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/service-catalog/categories/:categoryId/transition", async (request, response) => {
    const context = await authorize(request, "services.manage", true);
    response.json(await catalog.transitionCategory(context, publicId.parse(request.params.categoryId), {
      ...bodies.transitionServiceCategory.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ServiceCatalogError || error instanceof ServiceCatalogPolicyError) {
      const reason = error instanceof ServiceCatalogError ? error.reason : error.code;
      const status = reason === "NOT_FOUND" ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
