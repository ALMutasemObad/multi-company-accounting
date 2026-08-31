import type { PrismaClient } from "@prisma/client";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/auth/auth-service.js";
import { IdempotentCommandExecutor } from "../src/platform/idempotent-command-executor.js";
import { createPlatformSubscriptionRouter } from "../src/platform-subscriptions/platform-subscription-router.js";
import { PlatformSubscriptionError, PlatformSubscriptionLifecycleService } from "../src/platform-subscriptions/platform-subscription-service.js";

// Source-prepared regression tests. No database or payment provider is used.
// Matching HTTP requests require regenerating the OpenAPI request guards first.
const financialBody = { targetPlanVersionId: "12", optionalModuleIds: ["4"], subscriptionVersion: 1 };
const key = "w1-same-version-and-key";

function httpFixture(companyId = 9n) {
  const authorize = vi.fn().mockResolvedValue({ sessionId: 1n, userId: 7n, companyId });
  const requestOwnerChange = vi.fn().mockResolvedValue({ change: { state: "PENDING_APPROVAL" }, subscriptionVersion: 2, paymentCollected: false });
  const app = express();
  app.use(express.json());
  app.use(createPlatformSubscriptionRouter({ authorize } as never, {} as never, { requestOwnerChange } as never));
  app.use(((error, _request, response, _next) => {
    response.status(error instanceof AuthError ? 403 : 400).json({ code: error instanceof AuthError ? error.reason : "VALIDATION_ERROR" });
  }) satisfies ErrorRequestHandler);
  const post = (body: object) => request(app).post("/subscription/change-requests")
    .set("Cookie", "sid=shared-session").set("X-CSRF-Token", "csrf")
    .set("Idempotency-Key", key).send(body);
  return { authorize, requestOwnerChange, post };
}

function serviceFixture() {
  const transaction = vi.fn(() => { throw new Error("Unexpected database work in context precondition test"); });
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new PlatformSubscriptionLifecycleService(
    { $transaction: transaction } as unknown as PrismaClient,
    { isOperator: vi.fn().mockResolvedValue(false) },
    audit,
  );
  return { service, transaction, audit };
}

afterEach(() => vi.restoreAllMocks());

describe("W1 subscription context HTTP precondition", () => {
  it("rejects company A intent under the shared session's company B before invoking the service", async () => {
    const { authorize, requestOwnerChange, post } = httpFixture(9n);
    const response = await post({ ...financialBody, expectedCompanyId: "8" }).expect(409);
    expect(response.body).toMatchObject({ status: 409, code: "SUBSCRIPTION_CONTEXT_MISMATCH", reason: "SUBSCRIPTION_CONTEXT_MISMATCH" });
    expect(authorize).toHaveBeenCalledExactlyOnceWith({ sid: "shared-session", csrfToken: "csrf", permission: "subscriptions.manage", requireCsrf: true });
    expect(requestOwnerChange).not.toHaveBeenCalled();
  });

  it("fails closed for a legacy client that omits the expected company", async () => {
    const { requestOwnerChange, post } = httpFixture();
    await post(financialBody).expect(400);
    expect(requestOwnerChange).not.toHaveBeenCalled();
  });

  it.each([null, 9, "0", "-9", "9.5", "company-b"])("rejects malformed expected company %s before the service", async (expectedCompanyId) => {
    const { requestOwnerChange, post } = httpFixture();
    await post({ ...financialBody, expectedCompanyId }).expect(400);
    expect(requestOwnerChange).not.toHaveBeenCalled();
  });

  it("preserves exact bigint company identity and financial input for a matching request", async () => {
    const companyId = 9007199254740993n;
    const { requestOwnerChange, post } = httpFixture(companyId);
    await post({ ...financialBody, expectedCompanyId: companyId.toString() }).expect(201);
    expect(requestOwnerChange).toHaveBeenCalledExactlyOnceWith(
      { sessionId: 1n, userId: 7n, companyId },
      { expectedCompanyId: companyId, targetPlanVersionId: 12n, optionalModuleIds: [4n], subscriptionVersion: 1, idempotencyKey: key },
    );
  });

  it("keeps the generated body contract strict after a matching precondition", async () => {
    const { requestOwnerChange, post } = httpFixture();
    await post({ ...financialBody, expectedCompanyId: "9", companyId: "8" }).expect(400);
    expect(requestOwnerChange).not.toHaveBeenCalled();
  });

  it("still requires authorization before evaluating company intent", async () => {
    const { authorize, requestOwnerChange, post } = httpFixture();
    authorize.mockRejectedValueOnce(new AuthError("FORBIDDEN"));
    await post({ ...financialBody, expectedCompanyId: "8" }).expect(403);
    expect(requestOwnerChange).not.toHaveBeenCalled();
  });
});

describe("W1 subscription service context precondition without database work", () => {
  const financialInput = { targetPlanVersionId: 12n, optionalModuleIds: [4n], subscriptionVersion: 1, idempotencyKey: key };

  it("blocks the same reviewed version and key after the actor switches companies, before replay or work", async () => {
    const { service, transaction, audit } = serviceFixture();
    const result = { change: { state: "PENDING_APPROVAL" }, subscriptionVersion: 2, paymentCollected: false };
    const execute = vi.spyOn(IdempotentCommandExecutor.prototype, "execute").mockResolvedValue(result);
    const input = { ...financialInput, expectedCompanyId: 8n };
    await expect(service.requestOwnerChange({ userId: 7n, companyId: 8n }, input)).resolves.toEqual(result);
    await expect(service.requestOwnerChange({ userId: 7n, companyId: 9n }, input))
      .rejects.toEqual(new PlatformSubscriptionError("SUBSCRIPTION_CONTEXT_MISMATCH"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      context: { companyId: 8n, userId: 7n }, operation: "REQUEST_COMPANY_SUBSCRIPTION_CHANGE", key,
      fingerprint: JSON.stringify({ targetPlanVersionId: "12", optionalModuleIds: ["4"], subscriptionVersion: 1 }),
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing", value: undefined }, { name: "null", value: null },
    { name: "string instead of bigint", value: "9" }, { name: "zero", value: 0n },
    { name: "negative", value: -9n },
  ])("fails closed for a $name runtime precondition before calling the executor", async ({ value }) => {
    const { service, transaction, audit } = serviceFixture();
    const execute = vi.spyOn(IdempotentCommandExecutor.prototype, "execute");
    const input = {
      ...financialInput, ...(value === undefined ? {} : { expectedCompanyId: value }),
    } as Parameters<PlatformSubscriptionLifecycleService["requestOwnerChange"]>[1];
    await expect(service.requestOwnerChange({ userId: 7n, companyId: 9n }, input))
      .rejects.toEqual(new PlatformSubscriptionError("SUBSCRIPTION_CONTEXT_MISMATCH"));
    expect(execute).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
});
