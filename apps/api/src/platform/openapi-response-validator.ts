import type { NextFunction, Request, RequestHandler, Response } from "express";
import { type ZodIssue, type ZodTypeAny } from "zod";
import {
  openApiOperationRoutes,
  openApiResponseBodySchemas,
  type OpenApiJsonResponseOperationId,
} from "../generated/openapi-request-guards.js";

type ResponseSchemaMap = Record<string, ZodTypeAny>;

export class OpenApiResponseContractError extends Error {
  constructor(
    readonly operationId: string,
    readonly status: number,
    readonly issues: ZodIssue[] | undefined,
    readonly reason: "MISSING_SCHEMA" | "INVALID_BODY",
  ) {
    super(`OpenAPI response contract failed for ${operationId} (${status}): ${reason}`);
    this.name = "OpenApiResponseContractError";
  }
}

function normalizedOpenApiPath(request: Request) {
  const routePath = typeof request.route?.path === "string" ? request.route.path : undefined;
  if (!routePath) return undefined;
  const mountedPath = `${request.baseUrl}${routePath === "/" ? "" : routePath}`;
  const openApiPath = mountedPath.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
  const withoutPrefix = openApiPath.replace(/^\/api\/v1(?=\/|$)/u, "");
  return withoutPrefix || "/";
}

function operationIdFor(request: Request) {
  const path = normalizedOpenApiPath(request);
  if (!path) return undefined;
  const key = `${request.method.toUpperCase()} ${path}` as keyof typeof openApiOperationRoutes;
  return openApiOperationRoutes[key];
}

export function createOpenApiResponseValidator(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const sendJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      if (response.locals.openApiResponseValidationBypass === true) return sendJson(body);
      const operationId = operationIdFor(request);
      if (!operationId || !(operationId in openApiResponseBodySchemas)) return sendJson(body);
      const schemas = openApiResponseBodySchemas[operationId as OpenApiJsonResponseOperationId] as ResponseSchemaMap;
      const schema = schemas[String(response.statusCode)] ?? schemas.default;
      if (!schema) {
        response.locals.openApiResponseValidationBypass = true;
        throw new OpenApiResponseContractError(operationId, response.statusCode, undefined, "MISSING_SCHEMA");
      }
      const result = schema.safeParse(body);
      if (!result.success) {
        response.locals.openApiResponseValidationBypass = true;
        throw new OpenApiResponseContractError(operationId, response.statusCode, result.error.issues, "INVALID_BODY");
      }
      return sendJson(body);
    }) as Response["json"];
    next();
  };
}
