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
    listPhases: vi.fn().mockResolvedValue({ data: [], planVersion: 0, meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    createPhase: vi.fn().mockResolvedValue({ phase: {}, planVersion: 1 }),
    transitionPhase: vi.fn().mockResolvedValue({ phase: {}, planVersion: 2 }),
    listTasks: vi.fn().mockResolvedValue({ data: [], planVersion: 2, meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    createTask: vi.fn().mockResolvedValue({ task: {}, planVersion: 3 }),
    listTaskAssignments: vi.fn().mockResolvedValue({ data: [], planVersion: 3, meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    assignTaskMember: vi.fn().mockResolvedValue({ assignment: {}, planVersion: 4 }),
    unassignTaskMember: vi.fn().mockResolvedValue({ assignment: {}, planVersion: 5 }),
    transitionTask: vi.fn().mockResolvedValue({ task: {}, planVersion: 5 }),
    assignMember: vi.fn().mockResolvedValue({ member: {}, projectVersion: 1 }),
    unassignMember: vi.fn().mockResolvedValue({ memberId: managerId, projectVersion: 2 }),
  };
  const app = express();
  app.use(express.json());
  app.use(createGeneralProjectRouter({ authorize } as never, projects as never));
  return { app, authorize, projects };
}

describe("general project HTTP boundary", () => {
  it("guards task assignments and manager-only task transitions", async () => {
    const { app, authorize, projects } = fixture();
    const taskId = "5759ba65-f0e0-48c4-b0dc-b12ca2bd958d";
    await request(app).get(`/general-projects/${projectId}/tasks/${taskId}/assignments`).expect(200);
    await request(app).post(`/general-projects/${projectId}/tasks/${taskId}/assignments`)
      .set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-task-assign-1234")
      .send({ expectedPlanVersion: 3, memberId: managerId, role: "RESPONSIBLE" }).expect(200);
    await request(app).post(`/general-projects/${projectId}/tasks/${taskId}/transition`)
      .set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-task-transition-1234")
      .send({ expectedPlanVersion: 4, expectedVersion: 0, to: "IN_PROGRESS" }).expect(200);
    const assignmentId = "03e667a2-466f-498b-aa27-83453be31c4c";
    await request(app).post(`/general-projects/${projectId}/tasks/${taskId}/assignments/${assignmentId}/unassign`)
      .set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-task-unassign-1234")
      .send({ expectedPlanVersion: 5, expectedVersion: 0, reason: "Reassigned safely" }).expect(200);
    expect(authorize.mock.calls.map(([value]) => [value.permission, value.requireCsrf])).toEqual([
      ["general_projects.view", false], ["general_projects.manage", true], ["general_projects.manage", true],
      ["general_projects.manage", true],
    ]);
    expect(projects.assignTaskMember).toHaveBeenCalledWith(context, projectId, taskId,
      expect.objectContaining({ memberId: managerId, role: "RESPONSIBLE" }));
  });
  it("scopes task reads and creation to a project phase with guarded input", async () => {
    const { app, authorize, projects } = fixture();
    const phaseId = "b5c7025d-260e-4697-9ba9-57c55ed063a2";
    await request(app).get(`/general-projects/${projectId}/phases/${phaseId}/tasks?page=2`).expect(200);
    await request(app).post(`/general-projects/${projectId}/phases/${phaseId}/tasks`)
      .set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-task-create-1234")
      .send({ expectedPlanVersion: 2, title: "مهمة مستقلة", priority: "HIGH" }).expect(201);
    await request(app).post(`/general-projects/${projectId}/phases/${phaseId}/tasks`)
      .set("X-CSRF-Token", "csrf").set("Idempotency-Key", "general-project-task-create-5678")
      .send({ expectedPlanVersion: 2, title: "مهمة", status: "COMPLETED" }).expect(400);
    expect(authorize.mock.calls.map(([value]) => [value.permission, value.requireCsrf])).toEqual([
      ["general_projects.view", false], ["general_projects.manage", true], ["general_projects.manage", true],
    ]);
    expect(projects.listTasks).toHaveBeenCalledWith(context, projectId, phaseId, { page: 2, pageSize: 25 });
    expect(projects.createTask).toHaveBeenCalledOnce();
  });
  it("guards phase reads and versioned commands without accepting status on creation", async () => {
    const { app, authorize, projects } = fixture();
    const phaseId = "b5c7025d-260e-4697-9ba9-57c55ed063a2";
    const write = (call: request.Test) => call.set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "general-project-phase-key-1234");
    await request(app).get(`/general-projects/${projectId}/phases?page=2&pageSize=10`).expect(200);
    await write(request(app).post(`/general-projects/${projectId}/phases`))
      .send({ expectedPlanVersion: 0, title: "مرحلة التحضير" }).expect(201);
    await write(request(app).post(`/general-projects/${projectId}/phases/${phaseId}/transition`))
      .send({ expectedPlanVersion: 1, expectedVersion: 0, to: "IN_PROGRESS" }).expect(200);
    await write(request(app).post(`/general-projects/${projectId}/phases`))
      .send({ expectedPlanVersion: 0, title: "مرحلة", status: "COMPLETED" }).expect(400);
    expect(authorize.mock.calls.map(([value]) => [value.permission, value.requireCsrf])).toEqual([
      ["general_projects.view", false], ["general_projects.manage", true],
      ["general_projects.manage", true], ["general_projects.manage", true],
    ]);
    expect(projects.listPhases).toHaveBeenCalledWith(context, projectId, { page: 2, pageSize: 10 });
    expect(projects.createPhase).toHaveBeenCalledWith(context, projectId,
      expect.objectContaining({ title: "مرحلة التحضير", idempotencyKey: "general-project-phase-key-1234" }));
    expect(projects.transitionPhase).toHaveBeenCalledWith(context, projectId, phaseId,
      expect.objectContaining({ to: "IN_PROGRESS", expectedVersion: 0 }));
    expect(projects.createPhase).toHaveBeenCalledTimes(1);
  });
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
