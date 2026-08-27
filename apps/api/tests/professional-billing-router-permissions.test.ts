import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProfessionalBillingRouter } from "../src/projects/professional-billing-router.js";

describe("professional billing route permissions", () => {
  it("requires billing execution plus Sales create and post permissions", async () => {
    const context = { companyId: 1n, userId: 2n };
    const authorize = vi.fn().mockResolvedValue(context);
    const createRun = vi.fn().mockResolvedValue({ run: {} });
    const app = express();
    app.use(express.json());
    app.use(createProfessionalBillingRouter(
      { authorize } as never,
      { createRun } as never,
    ));

    await request(app)
      .post("/professional-billing-runs")
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "professional-billing-test-key")
      .send({
        projectId: "5aa8b232-356c-4d55-8b89-f27d44d1678d",
        contractId: "74d5c65e-3381-4aba-a3ae-0b61409375f6",
        contractVersion: 0,
        sourceDateFrom: "2057-08-27",
        sourceDateTo: "2057-08-31",
        fiscalPeriodId: "3",
        documentDate: "2057-08-31",
        exchangeRate: "1.00000000",
        revenueAccountId: "9",
        costCenterId: null,
        taxRateId: null,
      })
      .expect(201);

    expect(authorize.mock.calls.map(([input]) => input.permission)).toEqual([
      "professional_billing.execute",
      "sales_invoices.create",
      "sales_invoices.post",
    ]);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ requireCsrf: true }));
    expect(createRun).toHaveBeenCalledWith(context, expect.objectContaining({
      fiscalPeriodId: 3n,
      revenueAccountId: 9n,
      costCenterId: null,
      taxRateId: null,
    }));
  });
});
