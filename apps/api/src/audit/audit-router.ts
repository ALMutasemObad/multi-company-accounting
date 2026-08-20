import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import type { AuditService } from "./audit-service.js";

const id = z.string().regex(/^[1-9][0-9]*$/).transform(BigInt);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterShape = { search: z.string().trim().max(200).optional(), userId: id.optional(), action: z.string().trim().max(120).optional(), entityType: z.string().trim().max(80).optional(), dateFrom: date.optional(), dateTo: date.optional() };
const validRange = (value: { dateFrom?: string | undefined; dateTo?: string | undefined }) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo;
const filters = z.object(filterShape).refine(validRange, { message: "dateFrom must be before or equal to dateTo" });
const listQuery = z.object({ ...filterShape, page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).refine(validRange, { message: "dateFrom must be before or equal to dateTo" });
const sid = (request: Request) => Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)).sid;
const serialize = (row: any) => ({ id: row.id.toString(), actor: { id: row.actor.id.toString(), name: row.actor.displayName, email: row.actor.emailNormalized }, action: row.action, entityType: row.entityType, entityId: row.entityId, details: row.details, createdAt: row.createdAt.toISOString() });

export function createAuditRouter(auth: AuthService, audit: AuditService) {
  const router = Router();
  const authorize = (request: Request, permission: string) => auth.authorize({ sid: sid(request), permission, requireCsrf: false });
  router.get("/audit-logs", async (request, response) => {
    const context = await authorize(request, "audit_logs.view");
    const query = listQuery.parse(request.query);
    const result = await audit.list(context, query);
    response.json({ data: result.data.map(serialize), meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) } });
  });
  router.get("/audit-logs/options", async (request, response) => {
    const context = await authorize(request, "audit_logs.view");
    const result = await audit.options(context);
    response.json({ ...result, users: result.users.map((user) => ({ id: user.id.toString(), name: user.displayName, email: user.emailNormalized })) });
  });
  router.get("/audit-logs/export.csv", async (request, response) => {
    const context = await authorize(request, "audit_logs.export");
    const result = await audit.exportCsv(context, filters.parse(request.query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    response.setHeader("X-Export-Row-Count", String(result.count));
    response.setHeader("X-Export-Truncated", String(result.truncated));
    response.send(result.csv);
  });
  router.get("/audit-logs/:id", async (request, response) => {
    const context = await authorize(request, "audit_logs.view");
    const row = await audit.get(context, id.parse(request.params.id));
    if (!row) { response.status(404).json({ status: 404, code: "NOT_FOUND" }); return; }
    response.json(serialize(row));
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => { if (error instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: error.issues }); return; } next(error); };
  router.use(errors);
  return router;
}
