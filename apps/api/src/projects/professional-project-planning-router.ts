import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  ProfessionalPlanningError,
  type ProfessionalProjectPlanningService,
} from "./professional-project-planning-service.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));

function sid(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
}

export function createProfessionalProjectPlanningRouter(
  auth: AuthService,
  planning: ProfessionalProjectPlanningService,
) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission,
    requireCsrf,
  });

  router.get("/professional-projects/:professionalProjectId/plan", async (request, response) => {
    const context = await authorize(request, "professional_planning.view", false);
    response.json(await planning.getPlan(
      context,
      publicId.parse(request.params.professionalProjectId),
    ));
  });

  router.patch("/professional-projects/:professionalProjectId/time-budget", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.json(await planning.updateTimeBudget(
      context,
      publicId.parse(request.params.professionalProjectId),
      bodies.updateProfessionalProjectTimeBudget.parse(request.body),
    ));
  });

  router.post("/professional-projects/:professionalProjectId/stages", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.status(201).json(await planning.createStage(
      context,
      publicId.parse(request.params.professionalProjectId),
      {
        ...bodies.createProfessionalProjectStage.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  router.patch("/professional-project-stages/:professionalProjectStageId", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.json(await planning.updateStage(
      context,
      publicId.parse(request.params.professionalProjectStageId),
      bodies.updateProfessionalProjectStage.parse(request.body),
    ));
  });

  router.post("/professional-project-stages/:professionalProjectStageId/transition", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.json(await planning.transitionStage(
      context,
      publicId.parse(request.params.professionalProjectStageId),
      {
        ...bodies.transitionProfessionalProjectStage.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  router.post("/professional-project-stages/:professionalProjectStageId/tasks", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.status(201).json(await planning.createTask(
      context,
      publicId.parse(request.params.professionalProjectStageId),
      {
        ...bodies.createProfessionalProjectTask.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  router.patch("/professional-project-tasks/:professionalProjectTaskId", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.json(await planning.updateTask(
      context,
      publicId.parse(request.params.professionalProjectTaskId),
      bodies.updateProfessionalProjectTask.parse(request.body),
    ));
  });

  router.post("/professional-project-tasks/:professionalProjectTaskId/transition", async (request, response) => {
    const context = await authorize(request, "professional_tasks.progress", true);
    response.json(await planning.transitionTask(
      context,
      publicId.parse(request.params.professionalProjectTaskId),
      {
        ...bodies.transitionProfessionalProjectTask.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  router.post("/professional-project-task-dependencies", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.status(201).json(await planning.addDependency(context, {
      ...bodies.createProfessionalProjectTaskDependency.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });

  router.post("/professional-project-task-dependencies/:professionalProjectTaskDependencyId/remove", async (request, response) => {
    const context = await authorize(request, "professional_planning.manage", true);
    response.json(await planning.removeDependency(
      context,
      publicId.parse(request.params.professionalProjectTaskDependencyId),
      {
        ...bodies.removeProfessionalProjectTaskDependency.parse(request.body),
        idempotencyKey: idempotencyKey(request),
      },
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ProfessionalPlanningError) {
      const status = error.reason === "TASK_PROGRESS_FORBIDDEN"
        ? 403
        : ["NOT_FOUND", "STAGE_NOT_FOUND", "TASK_NOT_FOUND", "DEPENDENCY_NOT_FOUND"].includes(error.reason)
          ? 404
          : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "DEPENDENCY_DUPLICATE", "DEPENDENCY_CYCLE"].includes(error.reason)
            ? 409
            : 422;
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
