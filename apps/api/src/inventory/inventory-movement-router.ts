import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  InventoryMovementError,
  InventoryMovementService,
} from "./inventory-movement-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const movementType = z.enum([
  "OPENING_BALANCE",
  "RECEIPT",
  "ISSUE",
  "TRANSFER",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
]);
const basePage = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const balanceQuery = z.object({
  ...basePage,
  search: z.string().trim().min(1).optional(),
  warehouseId: id.optional(),
  inventoryItemId: id.optional(),
  nonZero: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
const movementQuery = z.object({
  ...basePage,
  movementType: movementType.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  warehouseId: id.optional(),
  inventoryItemId: id.optional(),
  search: z.string().trim().min(1).optional(),
});

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

export function createInventoryMovementRouter(
  auth: AuthService,
  service: InventoryMovementService,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  const idempotencyKey = (request: Request) =>
    z.string().min(8).max(200).parse(request.header("Idempotency-Key"));

  router.get("/inventory-balances", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const query = balanceQuery.parse(request.query);
    const result = await service.listBalances(context, query);
    response.json({
      data: result.data.map(InventoryMovementService.balanceJson),
      meta: meta(query, result.total),
    });
  });

  router.get("/inventory-movements", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const query = movementQuery.parse(request.query);
    const result = await service.listMovements(context, query);
    response.json({
      data: result.data.map(InventoryMovementService.movementJson),
      meta: meta(query, result.total),
    });
  });

  router.post("/inventory-movements", async (request, response) => {
    const context = await authorize(request, "inventory_movements.create", true);
    response.status(201).json(await service.createMovement(
      context,
      bodies.createInventoryMovement.parse(request.body),
      idempotencyKey(request),
    ));
  });

  router.get("/inventory-movements/:movementId", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    response.json(InventoryMovementService.movementJson(
      await service.getMovement(context, id.parse(request.params.movementId)),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof InventoryMovementError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : ["IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason)
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
