import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { AuthError, type AuthService } from "../auth/auth-service.js";
import { PlatformSubscriptionError } from "./platform-subscription-service.js";
import type { SubscriptionUsageService } from "./subscription-usage-service.js";

export function createSubscriptionUsageRouter(
  auth: Pick<AuthService, "authorize">, service: Pick<SubscriptionUsageService, "companyUsage">,
) {
  const router = Router();
  router.get("/subscription/usage", async (request, response) => {
    response.set({ "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" });
    const sid = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("sid="))?.slice(4);
    const actor = await auth.authorize({ sid, permission: "subscriptions.view", requireCsrf: false });
    if (!actor.companyId || actor.companyId <= 0n) throw new AuthError("FORBIDDEN");
    z.object({}).strict().parse(request.query);
    response.json(await service.companyUsage(actor.companyId));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof PlatformSubscriptionError)) { next(error); return; }
    const status = error.reason === "NOT_FOUND" ? 404 : 403;
    response.status(status).json({ type: "about:blank", title: "Subscription usage unavailable", status, code: error.reason, reason: error.reason });
  };
  router.use(errors);
  return router;
}
