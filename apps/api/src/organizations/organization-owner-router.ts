import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import {
  OrganizationMembershipError,
  type OrganizationMembershipService,
} from "../users/organization-membership-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const days = z.coerce.number().int().pipe(z.union([z.literal(30), z.literal(90), z.literal(365)])).default(30);

function sid(request: Request) {
  const entries = (request.headers.cookie ?? "").split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

export function createOrganizationOwnerRouter(auth: AuthService, service: OrganizationMembershipService) {
  const router = Router();
  router.use("/organizations", (_request, response, next) => {
    response.set({ "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" });
    next();
  });
  const authenticate = (request: Request, requireCsrf: boolean) => auth.authenticate({
    sid: sid(request),
    csrfToken: request.header("X-CSRF-Token") ?? undefined,
    requireCsrf,
  });

  router.get("/organizations/workspaces", async (request, response) => {
    const actor = await authenticate(request, false);
    response.json({ data: await service.listWorkspaces(actor.userId) });
  });

  router.get("/organizations/:organizationId/dashboard", async (request, response) => {
    const actor = await authenticate(request, false);
    response.json(await service.dashboard(
      actor.userId,
      id.parse(request.params.organizationId),
      days.parse(request.query.days),
    ));
  });

  router.get("/organizations/:organizationId/members", async (request, response) => {
    const actor = await authenticate(request, false);
    response.json({ data: await service.listMembers(actor.userId, id.parse(request.params.organizationId)) });
  });

  router.post("/organizations/:organizationId/members", async (request, response) => {
    const actor = await authenticate(request, true);
    response.status(201).json(await service.addMember(
      actor.userId,
      id.parse(request.params.organizationId),
      bodies.createOrganizationMember.parse(request.body),
    ));
  });

  router.patch("/organizations/:organizationId/members/:userId", async (request, response) => {
    const actor = await authenticate(request, true);
    response.json(await service.updateMember(
      actor.userId,
      id.parse(request.params.organizationId),
      id.parse(request.params.userId),
      bodies.updateOrganizationMember.parse(request.body),
    ));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ type: "about:blank", title: "Validation failed", status: 400, code: "VALIDATION_ERROR", errors: error.issues });
      return;
    }
    if (error instanceof OrganizationMembershipError) {
      const status = error.reason === "ORGANIZATION_ACCESS_DENIED" || error.reason === "ORGANIZATION_ROLE_FORBIDDEN"
        ? 403
        : error.reason === "ORGANIZATION_NOT_FOUND" || error.reason === "ORGANIZATION_MEMBER_NOT_FOUND"
          ? 404
          : error.reason === "ORGANIZATION_MEMBER_EXISTS" || error.reason === "VERSION_CONFLICT"
            ? 409
            : 422;
      response.status(status).json({
        type: "about:blank",
        title: "Organization membership operation failed",
        status,
        code: error.reason === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : "BUSINESS_RULE_VIOLATION",
        reason: error.reason,
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
