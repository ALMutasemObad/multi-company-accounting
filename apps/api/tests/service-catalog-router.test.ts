import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createServiceCatalogRouter } from "../src/service-catalog/service-catalog-router.js";

const categoryId = "1b7a8d78-a340-46c0-a059-4bf1acd6a746";
const context = { companyId: 11n, userId: 22n };

function fixture() {
  const authorize = vi.fn().mockResolvedValue(context);
  const catalog = {
    listCategories: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    getCategory: vi.fn().mockResolvedValue({ category: {} }),
    createCategory: vi.fn().mockResolvedValue({ category: {} }),
    updateCategory: vi.fn().mockResolvedValue({ category: {} }),
    transitionCategory: vi.fn().mockResolvedValue({ category: {} }),
  };
  const app = express();
  app.use(express.json());
  app.use(createServiceCatalogRouter({ authorize } as never, catalog as never));
  const write = (call: request.Test) => call.set("Cookie", "sid=test-session")
    .set("X-CSRF-Token", "test-csrf").set("Idempotency-Key", "service-category-test-key-1234");
  return { app, authorize, catalog, write };
}

describe("service catalog category HTTP boundary", () => {
  it("requires catalog-specific read/write permissions and forwards idempotency", async () => {
    const { app, authorize, catalog, write } = fixture();
    await request(app).get("/service-catalog/categories?page=2&pageSize=10").expect(200);
    await request(app).get(`/service-catalog/categories/${categoryId}`).expect(200);
    await write(request(app).post("/service-catalog/categories")).send({ nameAr: " خدمة تجريبية " }).expect(201);
    await write(request(app).patch(`/service-catalog/categories/${categoryId}`)).send({ expectedVersion: 0, nameEn: "Category" }).expect(200);
    await write(request(app).post(`/service-catalog/categories/${categoryId}/transition`)).send({
      expectedVersion: 1, to: "INACTIVE", reason: "Approved for temporary pause",
    }).expect(200);
    expect(authorize.mock.calls.map(([input]) => [input.permission, input.requireCsrf])).toEqual([
      ["services.view", false], ["services.view", false],
      ["services.manage", true], ["services.manage", true], ["services.manage", true],
    ]);
    expect(catalog.listCategories).toHaveBeenCalledWith(context, expect.objectContaining({ page: 2, pageSize: 10 }));
    expect(catalog.createCategory).toHaveBeenCalledWith(context, expect.objectContaining({ nameAr: "خدمة تجريبية", idempotencyKey: "service-category-test-key-1234" }));
    expect(catalog.transitionCategory).toHaveBeenCalledWith(context, categoryId, expect.objectContaining({ expectedVersion: 1 }));
  });

  it("rejects hidden status/code fields and missing idempotency keys", async () => {
    const { app, catalog, write } = fixture();
    await write(request(app).post("/service-catalog/categories")).send({ nameAr: "خدمة", status: "ACTIVE" }).expect(400);
    await write(request(app).post("/service-catalog/categories")).send({ nameAr: "خدمة", code: "SVC-1" }).expect(400);
    await request(app).post("/service-catalog/categories").send({ nameAr: "خدمة" }).expect(400);
    await write(request(app).patch(`/service-catalog/categories/${categoryId}`)).send({ expectedVersion: 0, status: "RETIRED" }).expect(400);
    expect(catalog.createCategory).not.toHaveBeenCalled();
    expect(catalog.updateCategory).not.toHaveBeenCalled();
  });
});
