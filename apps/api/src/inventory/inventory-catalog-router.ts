import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  InventoryCatalogError,
  InventoryCatalogService,
} from "./inventory-catalog-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
const itemPage = page.extend({ unitOfMeasureId: id.optional() });

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

function meta(query: { page: number; pageSize: number }, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export function createInventoryCatalogRouter(
  auth: AuthService,
  service: InventoryCatalogService,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/units-of-measure", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.view", false);
    const query = page.parse(request.query);
    const result = await service.listUnitsOfMeasure(context, query);
    response.json({
      data: result.data.map(InventoryCatalogService.unitJson),
      meta: meta(query, result.total),
    });
  });

  router.post("/units-of-measure", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.status(201).json(InventoryCatalogService.unitJson(
      await service.createUnitOfMeasure(
        context,
        bodies.createUnitOfMeasure.parse(request.body),
      ),
    ));
  });

  router.get("/units-of-measure/:unitOfMeasureId", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.view", false);
    response.json(InventoryCatalogService.unitJson(
      await service.getUnitOfMeasure(context, id.parse(request.params.unitOfMeasureId)),
    ));
  });

  router.patch("/units-of-measure/:unitOfMeasureId", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.json(InventoryCatalogService.unitJson(
      await service.updateUnitOfMeasure(
        context,
        id.parse(request.params.unitOfMeasureId),
        bodies.updateUnitOfMeasure.parse(request.body),
      ),
    ));
  });

  router.post("/units-of-measure/:unitOfMeasureId/deactivate", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.json(InventoryCatalogService.unitJson(
      await service.deactivateUnitOfMeasure(
        context,
        id.parse(request.params.unitOfMeasureId),
        bodies.deactivateUnitOfMeasure.parse(request.body),
      ),
    ));
  });

  router.get("/inventory-items", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.view", false);
    const query = itemPage.parse(request.query);
    const result = await service.listItems(context, query);
    response.json({
      data: result.data.map(InventoryCatalogService.itemJson),
      meta: meta(query, result.total),
    });
  });

  router.post("/inventory-items", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.status(201).json(InventoryCatalogService.itemJson(
      await service.createItem(context, bodies.createInventoryItem.parse(request.body)),
    ));
  });

  router.get("/inventory-items/:inventoryItemId", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.view", false);
    response.json(InventoryCatalogService.itemJson(
      await service.getItem(context, id.parse(request.params.inventoryItemId)),
    ));
  });

  router.patch("/inventory-items/:inventoryItemId", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.json(InventoryCatalogService.itemJson(
      await service.updateItem(
        context,
        id.parse(request.params.inventoryItemId),
        bodies.updateInventoryItem.parse(request.body),
      ),
    ));
  });

  router.post("/inventory-items/:inventoryItemId/deactivate", async (request, response) => {
    const context = await authorize(request, "inventory_catalog.manage", true);
    response.json(InventoryCatalogService.itemJson(
      await service.deactivateItem(
        context,
        id.parse(request.params.inventoryItemId),
        bodies.deactivateInventoryItem.parse(request.body),
      ),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof InventoryCatalogError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : ["CODE_EXISTS", "VERSION_CONFLICT"].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({
        status,
        code: "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
