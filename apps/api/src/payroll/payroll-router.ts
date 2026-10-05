import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { PayrollError, type PayrollService } from "./payroll-service.js";
import { PayrollCalculationError } from "./payroll-calculation.js";
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const id = z.string().uuid();
function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map(part => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}
const key = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
export function createPayrollRouter(auth: AuthService, payroll: PayrollService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf = false) => auth.authorize({ sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf });
  router.get("/payroll/capabilities", async (request, response) => {
    response.json(await payroll.capabilities(await authorize(request, "payroll.view")));
  });
  router.get("/payroll/employees", async (request, response) => {
    const context = await authorize(request, "payroll.agreements.manage");
    const query = z.object({ search: z.string().trim().max(200).optional() }).parse(request.query);
    response.json(await payroll.listEmployees(context, query.search));
  });
  router.get("/payroll/agreements", async (request, response) => {
    const context = await authorize(request, "payroll.agreements.manage"), query = page.parse(request.query);
    response.json(await payroll.listAgreements(context, query.page, query.pageSize));
  });
  router.post("/payroll/agreements", async (request, response) => {
    const context = await authorize(request, "payroll.agreements.manage", true);
    response.status(201).json(await payroll.createAgreement(context, { ...bodies.createPayrollAgreement.parse(request.body), idempotencyKey: key(request) }));
  });
  router.post("/payroll/agreements/:agreementId/end", async (request, response) => {
    const context = await authorize(request, "payroll.agreements.manage", true);
    response.json(await payroll.endAgreement(context, id.parse(request.params.agreementId), { ...bodies.endPayrollAgreement.parse(request.body), idempotencyKey: key(request) }));
  });
  router.get("/payroll/runs", async (request, response) => {
    const context = await authorize(request, "payroll.view"), query = page.parse(request.query);
    response.json(await payroll.listRuns(context, query.page, query.pageSize));
  });
  router.post("/payroll/runs", async (request, response) => {
    const context = await authorize(request, "payroll.runs.manage", true);
    response.status(201).json(await payroll.createRun(context, { ...bodies.createPayrollRun.parse(request.body), idempotencyKey: key(request) }));
  });
  router.get("/payroll/runs/:runId", async (request, response) => {
    response.json(await payroll.getRun(await authorize(request, "payroll.view"), id.parse(request.params.runId)));
  });
  router.post("/payroll/runs/:runId/calculate", async (request, response) => {
    const context = await authorize(request, "payroll.runs.manage", true);
    response.json(await payroll.calculateRun(context, id.parse(request.params.runId), { ...bodies.calculatePayrollRun.parse(request.body), idempotencyKey: key(request) }));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR" }); return; }
    if (error instanceof PayrollError || error instanceof PayrollCalculationError) {
      const reason = error instanceof PayrollError ? error.reason : error.code;
      const status = reason === "OWNER_REQUIRED" ? 403 : reason.endsWith("NOT_FOUND") ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "RUN_OVERLAP", "AGREEMENT_OVERLAP"].includes(reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
