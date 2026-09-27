import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth-service.js";
import { createInventoryCatalogImportRouter } from "../src/inventory/inventory-catalog-import-router.js";
import type { InventoryCatalogImportService } from "../src/inventory/inventory-catalog-import-service.js";

describe("catalog-only import router", () => {
  it("requires catalog management and CSRF for preview and commit", async () => {
    const context = { companyId: 3n, userId: 4n };
    const authorize = vi.fn().mockResolvedValue(context);
    const preview = vi.fn().mockResolvedValue({ previewHash: "a".repeat(64), rowCount: 1,
      createCount: 1, skipCount: 0, errors: [], rows: [{ row: 2, sourceKey: "src:2", nameAr: "كتاب", status: "CREATE" }] });
    const commit = vi.fn().mockResolvedValue({ created: 1, skipped: 0 });
    const app = express();
    app.use(express.json());
    app.use(createInventoryCatalogImportRouter(
      { authorize } as unknown as AuthService,
      { preview, commit } as unknown as InventoryCatalogImportService,
    ));
    const body = { contentBase64: Buffer.from("source_key,name_ar\nsrc:2,كتاب\n").toString("base64"), sourceFormat: "CSV", unitOfMeasureId: "2" };
    await request(app).post("/inventory-items/catalog-import/preview")
      .set("Cookie", "sid=login").set("X-CSRF-Token", "csrf").send(body).expect(200);
    expect(authorize).toHaveBeenCalledWith({ sid: "login", csrfToken: "csrf", permission: "inventory_catalog.manage", requireCsrf: true });
    expect(preview).toHaveBeenCalledWith(context, { ...body, unitOfMeasureId: 2n });
    await request(app).post("/inventory-items/catalog-import/commit")
      .set("Cookie", "sid=login").set("X-CSRF-Token", "csrf")
      .send({ ...body, previewHash: "a".repeat(64) }).expect(200, { created: 1, skipped: 0 });
    expect(commit).toHaveBeenCalledWith(context, { ...body, unitOfMeasureId: 2n }, "a".repeat(64));
    await request(app).post("/inventory-items/catalog-import/commit")
      .send({ ...body, previewHash: "bad" }).expect(400);
  });
});
