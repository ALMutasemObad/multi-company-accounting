import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  InventoryMovementError,
  InventoryMovementService,
} from "./inventory-movement-service.js";
import {
  currentInventoryValuationReport,
  inventoryValuationXlsx,
} from "./inventory-valuation-report/report.js";
import {
  ExternalStockPositionError,
} from "./stock-position/external-stock-position-service.js";
import { InventoryCountError } from "./inventory-count/inventory-count-service.js";
import { inventoryCountReportXlsx } from "./inventory-count/inventory-count-report.js";
import { externalStockPositionsXlsx } from "./stock-position/external-stock-position-report.js";

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
const valuationReportQuery = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  warehouseId: id.optional(),
  inventoryItemId: id.optional(),
  valuationStatus: z.enum(["ALL", "VALUED", "UNVALUED"]).default("ALL"),
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
const externalPositionType = z.enum([
  "THIRD_PARTY_HELD_BY_US",
  "OWNED_HELD_BY_THIRD_PARTY",
  "OWNED_IN_TRANSIT",
]);
const stockCountStatus = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "SETTLED"]);
const stockCountListQuery = z.object({
  ...basePage,
  warehouseId: id.optional(),
  status: stockCountStatus.optional(),
});
const stockCountCreateInput = bodies.createInventoryCountSession.transform((input) => ({
  ...input,
  countDate: new Date(`${input.countDate}T00:00:00.000Z`),
}));
const stockCountLinesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1_000).default(100),
  search: z.string().trim().min(1).max(200).optional(),
});
const stockCountEntryInput = z.object({
  inventoryItemId: id,
  quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u),
  locationReference: z.string().trim().max(200).nullable().optional(),
  entryKey: z.string().trim().min(8).max(100),
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

  router.get("/inventory-valuation-report", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    response.json(await currentInventoryValuationReport(service, context, valuationReportQuery.parse(request.query)));
  });

  router.get("/inventory-valuation-report.xlsx", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const report = await currentInventoryValuationReport(service, context, valuationReportQuery.parse(request.query));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=inventory-current-valuation.xlsx");
    response.send(inventoryValuationXlsx(report));
  });

  router.get("/inventory-count-sessions", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const query = stockCountListQuery.parse(request.query);
    const result = await service.inventoryCount.listSessions(context, query);
    response.json({ data: result.data, meta: meta(query, result.total) });
  });

  router.post("/inventory-count-sessions", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", true);
    response.status(201).json(await service.inventoryCount.createSession(
      context,
      stockCountCreateInput.parse(request.body),
      idempotencyKey(request),
    ));
  });

  router.get("/inventory-count-sessions/:sessionId", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", false);
    response.json(await service.inventoryCount.getSession(context, id.parse(request.params.sessionId)));
  });

  router.get("/inventory-count-sessions/:sessionId/lines", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", false);
    const query = stockCountLinesQuery.parse(request.query);
    const result = await service.inventoryCount.listLines(context, id.parse(request.params.sessionId), query);
    response.json({ data: result.data, meta: meta(query, result.summary.total), summary: result.summary });
  });

  router.post("/inventory-count-sessions/:sessionId/counts", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", true);
    const input = bodies.enterInventoryCountQuantities.parse(request.body);
    response.json(await service.inventoryCount.bulkEnterCounts(context, id.parse(request.params.sessionId), input.rows));
  });

  router.post("/inventory-count-sessions/:sessionId/entries", async (request, response) => {
    const context = await authorize(request, "inventory_counts.enter", true);
    response.status(201).json(await service.inventoryCount.addEntry(
      context,
      id.parse(request.params.sessionId),
      stockCountEntryInput.parse(request.body),
    ));
  });

  router.get("/inventory-count-sessions/:sessionId/entries", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", false);
    const query = z.object({ lineId: id.optional() }).parse(request.query);
    response.json({ data: await service.inventoryCount.listEntries(context, id.parse(request.params.sessionId), query.lineId) });
  });

  router.get("/inventory-count-sessions/:sessionId/report.xlsx", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", false);
    const report = await service.inventoryCount.report(context, id.parse(request.params.sessionId));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename=inventory-count-${report.session.id}.xlsx`);
    response.send(inventoryCountReportXlsx(report));
  });

  router.post("/inventory-count-sessions/:sessionId/submit", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", true);
    const input = bodies.submitInventoryCountSession.parse(request.body);
    response.json(await service.inventoryCount.submit(context, id.parse(request.params.sessionId), input.expectedVersion));
  });

  router.post("/inventory-count-sessions/:sessionId/approve", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", true);
    const input = bodies.approveInventoryCountSession.parse(request.body);
    response.json(await service.inventoryCount.approve(
      context,
      id.parse(request.params.sessionId),
      input.expectedVersion,
      input.approverName,
    ));
  });

  router.post("/inventory-count-sessions/:sessionId/settle", async (request, response) => {
    const context = await authorize(request, "inventory_counts.manage", true);
    const input = bodies.settleInventoryCountSession.parse(request.body);
    response.json(await service.settleApprovedCount(
      context,
      id.parse(request.params.sessionId),
      input,
      idempotencyKey(request),
    ));
  });

  router.get("/external-inventory-parties", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    response.json({ data: await service.externalStock.listParties(context) });
  });

  router.post("/external-inventory-parties", async (request, response) => {
    const context = await authorize(request, "inventory_movements.create", true);
    response.status(201).json(await service.externalStock.createParty(
      context,
      bodies.createExternalInventoryParty.parse(request.body),
    ));
  });

  router.get("/external-stock-positions", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const query = z.object({
      positionType: externalPositionType.optional(),
      includeZero: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    }).parse(request.query);
    response.json({ data: await service.externalStock.listPositions(context, query) });
  });

  router.get("/external-stock-positions.xlsx", async (request, response) => {
    const context = await authorize(request, "inventory_movements.view", false);
    const query = z.object({
      positionType: externalPositionType.optional(),
      includeZero: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    }).parse(request.query);
    const positions = await service.externalStock.listPositions(context, query);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=external-stock-positions.xlsx");
    response.send(externalStockPositionsXlsx(positions));
  });

  router.post("/external-stock-positions/events", async (request, response) => {
    const context = await authorize(request, "inventory_movements.create", true);
    response.status(201).json(await service.externalStock.recordEvent(
      context,
      bodies.recordExternalStockPositionEvent.parse(request.body),
      idempotencyKey(request),
    ));
  });

  router.post("/external-stock-position-events/:eventId/reverse", async (request, response) => {
    const context = await authorize(request, "inventory_movements.reverse", true);
    response.json(await service.externalStock.reverseLatestEvent(
      context,
      id.parse(request.params.eventId),
      idempotencyKey(request),
    ));
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

  router.post("/inventory-balances/:balanceId/initialize-valuation", async (request, response) => {
    const context = await authorize(request, "inventory_movements.create", true);
    response.json(await service.initializeBalanceValuation(
      context,
      id.parse(request.params.balanceId),
      bodies.initializeInventoryBalanceValuation.parse(request.body),
      idempotencyKey(request),
    ));
  });

  router.post("/inventory-movements/:movementId/reverse", async (request, response) => {
    const context = await authorize(request, "inventory_movements.reverse", true);
    response.json(await service.reverseMovement(
      context,
      id.parse(request.params.movementId),
      bodies.reverseInventoryMovement.parse(request.body),
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
        : [
            "IDEMPOTENCY_MISMATCH",
            "IDEMPOTENCY_IN_PROGRESS",
            "VERSION_CONFLICT",
            "VALUATION_ALREADY_INITIALIZED",
            "INVALID_STATE",
            "ALREADY_REVERSED",
            "COUNT_MOVED_SINCE_SNAPSHOT",
          ].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({
        status,
        code: "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ExternalStockPositionError) {
      const status = error.reason === "NOT_FOUND" ? 404 : [
        "DUPLICATE_CODE",
        "IDEMPOTENCY_MISMATCH",
        "ALREADY_REVERSED",
        "NOT_LATEST_EVENT",
        "VERSION_CONFLICT",
      ].includes(error.reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    if (error instanceof InventoryCountError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : [
            "VERSION_CONFLICT",
            "IDEMPOTENCY_MISMATCH",
            "IDEMPOTENCY_IN_PROGRESS",
            "INVALID_STATE",
          ].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
