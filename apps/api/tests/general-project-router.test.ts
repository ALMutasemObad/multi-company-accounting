import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGeneralProjectRouter } from "../src/general-projects/general-project-router.js";

const projectId = "f6ea7036-8ccf-4439-980f-4a2a289a4d55";
const managerId = "85131e1d-2910-483b-a276-7fbd2d86cd99";
const context = { companyId: 17n, userId: 23n };

function fixture() {
  const authorize = vi.fn().mockResolvedValue(context);
  const projects = {
    listCustomerOptions: vi.fn().mockResolvedValue({ data: [] }),
    listEmployeeOptions: vi.fn().mockResolvedValue({ data: [] }),
    listProjects: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    getProject: vi.fn().mockResolvedValue({ project: {}, members: [] }),
    createProject: vi.fn().mockResolvedValue({ project: { id: projectId } }),
    updateProject: vi.fn().mockResolvedValue({ project: { id: projectId } }),
    transition: vi.fn().mockResolvedValue({ project: { id: projectId } }),
    assignMember: vi.fn().mockResolvedValue({ member: {}, projectVersion: 1 }),
    unassignMember: vi.fn().mockResolvedValue({ memberId: managerId, projectVersion: 2 }),
  };
  const app = express();
  app.use(express.json());
  app.use(createGeneralProjectRouter({ authorize } as never, projects as never));
  return { app, authorize, projects };
}

describe("general project HTTP boundary", () => {
  it("requires Sales visibility for the full optional customer list and manage permission for employee options", async () => {
    const { app, authorize } = fixture();
    await request(app).get("/general-projects/customer-options").set("Cookie", "sid=session").expect(200);
    await request(app).get("/general-projects/employee-options").set("Cookie", "sid=session").expect(200);
    expect(authorize.mock.calls.map(([value]) => value.permission)).toEqual(["customers.view", "general_projects.manage"]);
    expect(authorize.mock.calls.map(([value]) => value.requireCsrf)).toEqual([false, false]);
  });

  it("uses separate project view/manage permissions and generated request guards", async () => {
    const { app, authorize, projects } = fixture();
    const headers = (call: request.Test) => call.set("Cookie", "sid=session").set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-command-key-1234");
    await request(app).get("/general-projects").set("Cookie", "sid=session").expect(200);
    await request(app).get(`/general-projects/${projectId}`).set("Cookie", "sid=session").expect(200);
    await headers(request(app).post("/general-projects")).send({ nameAr: "مشروع عام", managerEmployeeId: managerId }).expect(201);
    await headers(request(app).patch(`/general-projects/${projectId}`)).send({ version: 0, nameAr: "محدّث" }).expect(200);
    await headers(request(app).post(`/general-projects/${projectId}/transition`)).send({ version: 1, status: "ACTIVE" }).expect(200);
    expect(authorize.mock.calls.map(([value]) => value.permission)).toEqual([
      "general_projects.view", "general_projects.view", "general_projects.manage", "general_projects.manage", "general_projects.manage",
    ]);
    expect(authorize.mock.calls.map(([value]) => value.requireCsrf)).toEqual([false, false, true, true, true]);
    expect(projects.createProject).toHaveBeenCalledWith(context, expect.objectContaining({ managerEmployeeId: managerId, idempotencyKey: "general-project-command-key-1234" }));
    expect(projects.transition).toHaveBeenCalledWith(context, projectId, expect.objectContaining({ status: "ACTIVE" }));
  });

  it("rejects a professional-project payload shape at the independent endpoint", async () => {
    const { app, projects } = fixture();
    await request(app).post("/general-projects").set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "general-project-command-key-1234")
      .send({ nameAr: "مشروع عام", managerEmployeeId: managerId, kind: "LEGAL_MATTER" }).expect(400);
    expect(projects.createProject).not.toHaveBeenCalled();
  });
});
