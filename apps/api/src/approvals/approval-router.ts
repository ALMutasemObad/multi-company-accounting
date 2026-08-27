import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ApprovalError, type ApprovalService } from "./approval-service.js";
import { ApprovalSubjectError } from "./approval-subject-port.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(8).max(200).parse(request.header("Idempotency-Key"));
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  subjectType: z.enum(["FINANCIAL_CLOSE_RUN"]).optional(),
  subjectId: z.string().min(1).max(80).optional(),
});

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createApprovalRouter(auth: AuthService, approvals: ApprovalService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/approval-requests", async (request, response) => {
    const context = await authorize(request, "approvals.view", false);
    response.json(await approvals.list(context, querySchema.parse(request.query)));
  });
  router.get("/approval-requests/:approvalRequestId", async (request, response) => {
    const context = await authorize(request, "approvals.view", false);
    response.json(await approvals.get(context, publicId.parse(request.params.approvalRequestId)));
  });
  router.post("/approval-requests", async (request, response) => {
    const body = bodies.createApprovalRequest.parse(request.body);
    const context = await authorize(request, "fiscal_periods.close", true);
    response.status(201).json(await approvals.request(context, {
      ...body,
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/approval-requests/:approvalRequestId/approve", async (request, response) => {
    const context = await authorize(request, "approvals.decide", true);
    const body = bodies.approveApprovalRequest.parse(request.body);
    response.json(await approvals.approve(context, publicId.parse(request.params.approvalRequestId), {
      ...body,
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/approval-requests/:approvalRequestId/reject", async (request, response) => {
    const context = await authorize(request, "approvals.decide", true);
    const body = bodies.rejectApprovalRequest.parse(request.body);
    response.json(await approvals.reject(context, publicId.parse(request.params.approvalRequestId), {
      ...body,
      idempotencyKey: idempotencyKey(request),
    }));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ApprovalError || error instanceof ApprovalSubjectError) {
      const reason = error.reason;
      const status = ["NOT_FOUND", "SUBJECT_NOT_FOUND"].includes(reason)
        ? 404
        : ["VERSION_CONFLICT", "SUBJECT_VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason)
          ? 409
          : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
