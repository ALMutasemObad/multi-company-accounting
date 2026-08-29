import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthService } from "../src/auth/auth-service.js";
import { createInventoryBarcodeRouter } from "../src/inventory/inventory-barcode-router.js";
import {
  InventoryBarcodeError,
  type InventoryBarcodeService,
} from "../src/inventory/inventory-barcode-service.js";

const context = { companyId: 5n, userId: 7n };

function barcodeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 31n,
    companyId: 5n,
    inventoryItemId: 11n,
    symbology: "EAN_13" as const,
    value: "4006381333931",
    normalizedValue: "04006381333931",
    isPrimary: true,
    primaryInventoryItemId: 11n,
    isActive: true,
    version: 0,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    ...overrides,
  };
}

function resolvedRecord() {
  return {
    barcode: { id: "31", symbology: "EAN_13" as const, isPrimary: true },
    inventoryItem: {
      id: "11",
      code: "ITM-000011",
      nameAr: "صنف",
      nameEn: null,
      description: null,
      unitOfMeasure: { id: "21", code: "EA", nameAr: "حبة", decimalPlaces: 0 },
    },
  };
}

function fixture() {
  const authorize = vi.fn().mockResolvedValue(context);
  const service = {
    listBarcodes: vi.fn().mockResolvedValue({ data: [barcodeRecord()], total: 1 }),
    createBarcode: vi.fn().mockResolvedValue(barcodeRecord()),
    updateBarcode: vi.fn().mockResolvedValue(barcodeRecord({ version: 1 })),
    setPrimaryBarcode: vi.fn().mockResolvedValue(barcodeRecord()),
    deactivateBarcode: vi.fn().mockResolvedValue(barcodeRecord({ isActive: false, isPrimary: false, version: 1 })),
    resolveBarcode: vi.fn().mockResolvedValue(resolvedRecord()),
    resolveBarcodeBatch: vi.fn().mockResolvedValue([{
      index: 0,
      clientReference: "line-1",
      status: "RESOLVED",
      data: resolvedRecord(),
    }]),
  } as unknown as InventoryBarcodeService;
  const app = express();
  app.use(express.json());
  app.use(createInventoryBarcodeRouter({ authorize } as unknown as AuthService, service));
  app.use(((error, _request, response, _next) => {
    response.status(500).json({ code: "TEST_ERROR", error: String(error) });
  }) satisfies ErrorRequestHandler);
  return { app, authorize, service };
}

describe("inventory barcode router contracts and permissions", () => {
  it("uses the view permission and database pagination contract", async () => {
    const { app, authorize, service } = fixture();
    const response = await request(app)
      .get("/inventory-items/11/barcodes?page=2&pageSize=10&active=true")
      .set("Cookie", "sid=session-token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ id: "31", inventoryItemId: "11", value: "4006381333931" }],
      meta: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
    });
    expect(authorize).toHaveBeenCalledWith({
      sid: "session-token",
      csrfToken: undefined,
      permission: "inventory_barcodes.view",
      requireCsrf: false,
    });
    expect(service.listBarcodes).toHaveBeenCalledWith(context, 11n, {
      page: 2,
      pageSize: 10,
      active: true,
    });
  });

  it("preserves barcode strings and requires manage plus CSRF for writes", async () => {
    const { app, authorize, service } = fixture();
    const response = await request(app)
      .post("/inventory-items/11/barcodes")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .send({ symbology: "EAN_13", value: "0012345678905", isPrimary: true });

    expect(response.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith({
      sid: "session-token",
      csrfToken: "csrf-token",
      permission: "inventory_barcodes.manage",
      requireCsrf: true,
    });
    expect(service.createBarcode).toHaveBeenCalledWith(context, 11n, {
      symbology: "EAN_13",
      value: "0012345678905",
      isPrimary: true,
    });
  });

  it("rejects unknown symbologies and extra fields before the service", async () => {
    const { app, service } = fixture();
    const response = await request(app)
      .post("/inventory-items/11/barcodes")
      .send({ symbology: "GS1_128", value: "ABC", normalizedValue: "ABC" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(service.createBarcode).not.toHaveBeenCalled();
  });

  it("uses the dedicated resolve permission, CSRF, and does not coerce leading zeros", async () => {
    const { app, authorize, service } = fixture();
    const response = await request(app)
      .post("/inventory-barcodes/resolve")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .send({ value: "0012345678905" });
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("value");
    expect(response.body).not.toHaveProperty("normalizedValue");
    expect(authorize).toHaveBeenCalledWith({
      sid: "session-token",
      csrfToken: "csrf-token",
      permission: "inventory_barcodes.resolve",
      requireCsrf: true,
    });
    expect(service.resolveBarcode).toHaveBeenCalledWith(context, { value: "0012345678905" });
  });

  it("enforces the batch bound at the generated request guard", async () => {
    const { app, service } = fixture();
    const response = await request(app)
      .post("/inventory-barcodes/resolve-batch")
      .send({ entries: Array.from({ length: 101 }, () => ({ value: "ABC" })) });
    expect(response.status).toBe(400);
    expect(service.resolveBarcodeBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["BARCODE_NOT_FOUND", 404, "NOT_FOUND"],
    ["BARCODE_ALREADY_EXISTS", 409, "BUSINESS_RULE_VIOLATION"],
    ["VERSION_CONFLICT", 409, "BUSINESS_RULE_VIOLATION"],
    ["GS1_NOT_SUPPORTED", 422, "BUSINESS_RULE_VIOLATION"],
    ["BARCODE_INACTIVE", 422, "BUSINESS_RULE_VIOLATION"],
  ] as const)("maps %s to a stable HTTP problem", async (reason, status, code) => {
    const { app, service } = fixture();
    vi.mocked(service.resolveBarcode).mockRejectedValueOnce(new InventoryBarcodeError(reason));
    const response = await request(app)
      .post("/inventory-barcodes/resolve")
      .send({ value: "ABC" });
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ code, reason });
  });

  it("matches the generated request and response contracts through the full app boundary", async () => {
    const { authorize, service } = fixture();
    const app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
    }, {
      auth: { authorize } as unknown as AuthService,
      inventoryBarcodes: service,
    });
    const response = await request(app)
      .post("/api/v1/inventory-barcodes/resolve-batch")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .send({ entries: [{ value: "4006381333931", clientReference: "line-1" }] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [{ index: 0, clientReference: "line-1", status: "RESOLVED", data: resolvedRecord() }],
    });
  });
});
