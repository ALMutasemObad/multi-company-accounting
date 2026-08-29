import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  InventoryBarcodeError,
  InventoryBarcodeService,
} from "./inventory-barcode-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
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

function meta(query: { page: number; pageSize: number }, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export function createInventoryBarcodeRouter(
  auth: AuthService,
  service: InventoryBarcodeService,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });

  router.get("/inventory-items/:inventoryItemId/barcodes", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.view", false);
    const query = page.parse(request.query);
    const result = await service.listBarcodes(
      context,
      id.parse(request.params.inventoryItemId),
      query,
    );
    response.json({
      data: result.data.map(InventoryBarcodeService.barcodeJson),
      meta: meta(query, result.total),
    });
  });

  router.post("/inventory-items/:inventoryItemId/barcodes", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.manage", true);
    response.status(201).json(InventoryBarcodeService.barcodeJson(
      await service.createBarcode(
        context,
        id.parse(request.params.inventoryItemId),
        bodies.createInventoryItemBarcode.parse(request.body),
      ),
    ));
  });

  router.patch("/inventory-items/:inventoryItemId/barcodes/:barcodeId", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.manage", true);
    response.json(InventoryBarcodeService.barcodeJson(
      await service.updateBarcode(
        context,
        id.parse(request.params.inventoryItemId),
        id.parse(request.params.barcodeId),
        bodies.updateInventoryItemBarcode.parse(request.body),
      ),
    ));
  });

  router.post("/inventory-items/:inventoryItemId/barcodes/:barcodeId/set-primary", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.manage", true);
    response.json(InventoryBarcodeService.barcodeJson(
      await service.setPrimaryBarcode(
        context,
        id.parse(request.params.inventoryItemId),
        id.parse(request.params.barcodeId),
        bodies.setPrimaryInventoryItemBarcode.parse(request.body),
      ),
    ));
  });

  router.post("/inventory-items/:inventoryItemId/barcodes/:barcodeId/deactivate", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.manage", true);
    response.json(InventoryBarcodeService.barcodeJson(
      await service.deactivateBarcode(
        context,
        id.parse(request.params.inventoryItemId),
        id.parse(request.params.barcodeId),
        bodies.deactivateInventoryItemBarcode.parse(request.body),
      ),
    ));
  });

  router.post("/inventory-barcodes/resolve", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.resolve", true);
    response.json(await service.resolveBarcode(
      context,
      bodies.resolveInventoryBarcode.parse(request.body),
    ));
  });

  router.post("/inventory-barcodes/resolve-batch", async (request, response) => {
    const context = await authorize(request, "inventory_barcodes.resolve", true);
    const input = bodies.resolveInventoryBarcodeBatch.parse(request.body);
    response.json({ data: await service.resolveBarcodeBatch(context, input.entries) });
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof InventoryBarcodeError) {
      const status = ["INVENTORY_ITEM_NOT_FOUND", "BARCODE_NOT_FOUND"].includes(error.reason)
        ? 404
        : ["BARCODE_ALREADY_EXISTS", "VERSION_CONFLICT"].includes(error.reason)
          ? 409
          : ["INVALID_PAGINATION", "INVALID_BATCH_SIZE"].includes(error.reason)
            ? 400
            : 422;
      response.status(status).json({
        status,
        code: status === 400
          ? "VALIDATION_ERROR"
          : status === 404
            ? "NOT_FOUND"
            : "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
