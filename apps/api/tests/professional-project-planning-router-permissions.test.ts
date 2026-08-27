import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalProjectPlanningRouter } from "../src/projects/professional-project-planning-router.js";

const projectId = "5aa8b232-356c-4d55-8b89-f27d44d1678d";
const taskId = "74d5c65e-3381-4aba-a3ae-0b61409375f6";

describe("professional project planning route permissions", () => {
  it("separates plan viewing, structure management, and task progress", async () => {
    const context = { companyId: 1n, userId: 2n };
    const authorize = vi.fn().mockResolvedValue(context);
    const planning = {
      getPlan: vi.fn().mockResolvedValue({ projectId, planningVersion: 0, summary: {}, stages: [], dependencies: [] }),
      updateTimeBudget: vi.fn().mockResolvedValue({ project: { projectId, timeBudgetMinutes: 600 }, planningVersion: 1 }),
      transitionTask: vi.fn().mockResolvedValue({ task: {}, planningVersion: 2 }),
    };
    const app = express();
    app.use(express.json());
    app.use(createProfessionalProjectPlanningRouter({ authorize } as never, planning as never));

    await request(app)
      .get(`/professional-projects/${projectId}/plan`)
      .set("Cookie", "sid=test-session")
      .expect(200);
    await request(app)
      .patch(`/professional-projects/${projectId}/time-budget`)
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .send({ planningVersion: 0, timeBudgetMinutes: 600 })
      .expect(200);
    await request(app)
      .post(`/professional-project-tasks/${taskId}/transition`)
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "professional-task-progress-test")
      .send({ planningVersion: 1, version: 0, status: "IN_PROGRESS", reason: "بدء التنفيذ" })
      .expect(200);

    expect(authorize.mock.calls.map(([input]) => input.permission)).toEqual([
      "professional_planning.view",
      "professional_planning.manage",
      "professional_tasks.progress",
    ]);
    expect(authorize.mock.calls.map(([input]) => input.requireCsrf)).toEqual([false, true, true]);
    expect(planning.getPlan).toHaveBeenCalledWith(context, projectId);
    expect(planning.updateTimeBudget).toHaveBeenCalledWith(context, projectId, { planningVersion: 0, timeBudgetMinutes: 600 });
    expect(planning.transitionTask).toHaveBeenCalledWith(context, taskId, expect.objectContaining({ idempotencyKey: "professional-task-progress-test" }));
  });

  it("requires the idempotency header for structural POST commands", async () => {
    const authorize = vi.fn().mockResolvedValue({ companyId: 1n, userId: 2n });
    const createStage = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(createProfessionalProjectPlanningRouter({ authorize } as never, { createStage } as never));

    await request(app)
      .post(`/professional-projects/${projectId}/stages`)
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .send({ planningVersion: 0, nameAr: "مرحلة" })
      .expect(400);
    expect(createStage).not.toHaveBeenCalled();
  });
});
