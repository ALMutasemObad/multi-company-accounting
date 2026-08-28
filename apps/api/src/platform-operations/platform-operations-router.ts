import { Router, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import {
  PlatformOperationsError,
  type PlatformOperationsService,
} from "./platform-operations-service.js";

const querySchema = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform((value) => Number(value) as 7 | 30 | 90),
});

function sid(request: Request) {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries).sid;
}

export function createPlatformOperationsRouter(
  auth: AuthService,
  platform: PlatformOperationsService,
) {
  const router = Router();

  router.get("/platform/capabilities", async (request, response) => {
    const actor = await auth.authenticate({ sid: sid(request) });
    response.json(await platform.capabilities(actor.userId));
  });

  router.get("/platform/overview", async (request, response) => {
    const actor = await auth.authenticate({ sid: sid(request) });
    const query = querySchema.parse(request.query);
    response.json(await platform.overview(actor.userId, query.days));
  });

  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof PlatformOperationsError) {
      response.status(403).json({
        type: "about:blank",
        title: "Platform operations access denied",
        status: 403,
        code: error.reason,
      });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
