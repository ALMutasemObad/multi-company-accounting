import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProductImageRouter } from "../src/inventory/product-image-router.js";
import { ProductImageProcessingError } from "../src/media/product-image-processor.js";

const context = { userId: 3n, companyId: 7n };

describe("product image HTTP contract", () => {
  it("accepts bounded raw images with CSRF, create-only CAS, and no path disclosure", async () => {
    const authorize = vi.fn().mockResolvedValue(context);
    const upload = vi.fn().mockResolvedValue({
      created: true,
      image: { version: 1, thumbnailUrl: "/api/v1/inventory-items/11/image/inventory?v=1" },
    });
    const app = express().use((_request, response, next) => {
      response.setHeader("Cache-Control", "no-store"); response.setHeader("Pragma", "no-cache"); response.setHeader("Expires", "0"); next();
    }).use(createProductImageRouter({ authorize } as never, {
      upload,
      remove: vi.fn(),
      read: vi.fn(),
    } as never, 1024));

    const response = await request(app).put("/inventory-items/11/image")
      .set("Cookie", "sid=session-1").set("X-CSRF-Token", "csrf-1")
      .set("Content-Type", "image/png").set("If-None-Match", "*")
      .send(Buffer.from([1, 2, 3]));

    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"product-image-v1"');
    expect(response.body).toEqual({ image: { version: 1, thumbnailUrl: "/api/v1/inventory-items/11/image/inventory?v=1" } });
    expect(JSON.stringify(response.body)).not.toMatch(/contentHash|file|path|root/iu);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_catalog.manage", requireCsrf: true }));
    expect(upload).toHaveBeenCalledWith(context, expect.objectContaining({ inventoryItemId: 11n, createOnly: true, expectedVersion: null, declaredMediaType: "image/png" }));
  });

  it("uses the separate POS permission and immutable private cache validator", async () => {
    const authorize = vi.fn().mockResolvedValue(context);
    const read = vi.fn().mockResolvedValue({ bytes: Buffer.from("thumb"), mediaType: "image/webp", etag: '"product-image-v4"' });
    const app = express().use(createProductImageRouter({ authorize } as never, {
      upload: vi.fn(), remove: vi.fn(), read,
    } as never, 1024));

    const response = await request(app).get("/sales/catalog/items/11/image/pos?v=4")
      .set("Cookie", "sid=session-1");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(response.headers.etag).toBe('"product-image-v4"');
    expect(response.headers.pragma).toBeUndefined();
    expect(response.headers.expires).toBeUndefined();
    expect(response.headers.vary).toBe("Cookie");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "sales_catalog.view", requireCsrf: false }));
    expect(read).toHaveBeenCalledWith(context, { inventoryItemId: 11n, version: 4, variant: "pos" });
  });

  it("returns 304 without contradictory no-cache headers", async () => {
    const authorize = vi.fn().mockResolvedValue(context);
    const read = vi.fn().mockResolvedValue({ bytes: Buffer.from("thumb"), mediaType: "image/webp", etag: '"product-image-v4"' });
    const app = express().use((_request, response, next) => {
      response.setHeader("Cache-Control", "no-store"); response.setHeader("Pragma", "no-cache"); response.setHeader("Expires", "0"); next();
    }).use(createProductImageRouter({ authorize } as never, { upload: vi.fn(), remove: vi.fn(), read } as never, 1024));
    const response = await request(app).get("/inventory-items/11/image/inventory?v=4").set("If-None-Match", '"product-image-v4"');
    expect(response.status).toBe(304);
    expect(response.headers.pragma).toBeUndefined();
    expect(response.headers.expires).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_catalog.view", requireCsrf: false }));
  });

  it("requires delete CSRF/CAS and forwards the exact image version", async () => {
    const authorize = vi.fn().mockResolvedValue(context);
    const remove = vi.fn().mockResolvedValue(undefined);
    const app = express().use(createProductImageRouter({ authorize } as never, { upload: vi.fn(), remove, read: vi.fn() } as never, 1024));
    const response = await request(app).delete("/inventory-items/11/image")
      .set("Cookie", "sid=session-1").set("X-CSRF-Token", "csrf-1").set("If-Match", '"product-image-v5"');
    expect(response.status).toBe(204);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_catalog.manage", requireCsrf: true, csrfToken: "csrf-1" }));
    expect(remove).toHaveBeenCalledWith(context, 11n, 5);
  });

  it("returns 413 for oversized bodies", async () => {
    const app = express().use(createProductImageRouter({ authorize: vi.fn().mockResolvedValue(context) } as never, { upload: vi.fn(), remove: vi.fn(), read: vi.fn() } as never, 2));
    expect((await request(app).put("/inventory-items/11/image").set("Content-Type", "image/png").set("If-None-Match", "*").send(Buffer.from([1, 2, 3]))).status).toBe(413);
  });

  it("rejects authorization before parsing an oversized raw body or calling the service", async () => {
    const upload = vi.fn();
    const app = express().use(createProductImageRouter({ authorize: vi.fn().mockRejectedValue(new Error("unauthorized")) } as never, {
      upload, remove: vi.fn(), read: vi.fn(),
    } as never, 2));
    const response = await request(app).put("/inventory-items/11/image")
      .set("Content-Type", "image/png").set("If-None-Match", "*").send(Buffer.alloc(32));
    expect(response.status).toBe(500);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns 415 when the decoder rejects a declared media type", async () => {
    const upload = vi.fn().mockRejectedValue(new ProductImageProcessingError("UNSUPPORTED_IMAGE_TYPE"));
    const app = express().use(createProductImageRouter({ authorize: vi.fn().mockResolvedValue(context) } as never, { upload, remove: vi.fn(), read: vi.fn() } as never, 1024));
    expect((await request(app).put("/inventory-items/11/image").set("Content-Type", "image/gif").set("If-None-Match", "*").send(Buffer.from("GIF89a"))).status).toBe(415);
  });

  it("rejects missing or malformed write validators", async () => {
    const app = express().use(createProductImageRouter({ authorize: vi.fn().mockResolvedValue(context) } as never, {
      upload: vi.fn(), remove: vi.fn(), read: vi.fn(),
    } as never, 1024));
    expect((await request(app).put("/inventory-items/11/image").set("Content-Type", "image/png").send(Buffer.from([1]))).status).toBe(412);
    expect((await request(app).delete("/inventory-items/11/image").set("If-Match", "product-image-v1")).status).toBe(412);
  });

  it("passes a quoted replacement validator as the expected image version", async () => {
    const upload = vi.fn().mockResolvedValue({ created: false, image: { version: 5, thumbnailUrl: "/api/v1/inventory-items/11/image/inventory?v=5" } });
    const app = express().use(createProductImageRouter({ authorize: vi.fn().mockResolvedValue(context) } as never, {
      upload, remove: vi.fn(), read: vi.fn(),
    } as never, 1024));
    const response = await request(app).put("/inventory-items/11/image")
      .set("Content-Type", "image/webp").set("If-Match", '"product-image-v4"')
      .send(Buffer.from([1]));

    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(context, expect.objectContaining({ createOnly: false, expectedVersion: 4 }));
  });
});
