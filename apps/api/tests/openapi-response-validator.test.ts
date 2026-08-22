import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createOpenApiResponseValidator,
  OpenApiResponseContractError,
} from "../src/platform/openapi-response-validator.js";

function contractApp(mode: "valid" | "legacy-problem" | "invalid" | "missing-schema") {
  const app = express();
  app.use(createOpenApiResponseValidator());
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "mcap-finance-api", checks: { database: "up" } });
  });
  app.get("/api/v1/auth/csrf", (_request, response) => {
    if (mode === "legacy-problem") {
      response.status(400).json({ status: 400, code: "VALIDATION_ERROR", errors: [] });
      return;
    }
    if (mode === "invalid") {
      response.json({ csrfToken: "short" });
      return;
    }
    if (mode === "missing-schema") {
      response.status(418).json({ code: "UNDECLARED_STATUS" });
      return;
    }
    response.json({ csrfToken: "x".repeat(32), expiresAt: "2026-08-22T12:00:00.000Z" });
  });
  const errors: ErrorRequestHandler = (error, _request, response, next) => {
    if (!(error instanceof OpenApiResponseContractError)) {
      next(error);
      return;
    }
    response.status(500).json({
      operationId: error.operationId,
      contractStatus: error.status,
      reason: error.reason,
      issueCount: error.issues?.length ?? 0,
    });
  };
  app.use(errors);
  return app;
}

describe("OpenAPI response contract validator", () => {
  it("accepts declared API and root health responses", async () => {
    const app = contractApp("valid");
    await request(app).get("/health").expect(200, {
      status: "ok", service: "mcap-finance-api", checks: { database: "up" },
    });
    await request(app).get("/api/v1/auth/csrf").expect(200, {
      csrfToken: "x".repeat(32), expiresAt: "2026-08-22T12:00:00.000Z",
    });
  });

  it("keeps the declared compatibility envelope for legacy errors", async () => {
    await request(contractApp("legacy-problem"))
      .get("/api/v1/auth/csrf")
      .expect(400, { status: 400, code: "VALIDATION_ERROR", errors: [] });
  });

  it("rejects invalid JSON bodies with contract diagnostics", async () => {
    const response = await request(contractApp("invalid")).get("/api/v1/auth/csrf").expect(500);
    expect(response.body).toMatchObject({
      operationId: "getCsrfToken", contractStatus: 200, reason: "INVALID_BODY",
    });
    expect(response.body.issueCount).toBeGreaterThan(0);
  });

  it("rejects undeclared JSON response statuses", async () => {
    await request(contractApp("missing-schema"))
      .get("/api/v1/auth/csrf")
      .expect(500, {
        operationId: "getCsrfToken", contractStatus: 418, reason: "MISSING_SCHEMA", issueCount: 0,
      });
  });
});
