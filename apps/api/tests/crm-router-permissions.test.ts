import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createCrmRouter } from "../src/crm/crm-router.js";

const leadId = "5aa8b232-356c-4d55-8b89-f27d44d1678d";
const opportunityId = "74d5c65e-3381-4aba-a3ae-0b61409375f6";
const employeeId = "813503e9-6353-4b7c-83ef-d1a2f7d15275";

describe("CRM route permissions and generated guards", () => {
  it("uses the narrow CRM permissions and passes idempotency keys to commands", async () => {
    const context = { companyId: 1n, userId: 2n };
    const authorize = vi.fn().mockResolvedValue(context);
    const crm = {
      createLead: vi.fn().mockResolvedValue({ lead: {} }),
      qualifyLead: vi.fn().mockResolvedValue({ opportunity: {} }),
      createActivity: vi.fn().mockResolvedValue({ activity: {} }),
      convertLead: vi.fn().mockResolvedValue({ leadId, customerId: "9" }),
    };
    const app = express();
    app.use(express.json());
    app.use(createCrmRouter({ authorize } as never, crm as never));
    const headers = (call: request.Test) => call
      .set("Cookie", "sid=test-session")
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "crm-command-test-key-1234");

    await headers(request(app).post("/crm/leads")).send({
      kind: "ORGANIZATION", displayName: "مؤسسة اختبار", source: "REFERRAL", ownerEmployeeId: employeeId,
    }).expect(201);
    await headers(request(app).post(`/crm/leads/${leadId}/qualify`)).send({
      version: 0, title: "فرصة اختبار", estimatedAmount: "1250.0000", currencyId: "1", probabilityBps: 3500,
    }).expect(201);
    await headers(request(app).post("/crm/activities")).send({
      parentType: "OPPORTUNITY", parentId: opportunityId, type: "CALL", subject: "متابعة العرض", assignedEmployeeId: employeeId,
    }).expect(201);
    await headers(request(app).post(`/crm/leads/${leadId}/convert`)).send({
      version: 1, mode: "EXISTING", customerId: "9",
    }).expect(200);

    expect(authorize.mock.calls.map(([input]) => input.permission)).toEqual([
      "crm.manage", "crm.manage", "crm.activities.manage", "crm.convert",
    ]);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ requireCsrf: true }));
    expect(crm.createLead).toHaveBeenCalledWith(context, expect.objectContaining({ idempotencyKey: "crm-command-test-key-1234" }));
    expect(crm.qualifyLead).toHaveBeenCalledWith(context, leadId, expect.objectContaining({ currencyId: 1n }));
    expect(crm.createActivity).toHaveBeenCalledWith(context, expect.objectContaining({ parentId: opportunityId }));
    expect(crm.convertLead).toHaveBeenCalledWith(context, leadId, expect.objectContaining({ customerId: 9n }));
  });
});
