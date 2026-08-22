import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ReceiptError, ReceiptService } from "./receipt-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  customerId: id.optional(),
  search: z.string().trim().min(1).optional(),
});
function sid(req: Request) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim().split("=", 2))
      .filter(([k, v]) => k && v),
  ).sid;
}
export function createReceiptRouter(
  auth: AuthService,
  service: ReceiptService,
) {
  const router = Router();
  const authorize = (req: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(req),
      csrfToken: req.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  const idem = (req: Request) =>
    z.string().min(8).max(200).parse(req.header("Idempotency-Key"));
  router.get("/receipts", async (req, res) => {
    const context = await authorize(req, "receipts.view", false);
    const q = query.parse(req.query);
    const result = await service.list(context, q);
    res.json({
      data: result.data.map(ReceiptService.json),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/receipts", async (req, res) => {
    const context = await authorize(req, "receipts.create", true);
    res
      .status(201)
      .json(
        ReceiptService.json(
          await service.create(context, bodies.createReceipt.parse(req.body)),
        ),
      );
  });
  router.get("/receipts/:receiptId", async (req, res) => {
    const context = await authorize(req, "receipts.view", false);
    res.json(
      ReceiptService.json(
        await service.get(context, id.parse(req.params.receiptId)),
      ),
    );
  });
  router.patch("/receipts/:receiptId", async (req, res) => {
    const context = await authorize(req, "receipts.update", true);
    res.json(
      ReceiptService.json(
        await service.update(
          context,
          id.parse(req.params.receiptId),
          bodies.updateReceipt.parse(req.body),
        ),
      ),
    );
  });
  router.post("/receipts/:receiptId/post", async (req, res) => {
    const context = await authorize(req, "receipts.post", true);
    const body = bodies.postReceipt.parse(req.body);
    res.json(
      ReceiptService.commandJson(
        await service.post(
          context,
          id.parse(req.params.receiptId),
          body.version,
          idem(req),
        ),
      ),
    );
  });
  router.post("/receipts/:receiptId/cancel", async (req, res) => {
    const context = await authorize(req, "receipts.cancel", true);
    const body = bodies.cancelReceipt.parse(req.body);
    res.json(
      ReceiptService.commandJson(
        await service.cancel(
          context,
          id.parse(req.params.receiptId),
          body.version,
          body.reason,
        ),
      ),
    );
  });
  router.post("/receipts/:receiptId/reverse", async (req, res) => {
    const context = await authorize(req, "receipts.reverse", true);
    res.json(
      ReceiptService.commandJson(
        await service.reverse(
          context,
          id.parse(req.params.receiptId),
          bodies.reverseReceipt.parse(req.body),
          idem(req),
        ),
      ),
    );
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ReceiptError) {
      const status =
        error.reason === "NOT_FOUND"
          ? 404
          : [
                "VERSION_CONFLICT",
                "IDEMPOTENCY_MISMATCH",
                "IDEMPOTENCY_IN_PROGRESS",
                "ALREADY_REVERSED",
              ].includes(error.reason)
            ? 409
            : 422;
      res
        .status(status)
        .json({
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
