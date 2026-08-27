import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  ProfessionalProjectError,
  type ProfessionalProjectService,
} from "./professional-project-service.js";

const publicId = z.string().uuid();
const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const projectQuery = pagination.extend({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).optional(),
  kind: z.enum(["LEGAL_MATTER", "CONSULTING_ENGAGEMENT", "PROFESSIONAL_PROJECT"]).optional(),
  customerId: id.optional(),
});
const timeQuery = pagination.extend({
  projectId: publicId.optional(),
  userId: id.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  billable: booleanQuery.optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: "dateFrom must be before dateTo" });
const timesheetQuery = pagination.extend({
  scope: z.enum(["MY", "ALL"]).default("MY"),
  status: z.enum(["OPEN", "AWAITING_APPROVAL", "APPROVED"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: "dateFrom must be before dateTo" });
const optionQuery = z.object({ search: z.string().trim().min(1).max(200).optional() });

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createProfessionalProjectRouter(auth: AuthService, projects: ProfessionalProjectService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/professional-projects/customer-options", async (request, response) => {
    const context = await authorize(request, "professional_projects.view", false);
    response.json(await projects.listCustomerOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/professional-projects/member-options", async (request, response) => {
    const context = await authorize(request, "professional_projects.view", false);
    response.json(await projects.listMemberOptions(context, optionQuery.parse(request.query).search));
  });
  router.get("/professional-projects", async (request, response) => {
    const context = await authorize(request, "professional_projects.view", false);
    response.json(await projects.listProjects(context, projectQuery.parse(request.query)));
  });
  router.post("/professional-projects", async (request, response) => {
    const context = await authorize(request, "professional_projects.manage", true);
    response.status(201).json(await projects.createProject(context, {
      ...bodies.createProfessionalProject.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/professional-projects/:professionalProjectId", async (request, response) => {
    const context = await authorize(request, "professional_projects.view", false);
    response.json(await projects.getProject(context, publicId.parse(request.params.professionalProjectId)));
  });
  router.patch("/professional-projects/:professionalProjectId", async (request, response) => {
    const context = await authorize(request, "professional_projects.manage", true);
    response.json(await projects.updateProject(
      context,
      publicId.parse(request.params.professionalProjectId),
      bodies.updateProfessionalProject.parse(request.body),
    ));
  });
  router.post("/professional-projects/:professionalProjectId/transition", async (request, response) => {
    const context = await authorize(request, "professional_projects.manage", true);
    response.json(await projects.transitionProject(
      context,
      publicId.parse(request.params.professionalProjectId),
      { ...bodies.transitionProfessionalProject.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.post("/professional-projects/:professionalProjectId/members", async (request, response) => {
    const context = await authorize(request, "professional_projects.manage", true);
    response.json(await projects.assignMember(
      context,
      publicId.parse(request.params.professionalProjectId),
      { ...bodies.assignProfessionalProjectMember.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.post("/professional-projects/:professionalProjectId/members/:userId/unassign", async (request, response) => {
    const context = await authorize(request, "professional_projects.manage", true);
    response.json(await projects.unassignMember(
      context,
      publicId.parse(request.params.professionalProjectId),
      id.parse(request.params.userId),
      { ...bodies.unassignProfessionalProjectMember.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.get("/professional-time-entries", async (request, response) => {
    const context = await authorize(request, "professional_time.view", false);
    response.json(await projects.listTimeEntries(context, timeQuery.parse(request.query)));
  });
  router.post("/professional-time-entries", async (request, response) => {
    const context = await authorize(request, "professional_time.log", true);
    response.status(201).json(await projects.createTimeEntry(context, {
      ...bodies.createProfessionalTimeEntry.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.patch("/professional-time-entries/:professionalTimeEntryId", async (request, response) => {
    const context = await authorize(request, "professional_time.log", true);
    response.json(await projects.updateTimeEntry(
      context,
      publicId.parse(request.params.professionalTimeEntryId),
      bodies.updateProfessionalTimeEntry.parse(request.body),
    ));
  });
  router.delete("/professional-time-entries/:professionalTimeEntryId", async (request, response) => {
    const context = await authorize(request, "professional_time.log", true);
    response.json(await projects.deleteTimeEntry(
      context,
      publicId.parse(request.params.professionalTimeEntryId),
      bodies.deleteProfessionalTimeEntry.parse(request.body),
    ));
  });
  router.get("/professional-timesheets", async (request, response) => {
    const context = await authorize(request, "professional_timesheets.view", false);
    response.json(await projects.listTimesheets(context, timesheetQuery.parse(request.query)));
  });
  router.post("/professional-timesheets", async (request, response) => {
    const context = await authorize(request, "professional_timesheets.submit", true);
    response.status(201).json(await projects.createTimesheet(context, {
      ...bodies.createProfessionalTimesheet.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.get("/professional-timesheets/:professionalTimesheetId", async (request, response) => {
    const context = await authorize(request, "professional_timesheets.view", false);
    response.json(await projects.getTimesheet(context, publicId.parse(request.params.professionalTimesheetId)));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ProfessionalProjectError) {
      const status = ["NOT_FOUND", "CUSTOMER_NOT_FOUND", "USER_NOT_FOUND", "MEMBER_NOT_FOUND", "NOT_TIMESHEET_OWNER"].includes(error.reason)
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(error.reason)
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
