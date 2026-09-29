import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import type { GroupCompanyOnboardingService } from "../src/organizations/group-company-onboarding-service.js";
import { GroupCompanyOnboardingError } from "../src/organizations/group-company-onboarding-ports.js";
import { createOrganizationOwnerRouter } from "../src/organizations/organization-owner-router.js";
import { requestLogger } from "../src/operations/logger.js";
import { OrganizationIdempotencyError } from "../src/platform/organization-idempotent-command-executor.js";
import { SubscriptionStartPolicyError } from "../src/platform-subscriptions/new-company-start-policy.js";
import {
  OrganizationMembershipError,
  type OrganizationMembershipService,
} from "../src/users/organization-membership-service.js";

function fixture(overrides: Record<string, unknown> = {}, onboarding?: { options?: unknown; create?: unknown }) {
  const auth = {
    authenticate: vi.fn(async () => ({ userId: 7n })),
  };
  const service = {
    listWorkspaces: vi.fn(async () => [{ id: "1", code: "GROUP", name: "Group", role: "OWNER" }]),
    dashboard: vi.fn(async () => ({})),
    listMembers: vi.fn(async () => []),
    addMember: vi.fn(async () => ({ user: { id: "8" }, role: "VIEWER" })),
    updateMember: vi.fn(async () => ({ user: { id: "8" }, role: "VIEWER" })),
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use(requestLogger(false));
  app.use(createOrganizationOwnerRouter(
    auth as unknown as AuthService,
    service as unknown as OrganizationMembershipService,
    onboarding as GroupCompanyOnboardingService | undefined,
  ));
  return { app, auth, service };
}

describe("organization owner HTTP boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("authenticates workspace reads without company selection or platform authorization", async () => {
    const { app, auth, service } = fixture();
    const response = await request(app).get("/organizations/workspaces").set("Cookie", "sid=session-token");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data[0]).toMatchObject({ id: "1", role: "OWNER" });
    expect(auth.authenticate).toHaveBeenCalledWith({ sid: "session-token", csrfToken: undefined, requireCsrf: false });
    expect(service.listWorkspaces).toHaveBeenCalledWith(7n);
  });

  it("requires CSRF authentication for membership writes and uses the generated body guard", async () => {
    const { app, auth, service } = fixture();
    const response = await request(app)
      .post("/organizations/1/members")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .send({ email: " member@example.test ", role: "VIEWER" });

    expect(response.status).toBe(201);
    expect(auth.authenticate).toHaveBeenCalledWith({ sid: "session-token", csrfToken: "csrf-token", requireCsrf: true });
    expect(service.addMember).toHaveBeenCalledWith(7n, 1n, { email: "member@example.test", role: "VIEWER" });

    const invalid = await request(app)
      .post("/organizations/1/members")
      .set("Cookie", "sid=session-token")
      .send({ email: "member@example.test", role: "PLATFORM_OPERATOR" });
    expect(invalid.status).toBe(400);
    expect(service.addMember).toHaveBeenCalledTimes(1);
  });

  it("returns a non-disclosing forbidden response for insufficient group role", async () => {
    const { app } = fixture({
      listMembers: vi.fn(async () => { throw new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN"); }),
    });
    const response = await request(app).get("/organizations/1/members").set("Cookie", "sid=session-token");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      status: 403,
      reason: "ORGANIZATION_ROLE_FORBIDDEN",
    });
  });

  it("correlates an unavailable start policy with a safe server-side reason on options", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = vi.fn().mockRejectedValue(new SubscriptionStartPolicyError("NOT_CONFIGURED"));
    const { app } = fixture({}, { options });
    const response = await request(app).get("/organizations/1/company-options")
      .set("X-Request-ID", "group-options-12345678");

    expect(response.status).toBe(503);
    expect(response.headers["x-request-id"]).toBe("group-options-12345678");
    expect(response.body).toMatchObject({ code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-options-12345678" });
    expect(response.body).not.toHaveProperty("reason");
    expect(options).toHaveBeenCalledWith(7n, 1n);
    expect(logs).toHaveBeenCalledOnce();
    expect(JSON.parse(logs.mock.calls[0]![0] as string)).toMatchObject({
      level: "error", event: "group_company_setup_unavailable", requestId: "group-options-12345678",
      operation: "GROUP_COMPANY_OPTIONS", source: "START_PLAN_POLICY", reason: "NOT_CONFIGURED",
    });
  });

  it("logs only safe diagnostics for a failed creation and leaves the idempotent request unchanged", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new SubscriptionStartPolicyError("PLAN_NOT_ELIGIBLE"));
    const { app } = fixture({}, { create });
    const body = {
      companyName: "Private company name", phone: "+966500001234", countryCode: "SA",
      primaryBusinessActivityCode: "RETAIL_TRADE", chartTemplateCode: "RETAIL_INVENTORY",
      timezone: "Asia/Riyadh", baseCurrencyCode: "AED",
    };
    const key = "group-company-key-12345678";
    const response = await request(app).post("/organizations/1/companies")
      .set("X-Request-ID", "group-create-12345678").set("Idempotency-Key", key).send(body);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-create-12345678" });
    expect(response.body).not.toHaveProperty("reason");
    expect(create).toHaveBeenCalledWith(7n, 1n, key, body);
    const line = logs.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toMatchObject({ operation: "CREATE_GROUP_COMPANY", source: "START_PLAN_POLICY",
      reason: "PLAN_NOT_ELIGIBLE", requestId: "group-create-12345678" });
    for (const sensitive of [body.companyName, body.phone, key]) expect(line).not.toContain(sensitive);
  });

  it("distinguishes a generic onboarding failure without exposing its cause to the client", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = fixture({}, { options: vi.fn().mockRejectedValue(new GroupCompanyOnboardingError("COMPANY_SETUP_UNAVAILABLE")) });
    const response = await request(app).get("/organizations/1/company-options")
      .set("X-Request-ID", "group-generic-12345678");

    expect(response.status).toBe(503);
    expect(JSON.parse(logs.mock.calls[0]![0] as string)).toMatchObject({
      source: "GROUP_COMPANY_ONBOARDING", reason: "COMPANY_SETUP_UNAVAILABLE",
    });
    expect(response.body).not.toHaveProperty("reason");
  });

  it("does not log retry-key conflicts as setup failures", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = fixture({}, { create: vi.fn().mockRejectedValue(new OrganizationIdempotencyError("IDEMPOTENCY_MISMATCH")) });
    const response = await request(app).post("/organizations/1/companies")
      .set("X-Request-ID", "group-conflict-12345678").set("Idempotency-Key", "group-company-key-12345678")
      .send({ companyName: "Company", phone: "12345678", countryCode: "SA", primaryBusinessActivityCode: "RETAIL_TRADE",
        chartTemplateCode: "RETAIL_INVENTORY", timezone: "Asia/Riyadh", baseCurrencyCode: "SAR" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "IDEMPOTENCY_MISMATCH", requestId: "group-conflict-12345678" });
    expect(logs).not.toHaveBeenCalled();
  });

  it("does not classify a denied group owner as a setup failure", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = fixture({}, { options: vi.fn().mockRejectedValue(new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN")) });
    const response = await request(app).get("/organizations/1/company-options")
      .set("X-Request-ID", "group-forbidden-12345678");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ reason: "ORGANIZATION_ROLE_FORBIDDEN" });
    expect(logs).not.toHaveBeenCalled();
  });
});
