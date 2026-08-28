import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { ProfessionalAccessError, type ProfessionalProjectAccessService } from "./professional-project-access-service.js";

const publicId = z.string().uuid();
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;

export function createProfessionalProjectAccessRouter(auth: AuthService, access: ProfessionalProjectAccessService) {
  const router = Router();
  const authorize = (request: Request, requireCsrf: boolean) => auth.authorize({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    permission: "professional_access.manage",
    requireCsrf,
  });

  router.get("/professional-projects/:professionalProjectId/access", async (request, response) => {
    const context = await authorize(request, false);
    response.json(await access.getAccess(context, publicId.parse(request.params.professionalProjectId)));
  });
  router.patch("/professional-projects/:professionalProjectId/access", async (request, response) => {
    const context = await authorize(request, true);
    response.json(await access.updateAccessMode(context, publicId.parse(request.params.professionalProjectId), bodies.updateProfessionalProjectAccess.parse(request.body)));
  });
  router.post("/professional-projects/:professionalProjectId/access-grants", async (request, response) => {
    const context = await authorize(request, true);
    response.status(201).json(await access.grantAccess(context, publicId.parse(request.params.professionalProjectId), {
      ...bodies.grantProfessionalProjectAccess.parse(request.body),
      idempotencyKey: idempotencyKey(request),
    }));
  });
  router.post("/professional-projects/:professionalProjectId/access-grants/:professionalProjectAccessGrantId/revoke", async (request, response) => {
    const context = await authorize(request, true);
    response.json(await access.revokeAccess(
      context,
      publicId.parse(request.params.professionalProjectId),
      publicId.parse(request.params.professionalProjectAccessGrantId),
      { ...bodies.revokeProfessionalProjectAccess.parse(request.body), idempotencyKey: idempotencyKey(request) },
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof ProfessionalAccessError) {
      const status = ["NOT_FOUND", "GRANT_NOT_FOUND"].includes(error.reason)
        ? 404
        : ["VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "GRANT_ALREADY_ACTIVE", "GRANT_ALREADY_REVOKED"].includes(error.reason)
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
