import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { GeneralProjectPolicyError } from "./general-project-policy.js";
import { GeneralProjectError, type GeneralProjectService } from "./general-project-service.js";

const publicId = z.string().uuid();
const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const projectQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  customerId: id.optional(), scope: z.enum(["ALL", "MINE"]).default("ALL"),
});
const optionQuery = z.object({ search: z.string().trim().min(1).max(200).optional() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) });

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map(part => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createGeneralProjectRouter(auth: AuthService, projects: GeneralProjectService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf,
  });
  router.get("/general-projects/customer-options", async (request, response) => {
    // Listing the entire Sales customer reference set requires Sales visibility.
    const context = await authorize(request, "customers.view", false);
    response.json(await projects.listCustomerOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/general-projects/employee-options", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", false);
    response.json(await projects.listEmployeeOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/general-projects", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listProjects(context, projectQuery.parse(request.query)));
  });
  router.post("/general-projects", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.status(201).json(await projects.createProject(context, { ...bodies.createGeneralProject.parse(request.body), idempotencyKey: idempotencyKey(request) }));
  });
  router.get("/general-projects/:generalProjectId", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.getProject(context, publicId.parse(request.params.generalProjectId)));
  });
  router.patch("/general-projects/:generalProjectId", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.updateProject(context, publicId.parse(request.params.generalProjectId), {
      ...bodies.updateGeneralProject.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/general-projects/:generalProjectId/transition", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.transition(context, publicId.parse(request.params.generalProjectId), {
      ...bodies.transitionGeneralProject.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/general-projects/:generalProjectId/phases", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listPhases(context, publicId.parse(request.params.generalProjectId), pageQuery.parse(request.query)));
  });
  router.post("/general-projects/:generalProjectId/phases", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.status(201).json(await projects.createPhase(context, publicId.parse(request.params.generalProjectId), {
      ...bodies.createGeneralProjectPhase.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/general-projects/:generalProjectId/phases/:phaseId/transition", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.transitionPhase(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.phaseId), {
        ...bodies.transitionGeneralProjectPhase.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.get("/general-projects/:generalProjectId/phases/:phaseId/tasks", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listTasks(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.phaseId), pageQuery.parse(request.query)));
  });
  router.post("/general-projects/:generalProjectId/phases/:phaseId/tasks", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.status(201).json(await projects.createTask(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.phaseId), {
        ...bodies.createGeneralProjectTask.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.post("/general-projects/:generalProjectId/members", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.assignMember(context, publicId.parse(request.params.generalProjectId), {
      ...bodies.assignGeneralProjectMember.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/general-projects/:generalProjectId/members/:memberId/unassign", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.unassignMember(context, publicId.parse(request.params.generalProjectId), publicId.parse(request.params.memberId), {
      ...bodies.unassignGeneralProjectMember.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues }); return; }
    if (error instanceof GeneralProjectError || error instanceof GeneralProjectPolicyError) {
      const reason = error instanceof GeneralProjectError ? error.reason : error.code;
      const status = ["NOT_FOUND", "CUSTOMER_NOT_FOUND", "EMPLOYEE_NOT_FOUND", "MEMBER_NOT_FOUND"].includes(reason) ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
