import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { CustomerError } from "../sales/customer-ports.js";
import { CrmError, type CrmService } from "./crm-service.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const leadQuery = pagination.extend({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"]).optional(),
});
const opportunityQuery = pagination.extend({
  search: z.string().trim().min(1).max(200).optional(),
  stage: z.enum(["DISCOVERY", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]).optional(),
});
const activityQuery = pagination.extend({ status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).optional() });
const optionQuery = z.object({ search: z.string().trim().min(1).max(200).optional() });

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createCrmRouter(auth: AuthService, crm: CrmService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/crm/options", async (request, response) => {
    const context = await authorize(request, "crm.view", false);
    response.json(await crm.listOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/crm/leads", async (request, response) => {
    const context = await authorize(request, "crm.view", false);
    response.json(await crm.listLeads(context, leadQuery.parse(request.query)));
  });
  router.post("/crm/leads", async (request, response) => {
    const context = await authorize(request, "crm.manage", true);
    response.status(201).json(await crm.createLead(context, { ...bodies.createCrmLead.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.post("/crm/leads/:leadId/mark-contacted", async (request, response) => {
    const context = await authorize(request, "crm.manage", true);
    response.json(await crm.markLeadContacted(context, publicId.parse(request.params.leadId), { ...bodies.markCrmLeadContacted.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.post("/crm/leads/:leadId/qualify", async (request, response) => {
    const context = await authorize(request, "crm.manage", true);
    response.status(201).json(await crm.qualifyLead(context, publicId.parse(request.params.leadId), { ...bodies.qualifyCrmLead.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.post("/crm/leads/:leadId/convert", async (request, response) => {
    const context = await authorize(request, "crm.convert", true);
    response.json(await crm.convertLead(context, publicId.parse(request.params.leadId), { ...bodies.convertCrmLead.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.get("/crm/opportunities", async (request, response) => {
    const context = await authorize(request, "crm.view", false);
    response.json(await crm.listOpportunities(context, opportunityQuery.parse(request.query)));
  });
  router.post("/crm/opportunities/:opportunityId/stage", async (request, response) => {
    const context = await authorize(request, "crm.manage", true);
    response.json(await crm.moveOpportunityStage(context, publicId.parse(request.params.opportunityId), { ...bodies.moveCrmOpportunityStage.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.get("/crm/pipeline", async (request, response) => {
    const context = await authorize(request, "crm.view", false);
    response.json(await crm.pipeline(context));
  });
  router.get("/crm/activities", async (request, response) => {
    const context = await authorize(request, "crm.view", false);
    response.json(await crm.listActivities(context, activityQuery.parse(request.query)));
  });
  router.post("/crm/activities", async (request, response) => {
    const context = await authorize(request, "crm.activities.manage", true);
    response.status(201).json(await crm.createActivity(context, { ...bodies.createCrmActivity.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.post("/crm/activities/:activityId/complete", async (request, response) => {
    const context = await authorize(request, "crm.activities.manage", true);
    response.json(await crm.completeActivity(context, publicId.parse(request.params.activityId), { ...bodies.completeCrmActivity.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof CustomerError) {
      response.status(422).json({ status: 422, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    if (error instanceof CrmError) {
      const status = ["NOT_FOUND", "CUSTOMER_NOT_FOUND", "INVALID_PARENT"].includes(error.reason)
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason: error.reason });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
