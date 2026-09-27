import { Router, type ErrorRequestHandler, type Request } from "express";
import { ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { commitInventoryCatalogImportRequestSchema, previewInventoryCatalogImportRequestSchema } from "../generated/openapi-request-guards.js";
import { InventoryCatalogImportError, InventoryCatalogImportService } from "./inventory-catalog-import-service.js";

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "").split(";")
      .map((value) => value.trim().split("=", 2)).filter(([key, value]) => key && value),
  ).sid;
}

export function createInventoryCatalogImportRouter(auth: AuthService, service: InventoryCatalogImportService) {
  const router = Router();
  const authorize = (request: Request) => auth.authorize({
    sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission: "inventory_catalog.manage", requireCsrf: true,
  });
  router.post("/inventory-items/catalog-import/preview", async (request, response) => {
    const context = await authorize(request);
    const input = previewInventoryCatalogImportRequestSchema.parse(request.body);
    response.json(await service.preview(context, input));
  });
  router.post("/inventory-items/catalog-import/commit", async (request, response) => {
    const context = await authorize(request);
    const { previewHash, ...input } = commitInventoryCatalogImportRequestSchema.parse(request.body);
    response.json(await service.commit(context, input, previewHash));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof InventoryCatalogImportError) {
      const status = error.reason === "FILE_TOO_LARGE" ? 413
        : ["PREVIEW_MISMATCH", "CONCURRENT_IMPORT_CONFLICT"].includes(error.reason) ? 409 : 422;
      response.status(status).json({
        status, code: status === 409 ? "CONFLICT" : "BUSINESS_RULE_VIOLATION",
        reason: error.reason, ...(error.errors.length ? { errors: error.errors } : {}),
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
