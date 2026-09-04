import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { createOrganizationOwnerRouter } from "../src/organizations/organization-owner-router.js";
import {
  OrganizationMembershipError,
  type OrganizationMembershipService,
} from "../src/users/organization-membership-service.js";

function fixture(overrides: Record<string, unknown> = {}) {
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
  app.use(createOrganizationOwnerRouter(
    auth as unknown as AuthService,
    service as unknown as OrganizationMembershipService,
  ));
  return { app, auth, service };
}

describe("organization owner HTTP boundary", () => {
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
});
