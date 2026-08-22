import { Router, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { openApiRequestBodySchemas as bodies } from "../generated/openapi-request-guards.js";
import { DataImportParseError } from "./data-import-parser.js";
import { DataImportError, DataImportService } from "./data-import-service.js";
import { dataImportTypes } from "./data-import-types.js";

const importType = z.enum(dataImportTypes);
const format = z.enum(["CSV", "XLSX"]);
const uuid = z.string().uuid();
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const permissions = { CUSTOMERS: "customers.manage", SUPPLIERS: "suppliers.manage", SALES_INVOICES: "sales_invoices.create", PURCHASE_INVOICES: "purchase_invoices.create" } as const;

function sid(request: Request) { return Object.fromEntries((request.headers.cookie ?? "").split(";").map((value) => value.trim().split("=", 2)).filter(([key, value]) => key && value)).sid; }

export function createDataImportRouter(auth: AuthService, service: DataImportService) {
  const router = Router();
  const authorize = (request: Request, permission: string, csrf: boolean) => auth.authorize({ sid: sid(request), csrfToken: request.header("X-CSRF-Token") ?? undefined, permission, requireCsrf: csrf });

  router.get("/data-imports", async (request, response) => {
    const context = await authorize(request, "data_imports.view", false);
    const input = page.parse(request.query);
    const result = await service.list(context, input);
    response.json({ data: result.data, meta: { ...input, total: result.total, totalPages: Math.ceil(result.total / input.pageSize) } });
  });
  router.get("/data-imports/templates/:importType/:format", async (request, response) => {
    await authorize(request, "data_imports.view", false);
    const type = importType.parse(request.params.importType);
    const sourceFormat = format.parse(request.params.format);
    const content = service.template(type, sourceFormat);
    const extension = sourceFormat.toLowerCase();
    response.setHeader("Content-Type", sourceFormat === "CSV" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="${type.toLowerCase()}-import-template.${extension}"`);
    response.send(content);
  });
  router.post("/data-imports/preview", async (request, response) => {
    const context = await authorize(request, "data_imports.view", true);
    const input = bodies.previewDataImport.parse(request.body);
    await authorize(request, permissions[input.importType], false);
    response.status(201).json(await service.preview(context, input.importType, input.sourceFormat, input.contentBase64));
  });
  router.post("/data-imports/:batchId/commit", async (request, response) => {
    const context = await authorize(request, "data_imports.execute", true);
    const input = bodies.commitDataImport.parse(request.body);
    await authorize(request, permissions[input.importType], false);
    const key = z.string().min(16).max(100).parse(request.header("Idempotency-Key"));
    response.json(await service.commit(context, uuid.parse(request.params.batchId), input.importType, input.sourceFormat, input.contentBase64, key));
  });

  const errors: ErrorRequestHandler = (caught, _request, response, next) => {
    if (caught instanceof ZodError) { response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: caught.issues }); return; }
    if (caught instanceof DataImportParseError || caught instanceof DataImportError) {
      const reason = caught.reason;
      const status = reason === "NOT_FOUND" ? 404 : ["INVALID_STATE", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS"].includes(reason) ? 409 : reason === "FILE_TOO_LARGE" ? 413 : 422;
      response.status(status).json({ status, code: status === 409 ? "CONFLICT" : "BUSINESS_RULE_VIOLATION", reason, ...(caught.errors.length ? { errors: caught.errors } : {}) }); return;
    }
    next(caught);
  };
  router.use(errors);
  return router;
}
