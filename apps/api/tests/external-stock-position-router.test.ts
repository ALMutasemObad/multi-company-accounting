import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { createInventoryMovementRouter } from "../src/inventory/inventory-movement-router.js";
import type { InventoryMovementService } from "../src/inventory/inventory-movement-service.js";

function fixture() {
  const context = { companyId: 19n, userId: 7n };
  const authorize = vi.fn().mockResolvedValue(context);
  const recordEvent = vi.fn().mockResolvedValue({ id: "51", quantity: "3.000000" });
  const listPositions = vi.fn().mockResolvedValue([]);
  const createParty = vi.fn().mockResolvedValue({ id: "4", code: "CARRIER", nameAr: "الناقل" });
  const service = { externalStock: { recordEvent, listPositions, createParty, listParties: vi.fn(), reverseLatestEvent: vi.fn() } } as unknown as InventoryMovementService;
  const app = express();
  app.use(express.json());
  app.use(createInventoryMovementRouter({ authorize } as unknown as AuthService, service));
  return { app, authorize, recordEvent, listPositions, createParty, context };
}

describe("external inventory position routes", () => {
  it("records third-party custody without an owned inventory value and forwards tenant context", async () => {
    const { app, authorize, recordEvent, context } = fixture();
    const response = await request(app)
      .post("/external-stock-positions/events")
      .set("Idempotency-Key", "external-event-001")
      .send({
        positionType: "THIRD_PARTY_HELD_BY_US",
        inventoryItemId: "12",
        custodyPartyId: "4",
        warehouseId: "9",
        eventType: "INCREASE",
        quantity: "3",
        inventoryValueBase: null,
        sourceReference: "GRN-44",
        effectiveDate: "2026-09-21",
      });

    expect(response.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_movements.create", requireCsrf: true }));
    expect(recordEvent).toHaveBeenCalledWith(context, expect.objectContaining({
      inventoryItemId: 12n,
      custodyPartyId: 4n,
      warehouseId: 9n,
      inventoryValueBase: null,
    }), "external-event-001");
  });

  it("applies company-scoped filters on the positions list", async () => {
    const { app, listPositions, context } = fixture();
    const response = await request(app).get("/external-stock-positions?positionType=OWNED_IN_TRANSIT&includeZero=true");
    expect(response.status).toBe(200);
    expect(listPositions).toHaveBeenCalledWith(context, { positionType: "OWNED_IN_TRANSIT", includeZero: true });
  });

  it("exports the filtered positions as a real Excel workbook", async () => {
    const { app, listPositions, context } = fixture();
    const response = await request(app)
      .get("/external-stock-positions.xlsx?positionType=OWNED_IN_TRANSIT")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(Buffer.from(response.body).subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(listPositions).toHaveBeenCalledWith(context, { positionType: "OWNED_IN_TRANSIT" });
  });

  it("rejects a malformed quantity before reaching the service", async () => {
    const { app, recordEvent } = fixture();
    const response = await request(app)
      .post("/external-stock-positions/events")
      .set("Idempotency-Key", "external-event-002")
      .send({ eventType: "INCREASE", quantity: "-2", inventoryValueBase: null, sourceReference: "BAD", effectiveDate: "2026-09-21" });
    expect(response.status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
  });
});
