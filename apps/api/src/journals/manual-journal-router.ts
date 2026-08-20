import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import {
  JournalError,
  ManualJournalService,
} from "./manual-journal-service.js";
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^(0|[1-9][0-9]{0,14})\.[0-9]{4}$/);
const rate = z.string().regex(/^[0-9]{1,11}\.[0-9]{8}$/);
const line = z
  .object({
    lineNumber: z.number().int().min(1),
    accountId: id,
    costCenterId: z.union([id, z.null()]).optional(),
    customerId: z.union([id, z.null()]).optional(),
    supplierId: z.union([id, z.null()]).optional(),
    description: z.string().max(500).nullable().optional(),
    currencyId: id,
    exchangeRate: rate,
    debitAmount: money,
    creditAmount: money,
  })
  .strict();
const entry = z
  .object({
    entryNumber: z.number().int().min(1),
    entryDate: isoDate,
    description: z.string().trim().min(1).max(500),
    lines: z.array(line).min(2),
  })
  .strict();
const create = z
  .object({
    fiscalPeriodId: id,
    documentDate: isoDate,
    description: z.string().trim().min(1).max(500),
    entries: z.array(entry).min(1),
  })
  .strict();
const update = z
  .object({
    fiscalPeriodId: id.optional(),
    documentDate: isoDate.optional(),
    description: z.string().trim().min(1).max(500).optional(),
    entries: z.array(entry).min(1).optional(),
    version: z.number().int().min(0),
  })
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
export function createManualJournalRouter(
  auth: AuthService,
  service: ManualJournalService,
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
  router.get("/manual-journals", async (req, res) => {
    const context = await authorize(req, "manual_journals.view", false);
    const q = query.parse(req.query);
    const result = await service.list(context, q);
    res.json({
      data: result.data.map(ManualJournalService.serialize),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    });
  });
  router.post("/manual-journals", async (req, res) => {
    const context = await authorize(req, "manual_journals.create", true);
    res
      .status(201)
      .json(
        ManualJournalService.serialize(
          await service.create(context, create.parse(req.body)),
        ),
      );
  });
  router.get("/manual-journals/:documentId", async (req, res) => {
    const context = await authorize(req, "manual_journals.view", false);
    res.json(
      ManualJournalService.serialize(
        await service.get(context, id.parse(req.params.documentId)),
      ),
    );
  });
  router.patch("/manual-journals/:documentId", async (req, res) => {
    const context = await authorize(req, "manual_journals.update", true);
    res.json(
      ManualJournalService.serialize(
        await service.update(
          context,
          id.parse(req.params.documentId),
          update.parse(req.body),
        ),
      ),
    );
  });
  router.post("/manual-journals/:documentId/post", async (req, res) => {
    const context = await authorize(req, "manual_journals.post", true);
    const body = version.parse(req.body);
    res.json(
      ManualJournalService.serializeCommand(
        await service.post(
          context,
          id.parse(req.params.documentId),
          body.version,
          idem(req),
        ),
      ),
    );
  });
  router.post("/manual-journals/:documentId/cancel", async (req, res) => {
    const context = await authorize(req, "manual_journals.cancel", true);
    const body = cancel.parse(req.body);
    res.json(
      ManualJournalService.serializeCommand(
        await service.cancel(
          context,
          id.parse(req.params.documentId),
          body.version,
          body.reason,
        ),
      ),
    );
  });
  router.post("/manual-journals/:documentId/reverse", async (req, res) => {
    const context = await authorize(req, "manual_journals.reverse", true);
    res.json(
      ManualJournalService.serializeCommand(
        await service.reverse(
          context,
          id.parse(req.params.documentId),
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
    if (error instanceof JournalError) {
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
