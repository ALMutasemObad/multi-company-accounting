import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AuthError, type AuthService } from "../src/auth/auth-service.js";
import { createPayrollRouter } from "../src/payroll/payroll-router.js";
import { PayrollError } from "../src/payroll/payroll-service.js";

const employeeId = "1b7a8d78-a340-46c0-a059-4bf1acd6a746";
const agreementId = "999f495d-e7b8-4a1c-b078-cfa77ad32cbf";
const runId = "f7b3b238-8f7a-42f4-bf29-f6c10a8661e7";
const context = { companyId: 11n, userId: 22n };
const commandKey = "payroll-router-test-key-1234";
const salary = "87654.32";
const agreementBody = { employeeId, startsOn: "2026-10-01", basicSalary: salary, fixedAllowance: "1234.56" };
const runBody = { periodStart: "2026-10-01", periodEndExclusive: "2026-11-01" };
const endBody = { expectedVersion: 3, endsBefore: "2026-11-01" };
const writes = [
  { path: "/payroll/agreements", method: "createAgreement", permission: "payroll.agreements.manage", body: agreementBody, status: 201, id: null },
  { path: `/payroll/agreements/${agreementId}/end`, method: "endAgreement", permission: "payroll.agreements.manage", body: endBody, status: 200, id: agreementId },
  { path: "/payroll/runs", method: "createRun", permission: "payroll.runs.manage", body: runBody, status: 201, id: null },
  { path: `/payroll/runs/${runId}/calculate`, method: "calculateRun", permission: "payroll.runs.manage", body: { expectedVersion: 2 }, status: 200, id: runId },
] as const;

function fixture() {
  const authorize = vi.fn<AuthService["authorize"]>().mockResolvedValue(context as never);
  const payroll = {
    capabilities: vi.fn().mockResolvedValue({ canReadPrivate: false, currencyCode: "SAR", currencyDecimals: 2 }),
    listEmployees: vi.fn().mockResolvedValue({ data: [] }),
    listAgreements: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    listRuns: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    getRun: vi.fn().mockResolvedValue({ run: { id: runId }, details: null }),
    createAgreement: vi.fn().mockResolvedValue({ id: agreementId, version: 0 }),
    endAgreement: vi.fn().mockResolvedValue({ id: agreementId, version: 4 }),
    createRun: vi.fn().mockResolvedValue({ id: runId, version: 0 }),
    calculateRun: vi.fn().mockResolvedValue({ id: runId, version: 3 }),
  };
  const app = express();
  app.use(express.json());
  app.use(createPayrollRouter({ authorize } as never, payroll as never));
  // Auth failures belong to the application's outer handler, not the payroll router.
  const authErrors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AuthError) { res.status(403).json({ code: error.reason }); return; }
    next(error);
  };
  app.use(authErrors);
  const write = (call: request.Test) => call.set("Cookie", "other=ignored; sid=payroll-session")
    .set("X-CSRF-Token", "payroll-csrf").set("Idempotency-Key", commandKey);
  return { app, authorize, payroll, write };
}

describe("payroll HTTP boundary", () => {
  it("authorizes every read with its scoped permission and forwards bounded queries", async () => {
    const { app, authorize, payroll } = fixture();
    await request(app).get("/payroll/capabilities").expect(200);
    await request(app).get("/payroll/employees").query({ search: "  موظف  " }).expect(200);
    await request(app).get("/payroll/agreements?page=2&pageSize=10").expect(200);
    await request(app).get("/payroll/runs").expect(200);
    await request(app).get(`/payroll/runs/${runId}`).expect(200, { run: { id: runId }, details: null });
    expect(authorize.mock.calls.map(([input]) => [input.permission, input.requireCsrf])).toEqual([
      ["payroll.view", false], ["payroll.agreements.manage", false], ["payroll.agreements.manage", false],
      ["payroll.view", false], ["payroll.view", false],
    ]);
    expect(payroll.capabilities).toHaveBeenCalledWith(context);
    expect(payroll.listEmployees).toHaveBeenCalledWith(context, "موظف");
    expect(payroll.listAgreements).toHaveBeenCalledWith(context, 2, 10);
    expect(payroll.listRuns).toHaveBeenCalledWith(context, 1, 25);
    expect(payroll.getRun).toHaveBeenCalledWith(context, runId);
  });

  it.each(["/payroll/capabilities", "/payroll/employees", "/payroll/agreements", "/payroll/runs", `/payroll/runs/${runId}`])(
    "does not call any payroll service when read permission is denied: %s", async path => {
      const { app, authorize, payroll } = fixture();
      authorize.mockRejectedValue(new AuthError("FORBIDDEN"));
      await request(app).get(path).expect(403);
      for (const method of Object.values(payroll)) expect(method).not.toHaveBeenCalled();
    },
  );

  it.each(writes)("requires CSRF and $permission, forwarding exact body and key: $method", async operation => {
    const { app, authorize, payroll, write } = fixture();
    await write(request(app).post(operation.path)).send(operation.body).expect(operation.status);
    expect(authorize).toHaveBeenCalledExactlyOnceWith({ sid: "payroll-session", csrfToken: "payroll-csrf", permission: operation.permission, requireCsrf: true });
    const args = [context, ...(operation.id ? [operation.id] : []), { ...operation.body, idempotencyKey: commandKey }];
    expect(payroll[operation.method]).toHaveBeenCalledExactlyOnceWith(...args);
  });

  it.each(writes)("stops $method when AuthService rejects missing CSRF or permission", async operation => {
    const { app, authorize, payroll, write } = fixture();
    authorize.mockImplementation(async input => {
      if (input.requireCsrf && !input.csrfToken) throw new AuthError("INVALID_CSRF");
      throw new AuthError("FORBIDDEN");
    });
    await request(app).post(operation.path).set("Idempotency-Key", commandKey).send(operation.body).expect(403, { code: "INVALID_CSRF" });
    await write(request(app).post(operation.path)).send(operation.body).expect(403, { code: "FORBIDDEN" });
    expect(authorize.mock.calls.every(([input]) => input.requireCsrf && input.permission === operation.permission)).toBe(true);
    expect(payroll[operation.method]).not.toHaveBeenCalled();
  });

  it.each(writes)("requires a 16–100 character idempotency key for $method", async operation => {
    const { app, payroll } = fixture();
    for (const invalidKey of [undefined, "short", "k".repeat(101)]) {
      const call = request(app).post(operation.path).set("X-CSRF-Token", "payroll-csrf");
      if (invalidKey !== undefined) call.set("Idempotency-Key", invalidKey);
      await call.send(operation.body).expect(400, { status: 400, code: "VALIDATION_ERROR" });
    }
    expect(payroll[operation.method]).not.toHaveBeenCalled();
  });

  it.each(writes)("uses a strict generated body without echoing sensitive input: $method", async operation => {
    const { app, payroll, write } = fixture();
    const response = await write(request(app).post(operation.path)).send({ ...operation.body, [`private-salary-${salary}`]: salary })
      .expect(400, { status: 400, code: "VALIDATION_ERROR" });
    expect(response.text).not.toContain(salary);
    expect(response.text).not.toContain("basicSalary");
    await write(request(app).post(operation.path)).send({}).expect(400, { status: 400, code: "VALIDATION_ERROR" });
    expect(payroll[operation.method]).not.toHaveBeenCalled();
  });

  it.each([
    { ...agreementBody, employeeId: "not-a-uuid" },
    { ...agreementBody, startsOn: "2026-02-30" },
    { ...agreementBody, endsBefore: "tomorrow" },
    { ...agreementBody, basicSalary: Number(salary) },
    { ...agreementBody, basicSalary: `-${salary}` },
    { ...agreementBody, fixedAllowance: "private-salary-marker" },
  ])("rejects malformed agreement values without leaking salary (case %#)", async body => {
    const { app, payroll, write } = fixture();
    const response = await write(request(app).post("/payroll/agreements")).send(body)
      .expect(400, { status: 400, code: "VALIDATION_ERROR" });
    expect(response.text).not.toContain(salary);
    expect(response.text).not.toContain("private-salary-marker");
    expect(payroll.createAgreement).not.toHaveBeenCalled();
  });

  it("allows nullable optional agreement fields without coercing salary decimals", async () => {
    const { app, payroll, write } = fixture();
    const body = { ...agreementBody, endsBefore: null, fixedAllowance: null };
    await write(request(app).post("/payroll/agreements")).send(body).expect(201);
    expect(payroll.createAgreement).toHaveBeenCalledWith(context, { ...body, idempotencyKey: commandKey });
  });

  it("validates UUID route parameters before calling run or end-agreement methods", async () => {
    const { app, payroll, write } = fixture();
    await request(app).get("/payroll/runs/not-a-uuid").expect(400);
    await write(request(app).post("/payroll/runs/not-a-uuid/calculate")).send({ expectedVersion: 0 }).expect(400);
    await write(request(app).post("/payroll/agreements/not-a-uuid/end")).send(endBody).expect(400);
    expect(payroll.getRun).not.toHaveBeenCalled();
    expect(payroll.calculateRun).not.toHaveBeenCalled();
    expect(payroll.endAgreement).not.toHaveBeenCalled();
  });

  it("rejects invalid generated date/version fields for run creation, calculation and agreement ending", async () => {
    const { app, payroll, write } = fixture();
    for (const body of [{ ...runBody, periodStart: "2026-02-30" }, { ...runBody, periodEndExclusive: "2026-11-01T00:00:00Z" }]) {
      await write(request(app).post("/payroll/runs")).send(body).expect(400);
    }
    for (const expectedVersion of [-1, 1.5, "3", null]) {
      await write(request(app).post(`/payroll/runs/${runId}/calculate`)).send({ expectedVersion }).expect(400);
      await write(request(app).post(`/payroll/agreements/${agreementId}/end`)).send({ ...endBody, expectedVersion }).expect(400);
    }
    for (const endsBefore of [null, "2026-02-30", "2026-11-01T00:00:00Z"]) {
      await write(request(app).post(`/payroll/agreements/${agreementId}/end`)).send({ ...endBody, endsBefore }).expect(400);
    }
    expect(payroll.createRun).not.toHaveBeenCalled();
    expect(payroll.calculateRun).not.toHaveBeenCalled();
    expect(payroll.endAgreement).not.toHaveBeenCalled();
  });

  it("rejects unbounded pagination and employee search without service calls", async () => {
    const { app, payroll } = fixture();
    for (const path of ["/payroll/agreements", "/payroll/runs"]) {
      for (const query of ["page=0", "page=1.5", "pageSize=101", "pageSize=0"]) await request(app).get(`${path}?${query}`).expect(400);
    }
    await request(app).get("/payroll/employees").query({ search: "x".repeat(201) }).expect(400);
    expect(payroll.listAgreements).not.toHaveBeenCalled();
    expect(payroll.listRuns).not.toHaveBeenCalled();
    expect(payroll.listEmployees).not.toHaveBeenCalled();
  });

  it.each(["listEmployees", "listAgreements", "createAgreement", "endAgreement"] as const)("maps owner rejection to safe 403: %s", async method => {
    const { app, payroll, write } = fixture();
    payroll[method].mockRejectedValue(new PayrollError("OWNER_REQUIRED"));
    const operation = writes.find(row => row.method === method);
    const call = operation ? write(request(app).post(operation.path)).send(operation.body)
      : request(app).get(method === "listEmployees" ? "/payroll/employees" : "/payroll/agreements");
    await call.expect(403, { status: 403, code: "BUSINESS_RULE_VIOLATION", reason: "OWNER_REQUIRED" });
  });

  it.each([
    ["VERSION_CONFLICT", 409], ["IDEMPOTENCY_MISMATCH", 409], ["IDEMPOTENCY_IN_PROGRESS", 409],
    ["NOT_FOUND", 404], ["INVALID_PERIOD", 422],
  ] as const)("preserves end-agreement failure status for %s", async (reason, status) => {
    const { app, payroll, write } = fixture();
    payroll.endAgreement.mockRejectedValue(new PayrollError(reason));
    await write(request(app).post(`/payroll/agreements/${agreementId}/end`)).send(endBody)
      .expect(status, { status, code: "BUSINESS_RULE_VIOLATION", reason });
  });
});
