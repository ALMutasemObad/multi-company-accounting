import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createEmployeeExpenseRouter } from "../src/employee-expenses/employee-expense-router.js";

const context = { companyId: 11n, userId: 29n };

function testApp() {
  const authorize = vi.fn().mockResolvedValue(context);
  const expenses = {
    list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    listCostCenters: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ claim: { id: "017c71ec-e778-4273-9d45-5214dd33faaa" } }),
    update: vi.fn().mockResolvedValue({ claim: { id: "017c71ec-e778-4273-9d45-5214dd33faaa" } }),
  };
  const app = express();
  app.use(express.json());
  app.use(createEmployeeExpenseRouter({ authorize } as never, expenses as never));
  return { app, authorize, expenses };
}

describe("employee expense route permissions and contracts", () => {
  it("keeps personal and company list scopes behind distinct permissions", async () => {
    const { app, authorize, expenses } = testApp();

    await request(app).get("/employee-expense-claims?scope=mine").set("Cookie", "sid=test-session").expect(200);
    await request(app).get("/employee-expense-claims?scope=company").set("Cookie", "sid=test-session").expect(200);

    expect(authorize.mock.calls.map(([input]) => input.permission)).toEqual([
      "employee_expenses.view",
      "employee_expenses.review",
    ]);
    expect(expenses.list).toHaveBeenNthCalledWith(1, context, expect.objectContaining({ scope: "mine" }));
    expect(expenses.list).toHaveBeenNthCalledWith(2, context, expect.objectContaining({ scope: "company" }));
  });

  it("validates create payloads and forwards decimal strings with idempotency", async () => {
    const { app, authorize, expenses } = testApp();
    await request(app)
      .post("/employee-expense-claims")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf-token")
      .set("Idempotency-Key", "expense-create-0001")
      .send({
        purpose: "Client visit in Riyadh",
        lines: [{
          incurredOn: "2026-09-04",
          merchant: "Rail provider",
          description: "Return ticket",
          receiptReference: "RCP-104",
          costCenterId: "81",
          amount: "125.50",
        }],
      })
      .expect(201);

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      permission: "employee_expenses.submit",
      requireCsrf: true,
    }));
    expect(expenses.create).toHaveBeenCalledWith(context, expect.objectContaining({
      idempotencyKey: "expense-create-0001",
      lines: [expect.objectContaining({ costCenterId: 81n, amount: "125.50" })],
    }));
  });

  it("rejects file-shaped receipt input instead of accepting sensitive uploads", async () => {
    const { app, expenses } = testApp();
    await request(app)
      .post("/employee-expense-claims")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf-token")
      .set("Idempotency-Key", "expense-create-0002")
      .send({
        purpose: "Client visit in Riyadh",
        lines: [{
          incurredOn: "2026-09-04",
          merchant: "Rail provider",
          description: "Return ticket",
          costCenterId: "81",
          amount: "125.50",
          receiptFile: "data:image/png;base64,secret",
        }],
      })
      .expect(400);

    expect(expenses.create).not.toHaveBeenCalled();
  });
});
