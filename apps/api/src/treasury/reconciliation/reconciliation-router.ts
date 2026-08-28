import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../../auth/auth-service.js";
import { AuthError } from "../../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../../generated/openapi-request-guards.js";
import { BankStatementParseError } from "./bank-statement-parser.js";
import {
  BankReconciliationError,
  type BankStatementFileInput,
  BankReconciliationService,
} from "./reconciliation-service.js";
import { BankReconciliationRolloutPolicy, type BankReconciliationRolloutStage } from "./reconciliation-rollout.js";

const bigintId = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const uuid = z.string().uuid();
const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const idempotencyKey = z.string().min(16).max(100);

function sid(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim().split("=", 2))
      .filter(([key, value]) => key && value),
  ).sid;
}

function fileInput(input: {
  cashBankAccountId: bigint;
  format: "CSV" | "CAMT053";
  contentBase64: string;
  fileName?: string | undefined;
  csvProfile?: BankStatementFileInput["csvProfile"];
  expectedAccountIdentifier?: string | undefined;
  expectedCurrency?: string | undefined;
}): BankStatementFileInput {
  return input;
}

export function createBankReconciliationRouter(
  auth: AuthService,
  service: BankReconciliationService,
  rollout: BankReconciliationRolloutPolicy = new BankReconciliationRolloutPolicy(true, "*", "CLOSE"),
) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) =>
    auth.authorize({
      sid: sid(request),
      csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission,
      requireCsrf: csrf,
    });
  const key = (request: Request) => idempotencyKey.parse(request.header("Idempotency-Key"));
  const stagedAuthorize = async (
    request: Request,
    permission: string,
    csrf: boolean,
    stage: Exclude<BankReconciliationRolloutStage, "OFF">,
  ) => {
    const context = await authorize(request, permission, csrf);
    rollout.require(context.companyId, stage);
    return context;
  };
  const hasPermission = async (request: Request, permission: string) => {
    try {
      await authorize(request, permission, false);
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.reason === "FORBIDDEN") return false;
      throw error;
    }
  };

  router.get("/bank-reconciliation/capabilities", async (request, response) => {
    const context = await authorize(request, "bank_reconciliation.view", false);
    const capability = rollout.capability(context.companyId);
    const [canImport, canSuggest, canReview, canClose] = capability.enabled
      ? await Promise.all([
          hasPermission(request, "bank_reconciliation.import"),
          hasPermission(request, "bank_reconciliation.review"),
          hasPermission(request, "bank_reconciliation.review"),
          hasPermission(request, "bank_reconciliation.close"),
        ])
      : [false, false, false, false];
    response.json({
      enabled: capability.enabled,
      stage: capability.stage,
      canImport: capability.stage !== "OFF" && canImport,
      canSuggest: capability.stage !== "OFF" && canSuggest,
      canReview: ["REVIEW", "CLOSE"].includes(capability.stage) && canReview,
      canClose: capability.stage === "CLOSE" && canClose,
    });
  });

  router.get("/bank-statement-imports", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.view", false, "SHADOW");
    const input = page.parse(request.query);
    const result = await service.listImports(context, input);
    response.json({
      data: result.data,
      meta: {
        ...input,
        total: result.total,
        totalPages: Math.ceil(result.total / input.pageSize),
      },
    });
  });

  router.post("/bank-statement-imports/preview", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.import", true, "SHADOW");
    response.json(await service.preview(context, fileInput(
      bodies.previewBankStatement.parse(request.body),
    )));
  });

  router.post("/bank-statement-imports", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.import", true, "SHADOW");
    response.status(201).json(await service.commitImport(
      context,
      fileInput(bodies.commitBankStatementImport.parse(request.body)),
      key(request),
    ));
  });

  router.get("/bank-statement-imports/:importId", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.view", false, "SHADOW");
    response.json(await service.getImport(context, uuid.parse(request.params.importId)));
  });

  router.get("/bank-reconciliation/sessions", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.view", false, "SHADOW");
    const input = page.extend({ status: z.enum(["OPEN", "CLOSED"]).optional() }).parse(request.query);
    const result = await service.listSessions(context, input);
    response.json({
      data: result.data,
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / input.pageSize),
      },
    });
  });

  router.post("/bank-reconciliation/sessions", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "SHADOW");
    response.status(201).json(await service.createSession(
      context,
      bodies.createBankReconciliationSession.parse(request.body),
      key(request),
    ));
  });

  router.get("/bank-reconciliation/sessions/:sessionId", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.view", false, "SHADOW");
    response.json(await service.getSession(context, uuid.parse(request.params.sessionId)));
  });

  router.get("/bank-reconciliation/sessions/:sessionId/book-movements", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.view", false, "SHADOW");
    response.json({ data: await service.listBookMovements(context, uuid.parse(request.params.sessionId)) });
  });

  router.post("/bank-reconciliation/sessions/:sessionId/suggestions", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "SHADOW");
    response.json(await service.generateSuggestions(
      context,
      uuid.parse(request.params.sessionId),
      bodies.generateBankReconciliationSuggestions.parse(request.body),
      key(request),
    ));
  });

  router.post("/bank-reconciliation/sessions/:sessionId/matches/manual", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "REVIEW");
    response.status(201).json(await service.manualMatch(
      context,
      uuid.parse(request.params.sessionId),
      bodies.createManualBankReconciliationMatch.parse(request.body),
      key(request),
    ));
  });

  router.post("/bank-reconciliation/sessions/:sessionId/matches/:matchId/approve", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "REVIEW");
    response.json(await service.approveSuggestion(
      context,
      uuid.parse(request.params.sessionId),
      bigintId.parse(request.params.matchId),
      bodies.approveBankReconciliationMatch.parse(request.body),
      key(request),
    ));
  });

  router.post("/bank-reconciliation/sessions/:sessionId/matches/:matchId/release", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "REVIEW");
    response.json(await service.releaseMatch(
      context,
      uuid.parse(request.params.sessionId),
      bigintId.parse(request.params.matchId),
      bodies.releaseBankReconciliationMatch.parse(request.body),
      key(request),
    ));
  });

  router.post("/bank-reconciliation/sessions/:sessionId/lines/:lineId/classify", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.review", true, "REVIEW");
    response.json(await service.classifyLine(
      context,
      uuid.parse(request.params.sessionId),
      bigintId.parse(request.params.lineId),
      bodies.classifyBankStatementLine.parse(request.body),
      key(request),
    ));
  });

  router.post("/bank-reconciliation/sessions/:sessionId/close", async (request, response) => {
    const context = await stagedAuthorize(request, "bank_reconciliation.close", true, "CLOSE");
    response.json(await service.closeSession(
      context,
      uuid.parse(request.params.sessionId),
      bodies.closeBankReconciliationSession.parse(request.body),
      key(request),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof BankStatementParseError || error instanceof BankReconciliationError) {
      const reason = error.reason;
      const status = reason === "NOT_FOUND"
        ? 404
        : reason === "FILE_TOO_LARGE"
          ? 413
          : [
              "VERSION_CONFLICT",
              "IDEMPOTENCY_MISMATCH",
              "IDEMPOTENCY_IN_PROGRESS",
              "LINE_ALREADY_MATCHED",
              "BOOK_MOVEMENT_ALREADY_MATCHED",
              "MATCH_FACT_CHANGED",
            ].includes(reason)
            ? 409
            : 422;
      const code = reason === "FEATURE_NOT_AVAILABLE"
        ? "FORBIDDEN"
        : status === 409
          ? "CONFLICT"
          : "BUSINESS_RULE_VIOLATION";
      response.status(reason === "FEATURE_NOT_AVAILABLE" ? 403 : status).json({
        status: reason === "FEATURE_NOT_AVAILABLE" ? 403 : status,
        code,
        reason,
        ...(error instanceof BankStatementParseError && error.sourceRowNumber !== undefined
          ? { sourceRowNumber: error.sourceRowNumber }
          : {}),
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ status: 409, code: "CONFLICT", reason: "DUPLICATE_VALUE" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
