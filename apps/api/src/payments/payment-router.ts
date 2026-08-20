import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { PaymentError, PaymentService } from "./payment-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^(0|[1-9][0-9]{0,14})\.[0-9]{4}$/);
const rate = z.string().regex(/^[0-9]{1,11}\.[0-9]{8}$/);
const nullableId = z.union([id, z.null()]);
const allocation = z
  .object({ targetJournalLineId: id, allocatedAmount: money })
  .strict();
const fields = {
  fiscalPeriodId: id,
  documentDate: isoDate,
  description: z.string().trim().min(1).max(500),
  supplierId: nullableId.optional(),
  counterAccountId: nullableId.optional(),
  cashBankAccountId: id,
  paymentMethodId: id,
  currencyId: id,
  exchangeRate: rate,
  amount: money,
  referenceNumber: z.string().trim().max(100).nullable().optional(),
  counterpartyName: z.string().trim().min(1).max(200),
  counterpartyTaxNumber: z.string().max(64).nullable().optional(),
  counterpartyAddress: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  allocations: z.array(allocation).optional(),
};
const xor = (v: {
  supplierId?: bigint | null | undefined;
  counterAccountId?: bigint | null | undefined;
}) => (v.supplierId == null) !== (v.counterAccountId == null);
const paymentFields = z.object(fields).strict();
const create = paymentFields.refine(xor, {
  message: "Exactly one counterparty is required",
});
const update = paymentFields
  .partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
const version = z.object({ version: z.number().int().min(0) }).strict();
const cancel = version.extend({ reason: z.string().trim().min(3).max(500) });
const reverse = version.extend({
  reversalDate: isoDate,
  reason: z.string().trim().min(3).max(500),
});
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  supplierId: id.optional(),
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
export function createPaymentRouter(
  auth: AuthService,
  service: PaymentService,
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
  router.get("/payments", async (req, res) => {
    const context = await authorize(req, "payments.view", false);
    const q = query.parse(req.query);
    const result = await service.list(context, q);
    res.json({
      data: result.data.map(PaymentService.json),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/payments", async (req, res) => {
    const context = await authorize(req, "payments.create", true);
    res
      .status(201)
      .json(
        PaymentService.json(
          await service.create(context, create.parse(req.body) as any),
        ),
      );
  });
  router.get("/payments/:paymentId", async (req, res) => {
    const context = await authorize(req, "payments.view", false);
    res.json(
      PaymentService.json(
        await service.get(context, id.parse(req.params.paymentId)),
      ),
    );
  });
  router.patch("/payments/:paymentId", async (req, res) => {
    const context = await authorize(req, "payments.update", true);
    res.json(
      PaymentService.json(
        await service.update(
          context,
          id.parse(req.params.paymentId),
          update.parse(req.body) as any,
        ),
      ),
    );
  });
  router.post("/payments/:paymentId/post", async (req, res) => {
    const context = await authorize(req, "payments.post", true);
    const body = version.parse(req.body);
    res.json(
      PaymentService.commandJson(
        await service.post(
          context,
          id.parse(req.params.paymentId),
          body.version,
          idem(req),
        ),
      ),
    );
  });
  router.post("/payments/:paymentId/cancel", async (req, res) => {
    const context = await authorize(req, "payments.cancel", true);
    const body = cancel.parse(req.body);
    res.json(
      PaymentService.commandJson(
        await service.cancel(
          context,
          id.parse(req.params.paymentId),
          body.version,
          body.reason,
        ),
      ),
    );
  });
  router.post("/payments/:paymentId/reverse", async (req, res) => {
    const context = await authorize(req, "payments.reverse", true);
    res.json(
      PaymentService.commandJson(
        await service.reverse(
          context,
          id.parse(req.params.paymentId),
          reverse.parse(req.body),
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
    if (error instanceof PaymentError) {
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
