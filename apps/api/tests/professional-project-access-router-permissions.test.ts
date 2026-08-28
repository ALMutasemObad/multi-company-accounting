import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalProjectAccessRouter } from "../src/projects/professional-project-access-router.js";

const projectId = "5aa8b232-356c-4d55-8b89-f27d44d1678d";
const grantId = "74d5c65e-3381-4aba-a3ae-0b61409375f6";

describe("professional project access route permissions", () => {
  it("requires the dedicated permission and CSRF only for mutations", async () => {
    const context = { companyId: 1n, userId: 2n };
    const authorize = vi.fn().mockResolvedValue(context);
    const service = {
      getAccess: vi.fn().mockResolvedValue({ projectId, accessMode: "COMPANY", accessVersion: 0, grants: [] }),
      updateAccessMode: vi.fn().mockResolvedValue({ projectId, accessMode: "RESTRICTED", accessVersion: 1, grants: [] }),
      grantAccess: vi.fn().mockResolvedValue({ grant: {}, accessVersion: 2 }),
      revokeAccess: vi.fn().mockResolvedValue({ revoked: true, accessVersion: 3, grantVersion: 1 }),
    };
    const app = express();
    app.use(express.json());
    app.use(createProfessionalProjectAccessRouter({ authorize } as never, service as never));

    await request(app).get(`/professional-projects/${projectId}/access`).set("Cookie", "sid=test").expect(200);
    await request(app).patch(`/professional-projects/${projectId}/access`).set("Cookie", "sid=test").set("X-CSRF-Token", "csrf").send({ accessVersion: 0, accessMode: "RESTRICTED", reason: "سرية القضية" }).expect(200);
    await request(app).post(`/professional-projects/${projectId}/access-grants`).set("Cookie", "sid=test").set("X-CSRF-Token", "csrf").set("Idempotency-Key", "professional-access-grant-test").send({ accessVersion: 1, userId: "3", reason: "عضو خارجي" }).expect(201);
    await request(app).post(`/professional-projects/${projectId}/access-grants/${grantId}/revoke`).set("Cookie", "sid=test").set("X-CSRF-Token", "csrf").set("Idempotency-Key", "professional-access-revoke-test").send({ accessVersion: 2, grantVersion: 0, reason: "انتهاء الحاجة" }).expect(200);

    expect(authorize.mock.calls.map(([input]) => [input.permission, input.requireCsrf])).toEqual([
      ["professional_access.manage", false],
      ["professional_access.manage", true],
      ["professional_access.manage", true],
      ["professional_access.manage", true],
    ]);
  });
});
