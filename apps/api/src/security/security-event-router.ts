import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import type { SecurityEventService } from "./security-event-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const severity = z.enum(["INFO", "WARNING", "HIGH", "CRITICAL"]);
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  eventType: z.string().trim().max(80).optional(),
  severity: severity.optional(),
  userId: id.optional(),
  unacknowledgedOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  dateFrom: date.optional(),
  dateTo: date.optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: "dateFrom must be before or equal to dateTo" });
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
type SecurityEventRow = NonNullable<Awaited<ReturnType<SecurityEventService["acknowledge"]>>>;
const serialize = (row: SecurityEventRow) => ({
  id: row.id.toString(), eventType: row.eventType, severity: row.severity,
  user: row.user ? { id: row.user.id.toString(), name: row.user.displayName, email: row.user.emailNormalized } : null,
  email: row.emailSnapshot, ipAddress: row.ipAddress, userAgent: row.userAgent, details: row.details,
  sessionId: row.sessionId?.toString() ?? null, createdAt: row.createdAt.toISOString(),
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  acknowledgedBy: row.acknowledgedBy ? { id: row.acknowledgedBy.id.toString(), name: row.acknowledgedBy.displayName } : null,
});

export function createSecurityEventRouter(auth: AuthService, security: SecurityEventService) {
  const router = Router();
  const authorize = (request: Request, permission: string, requireCsrf = false) => auth.authorize({ sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf });
  router.get("/security-events", async (request, response) => {
    const context = await authorize(request, "security_events.view");
    const filters = query.parse(request.query);
    const result = await security.list(context, filters);
    response.json({ data: result.data.map(serialize), meta: { page: filters.page, pageSize: filters.pageSize, total: result.total, totalPages: Math.ceil(result.total / filters.pageSize) } });
  });
  router.get("/security-events/summary", async (request, response) => {
    const context = await authorize(request, "security_events.view");
    const result = await security.summary(context);
    response.json({ ...result, latestCriticalAt: result.latestCriticalAt?.toISOString() ?? null });
  });
  router.get("/security-events/options", async (request, response) => {
    const context = await authorize(request, "security_events.view");
    const result = await security.options(context);
    response.json({ eventTypes: result.eventTypes, users: result.users.map((user) => ({ id: user.id.toString(), name: user.displayName, email: user.emailNormalized })) });
  });
  router.post("/security-events/:id/acknowledge", async (request, response) => {
    const context = await authorize(request, "security_events.acknowledge", true);
    const result = await security.acknowledge(context, id.parse(request.params.id));
    if (!result) { response.status(404).json({ status: 404, code: "NOT_FOUND" }); return; }
    response.json(serialize(result));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues }); return; } next(error); };
  router.use(errors);
  return router;
}
