import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApprovalRouter } from "../src/approvals/approval-router.js";

describe("approval subject owner permissions", () => {
  it("selects the owner permission from the submitted subject type", async () => {
    const authorize = vi.fn().mockResolvedValue({ companyId: 1n, userId: 2n });
    const approvalRequest = {
      id: "cc8808e8-c9fd-4c31-92aa-f1a13db6d51a",
      subjectType: "PROFESSIONAL_TIMESHEET",
      subjectId: "db98e719-b9f2-443a-adb2-58ae58128c38",
      subjectVersion: 1,
      subjectSnapshotHashSha256: "a".repeat(64),
      status: "PENDING",
      makerCheckerRequired: true,
      requestedBy: { id: "2", displayName: "Maker" },
      decision: null,
      version: 0,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const approvals = { request: vi.fn().mockResolvedValue({ approvalRequest }) };
    const app = express();
    app.use(express.json());
    app.use(createApprovalRouter(
      { authorize } as never,
      approvals as never,
    ));

    await request(app)
      .post("/approval-requests")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "timesheet-submit-key")
      .send({
        subjectType: "PROFESSIONAL_TIMESHEET",
        subjectId: approvalRequest.subjectId,
        subjectVersion: 0,
      })
      .expect(201);

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      permission: "professional_timesheets.submit",
      requireCsrf: true,
    }));

    await request(app)
      .post("/approval-requests")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "employee-expense-submit-key")
      .send({
        subjectType: "EMPLOYEE_EXPENSE_CLAIM",
        subjectId: approvalRequest.subjectId,
        subjectVersion: 0,
      })
      .expect(201);

    expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({
      permission: "employee_expenses.submit",
      requireCsrf: true,
    }));

    await request(app)
      .post("/approval-requests")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "financial-close-submit-key")
      .send({
        subjectType: "FINANCIAL_CLOSE_RUN",
        subjectId: approvalRequest.subjectId,
        subjectVersion: 0,
      })
      .expect(201);

    expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({
      permission: "fiscal_periods.close",
      requireCsrf: true,
    }));
  });
});
