import { Router, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { PUBLIC_PLAN_MAX_PAGE } from "./public-plan-catalog.js";
import {
  PlatformSubscriptionError,
  SUBSCRIPTION_DEFAULT_PAGE_SIZE,
  SUBSCRIPTION_MAX_PAGE_SIZE,
  type PlatformSubscriptionCatalogService,
  type PlatformSubscriptionLifecycleService,
} from "./platform-subscription-service.js";

const identifier = z.string().regex(/^[1-9][0-9]*$/u).transform(BigInt);
const publicId = z.string().uuid();
const createPlatformSubscriptionPlanRequestSchema = bodies.createPlatformSubscriptionPlan;
const updatePlatformSubscriptionPlanDraftRequestSchema = bodies.updatePlatformSubscriptionPlanDraft;
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SUBSCRIPTION_MAX_PAGE_SIZE).default(SUBSCRIPTION_DEFAULT_PAGE_SIZE),
});
const planListQuery = pagination.extend({
  search: z.string().trim().max(200).optional(),
  active: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
  publicationStatus: z.enum(["ALL", "DRAFT", "PUBLISHED"]).default("ALL"),
});
const subscriptionListQuery = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["ALL", "TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"]).default("ALL"),
});
const idempotencyKey = (request: Request) => z.string().min(16).max(100).parse(request.header("Idempotency-Key"));

function sid(request: Request) {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

export function createPlatformSubscriptionRouter(
  auth: AuthService,
  catalog: PlatformSubscriptionCatalogService,
  lifecycle: PlatformSubscriptionLifecycleService,
) {
  const router = Router();
  router.get("/public/subscription-plans", async (request, response) => {
    const query = z.object({ page: z.coerce.number().int().min(1).max(PUBLIC_PLAN_MAX_PAGE).default(1) }).strict().parse(request.query);
    response.json(await catalog.publicCatalog(query.page));
  });
  const authenticate = (request: Request, requireCsrf = false) => auth.authenticate({
    sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, requireCsrf,
  });
  const platformActor = async (request: Request, requireCsrf = false) => {
    const actor = await authenticate(request, requireCsrf);
    return { userId: actor.userId };
  };
  const companyActor = (request: Request, permission: "subscriptions.view" | "subscriptions.manage", requireCsrf: boolean) =>
    auth.authorize({
      sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined,
      permission, requireCsrf,
    });

  router.get("/platform/subscription-modules", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await catalog.listModules(actor.userId));
  });
  router.get("/platform/subscription-plans", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await catalog.listPlans(actor.userId, planListQuery.parse(request.query)));
  });
  router.post("/platform/subscription-plans", async (request, response) => {
    const actor = await platformActor(request, true);
    response.status(201).json(await catalog.createPlan(actor, createPlatformSubscriptionPlanRequestSchema.parse(request.body)));
  });
  router.get("/platform/subscription-plans/:planId", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await catalog.plan(actor.userId, identifier.parse(request.params.planId)));
  });
  router.patch("/platform/subscription-plans/:planId", async (request, response) => {
    const actor = await platformActor(request, true);
    response.json(await catalog.updatePlan(
      actor, identifier.parse(request.params.planId),
      bodies.updatePlatformSubscriptionPlan.parse(request.body),
    ));
  });
  router.post("/platform/subscription-plans/:planId/versions", async (request, response) => {
    const actor = await platformActor(request, true);
    response.status(201).json(await catalog.createDraft(actor, identifier.parse(request.params.planId)));
  });
  router.put("/platform/subscription-plan-versions/:planVersionId", async (request, response) => {
    const actor = await platformActor(request, true);
    response.json(await catalog.updateDraft(
      actor, identifier.parse(request.params.planVersionId),
      updatePlatformSubscriptionPlanDraftRequestSchema.parse(request.body),
    ));
  });
  router.post("/platform/subscription-plan-versions/:planVersionId/publish", async (request, response) => {
    const actor = await platformActor(request, true);
    const body = bodies.publishPlatformSubscriptionPlanVersion.parse(request.body);
    response.json(await catalog.publish(actor, identifier.parse(request.params.planVersionId), body.version));
  });
  router.put("/platform/subscription-plan-versions/:planVersionId/public-listing", async (request, response) => {
    const actor = await platformActor(request, true);
    response.json(await catalog.setPublicListing(
      actor, identifier.parse(request.params.planVersionId), bodies.setPlatformSubscriptionPublicListing.parse(request.body),
    ));
  });
  router.get("/platform/subscriptions", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await lifecycle.listSubscriptions(actor.userId, subscriptionListQuery.parse(request.query)));
  });
  router.get("/platform/companies/:companyId/subscription", async (request, response) => {
    const actor = await authenticate(request);
    response.json(await lifecycle.operatorCompany(
      actor.userId, identifier.parse(request.params.companyId), pagination.parse(request.query),
    ));
  });
  router.post("/platform/companies/:companyId/subscription-changes", async (request, response) => {
    const actor = await authenticate(request, true);
    const body = bodies.schedulePlatformCompanySubscriptionChange.parse(request.body);
    response.status(201).json(await lifecycle.scheduleOperatorChange(
      actor, identifier.parse(request.params.companyId), { ...body, idempotencyKey: idempotencyKey(request) },
    ));
  });
  router.post("/platform/subscription-change-requests/:changeId/decision", async (request, response) => {
    const actor = await authenticate(request, true);
    const body = bodies.decidePlatformSubscriptionChangeRequest.parse(request.body);
    response.json(await lifecycle.decideOwnerRequest(
      actor, publicId.parse(request.params.changeId), { ...body, idempotencyKey: idempotencyKey(request) },
    ));
  });

  router.get("/subscription", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.view", false);
    response.json(await lifecycle.ownerCompany(actor.companyId, pagination.parse(request.query)));
  });
  router.get("/subscription/catalog", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.view", false);
    response.json(await lifecycle.ownerCatalog(actor.companyId, pagination.parse(request.query)));
  });
  router.post("/subscription/change-requests", async (request, response) => {
    const actor = await companyActor(request, "subscriptions.manage", true);
    const body = bodies.requestCompanySubscriptionChange.parse(request.body);
    response.status(201).json(await lifecycle.requestOwnerChange(actor, { ...body, idempotencyKey: idempotencyKey(request) }));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof PlatformSubscriptionError)) {
      next(error);
      return;
    }
    const conflicts = new Set([
      "VERSION_CONFLICT", "PUBLISHED_VERSION_IMMUTABLE", "DRAFT_ALREADY_EXISTS",
      "PLAN_CODE_EXISTS",
      "TRIAL_ALREADY_USED", "CHANGE_ALREADY_SCHEDULED", "CHANGE_ALREADY_PENDING",
      "INVALID_CHANGE_STATE", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS",
    ]);
    const status = error.reason === "NOT_FOUND" ? 404
      : error.reason === "FORBIDDEN" ? 403
        : conflicts.has(error.reason) ? 409 : 422;
    response.status(status).json({
      type: "about:blank",
      title: status === 404 ? "Subscription resource not found"
        : status === 403 ? "Subscription access denied" : "Subscription business rule violation",
      status,
      code: status === 409 ? "CONFLICT" : status === 422 ? "BUSINESS_RULE_VIOLATION" : error.reason,
      reason: error.reason,
    });
  };
  router.use(errors);
  return router;
}
