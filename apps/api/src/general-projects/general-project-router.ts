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
  customerId: id.optional(), scope: z.enum(["ALL", "MINE", "FOLLOWING"]).default("ALL"),
});
const optionQuery = z.object({ search: z.string().trim().min(1).max(200).optional() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const dependencyQuery = pageQuery.extend({ taskId: publicId.optional() });

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
  router.post("/general-projects/:generalProjectId/follow", async (request, response) => {
    await authorize(request, "general_projects.view", false);
    const context = await authorize(request, "general_projects.follow", true);
    response.json(await projects.followProject(context, publicId.parse(request.params.generalProjectId),
      { idempotencyKey: idempotencyKey(request) }));
  });
  router.post("/general-projects/:generalProjectId/unfollow", async (request, response) => {
    await authorize(request, "general_projects.view", false);
    const context = await authorize(request, "general_projects.follow", true);
    response.json(await projects.unfollowProject(context, publicId.parse(request.params.generalProjectId),
      { idempotencyKey: idempotencyKey(request) }));
  });
  router.get("/general-projects/:generalProjectId/comments", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listComments(context, publicId.parse(request.params.generalProjectId),
      dependencyQuery.parse(request.query)));
  });
  router.post("/general-projects/:generalProjectId/comments", async (request, response) => {
    await authorize(request, "general_projects.view", false);
    const context = await authorize(request, "general_projects.comment", true);
    response.status(201).json(await projects.addComment(context, publicId.parse(request.params.generalProjectId),
      { ...bodies.addGeneralProjectComment.parse(request.body), idempotencyKey: idempotencyKey(request) }));
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
  router.patch("/general-projects/:generalProjectId/phases/:phaseId", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.updatePhase(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.phaseId), {
        ...bodies.updateGeneralProjectPhase.parse(request.body), idempotencyKey: idempotencyKey(request),
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
  router.get("/general-projects/:generalProjectId/task-options", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listTaskOptions(context, publicId.parse(request.params.generalProjectId),
      optionQuery.parse(request.query).search));
  });
  router.post("/general-projects/:generalProjectId/phases/:phaseId/tasks", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.status(201).json(await projects.createTask(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.phaseId), {
        ...bodies.createGeneralProjectTask.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.patch("/general-projects/:generalProjectId/tasks/:taskId", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.updateTask(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), {
        ...bodies.updateGeneralProjectTask.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.get("/general-projects/:generalProjectId/tasks/:taskId/assignments", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listTaskAssignments(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), pageQuery.parse(request.query)));
  });
  router.post("/general-projects/:generalProjectId/tasks/:taskId/assignments", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.assignTaskMember(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), {
        ...bodies.assignGeneralProjectTaskMember.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.post("/general-projects/:generalProjectId/tasks/:taskId/assignments/:assignmentId/unassign", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.unassignTaskMember(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), publicId.parse(request.params.assignmentId), {
        ...bodies.unassignGeneralProjectTaskMember.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.post("/general-projects/:generalProjectId/tasks/:taskId/transition", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.transitionTask(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), {
        ...bodies.transitionGeneralProjectTask.parse(request.body), idempotencyKey: idempotencyKey(request),
      }));
  });
  router.post("/general-projects/:generalProjectId/tasks/:taskId/progress", async (request, response) => {
    const context = await authorize(request, "general_projects.progress", true);
    response.json(await projects.transitionTask(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.taskId), {
        ...bodies.progressGeneralProjectTask.parse(request.body), idempotencyKey: idempotencyKey(request),
      }, "PROGRESS"));
  });
  router.get("/general-projects/:generalProjectId/task-dependencies", async (request, response) => {
    const context = await authorize(request, "general_projects.view", false);
    response.json(await projects.listDependencies(context, publicId.parse(request.params.generalProjectId),
      dependencyQuery.parse(request.query)));
  });
  router.post("/general-projects/:generalProjectId/task-dependencies", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.status(201).json(await projects.addDependency(context, publicId.parse(request.params.generalProjectId), {
      ...bodies.addGeneralProjectTaskDependency.parse(request.body), idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/general-projects/:generalProjectId/task-dependencies/:dependencyId/remove", async (request, response) => {
    const context = await authorize(request, "general_projects.manage", true);
    response.json(await projects.removeDependency(context, publicId.parse(request.params.generalProjectId),
      publicId.parse(request.params.dependencyId), {
        ...bodies.removeGeneralProjectTaskDependency.parse(request.body), idempotencyKey: idempotencyKey(request),
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
      const status = ["NOT_FOUND", "CUSTOMER_NOT_FOUND", "EMPLOYEE_NOT_FOUND", "MEMBER_NOT_FOUND", "ASSIGNMENT_NOT_FOUND"].includes(reason) ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason) ? 409 : 422;
      response.status(status).json({ status, code: "BUSINESS_RULE_VIOLATION", reason }); return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
