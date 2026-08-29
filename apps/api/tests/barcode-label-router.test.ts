import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { createBarcodeLabelRouter } from "../src/printing/barcode-label-router.js";
import {
  BarcodeLabelError,
  type BarcodeLabelService,
} from "../src/printing/barcode-label-service.js";

const context = { companyId: 5n, userId: 7n };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function fixture() {
  const authorize = vi.fn().mockResolvedValue(context);
  const labels = {
    download: vi.fn().mockResolvedValue({
      buffer: png,
      filename: "inventory-item-11-barcode-31.png",
    }),
  } as unknown as BarcodeLabelService;
  const app = express();
  app.use(createBarcodeLabelRouter(
    { authorize } as unknown as AuthService,
    labels,
  ));
  app.use(((error, _request, response, _next) => {
    response.status(500).json({ code: "TEST_ERROR", error: String(error) });
  }) satisfies ErrorRequestHandler);
  return { app, authorize, labels };
}

describe("barcode label download router", () => {
  it("uses the print permission and returns a no-store PNG with a safe filename", async () => {
    const { app, authorize, labels } = fixture();
    const response = await request(app)
      .get("/inventory-items/11/barcodes/31/label.png")
      .set("Cookie", "sid=session-token")
      .expect(200);

    expect(authorize).toHaveBeenCalledWith({
      sid: "session-token",
      permission: "inventory_barcodes.print",
      requireCsrf: false,
    });
    expect(labels.download).toHaveBeenCalledWith(context, 11n, 31n);
    expect(response.headers["content-type"]).toMatch(/^image\/png/u);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-disposition"])
      .toBe('attachment; filename="inventory-item-11-barcode-31.png"');
    expect(response.body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(JSON.stringify(response.headers)).not.toContain("0012345678905");
  });

  it("rejects invalid identifiers before calling the service", async () => {
    const { app, labels } = fixture();
    await request(app)
      .get("/inventory-items/not-an-id/barcodes/31/label.png")
      .expect(400);
    expect(labels.download).not.toHaveBeenCalled();
  });

  it("maps unavailable, inactive, and foreign records to the same 404", async () => {
    const { app, labels } = fixture();
    vi.mocked(labels.download).mockRejectedValueOnce(new BarcodeLabelError("NOT_FOUND"));
    const response = await request(app)
      .get("/inventory-items/11/barcodes/99/label.png")
      .expect(404);
    expect(response.body).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
