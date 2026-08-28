import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { SalesInvoiceError } from "../sales/sales-invoice-service.js";
import {
  ProfessionalBillingError,
  type ProfessionalBillingService,
} from "./professional-billing-service.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const projectQuery = z.object({ projectId: publicId.optional() });
const contractQuery = z.object({ contractId: publicId });
const runQuery = z.object({ projectId: publicId });

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createProfessionalBillingRouter(
  auth: AuthService,
  billing: ProfessionalBillingService,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/professional-billing/currency-options", async (request, response) => {
    const context = await authorize(request, "professional_contracts.view", false);
    response.json(await billing.listCurrencyOptions(context));
  });
  router.get("/professional-service-contracts", async (request, response) => {
    const context = await authorize(request, "professional_contracts.view", false);
    response.json(await billing.listContracts(context, projectQuery.parse(request.query)));
  });
  router.post("/professional-service-contracts", async (request, response) => {
    const context = await authorize(request, "professional_contracts.manage", true);
    response.status(201).json(await billing.createContract(context, {
      ...bodies.createProfessionalServiceContract.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/professional-service-contracts/:professionalServiceContractId/end", async (request, response) => {
    const context = await authorize(request, "professional_contracts.manage", true);
    response.json(await billing.endContract(
      context,
      publicId.parse(request.params.professionalServiceContractId),
      { ...bodies.endProfessionalServiceContract.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.get("/professional-service-rates", async (request, response) => {
    const context = await authorize(request, "professional_rates.view", false);
    response.json(await billing.listRates(context, contractQuery.parse(request.query)));
  });
  router.post("/professional-service-rates", async (request, response) => {
    const context = await authorize(request, "professional_rates.manage", true);
    response.status(201).json(await billing.createRate(context, {
      ...bodies.createProfessionalServiceRate.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/professional-service-rates/:professionalServiceRateId/end", async (request, response) => {
    const context = await authorize(request, "professional_rates.manage", true);
    response.json(await billing.endRate(
      context,
      publicId.parse(request.params.professionalServiceRateId),
      { ...bodies.endProfessionalServiceRate.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.get("/professional-billing-runs", async (request, response) => {
    const context = await authorize(request, "professional_billing.view", false);
    response.json(await billing.listRuns(context, runQuery.parse(request.query)));
  });
  router.post("/professional-billing-runs", async (request, response) => {
    const context = await authorize(request, "professional_billing.execute", true);
    await authorize(request, "sales_invoices.create", true);
    await authorize(request, "sales_invoices.post", true);
    response.status(201).json(await billing.createRun(context, {
      ...bodies.createProfessionalBillingRun.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/professional-billing-runs/:professionalBillingRunId", async (request, response) => {
    const context = await authorize(request, "professional_billing.view", false);
    response.json(await billing.getRun(context, publicId.parse(request.params.professionalBillingRunId)));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ProfessionalBillingError) {
      const status = error.reason === "NOT_FOUND"
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "CONTRACT_OVERLAP", "RATE_OVERLAP", "ALREADY_BILLED"].includes(error.reason)
          ? 409
          : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    if (error instanceof SalesInvoiceError) {
      const status = ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
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
