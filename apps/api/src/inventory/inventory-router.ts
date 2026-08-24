import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { InventoryError, InventoryService } from "./inventory-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

export function createInventoryRouter(auth: AuthService, service: InventoryService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/warehouses", async (request, response) => {
    const context = await authorize(request, "warehouses.view", false);
    const query = page.parse(request.query);
    const result = await service.listWarehouses(context, query);
    response.json({
      data: result.data.map(InventoryService.warehouseJson),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      },
    });
  });

  router.post("/warehouses", async (request, response) => {
    const context = await authorize(request, "warehouses.manage", true);
    response.status(201).json(InventoryService.warehouseJson(
      await service.createWarehouse(context, bodies.createWarehouse.parse(request.body)),
    ));
  });

  router.get("/warehouses/:warehouseId", async (request, response) => {
    const context = await authorize(request, "warehouses.view", false);
    response.json(InventoryService.warehouseJson(
      await service.getWarehouse(context, id.parse(request.params.warehouseId)),
    ));
  });

  router.patch("/warehouses/:warehouseId", async (request, response) => {
    const context = await authorize(request, "warehouses.manage", true);
    response.json(InventoryService.warehouseJson(
      await service.updateWarehouse(
        context,
        id.parse(request.params.warehouseId),
        bodies.updateWarehouse.parse(request.body),
      ),
    ));
  });

  router.post("/warehouses/:warehouseId/deactivate", async (request, response) => {
    const context = await authorize(request, "warehouses.manage", true);
    response.json(InventoryService.warehouseJson(
      await service.deactivateWarehouse(
        context,
        id.parse(request.params.warehouseId),
        bodies.deactivateWarehouse.parse(request.body),
      ),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof InventoryError) {
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
