import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createSellingProfileRouter } from "../src/sales/selling-profile-router.js";
import { SellingProfileError } from "../src/sales/selling-profile-policy.js";
import type { AuthService } from "../src/auth/auth-service.js";
import type { SellingProfileService } from "../src/sales/selling-profile-service.js";

function harness() {
  const authorize = vi.fn().mockResolvedValue({ userId: 4n, companyId: 7n });
  const service = { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 24, total: 0, totalPages: 0 } }),
    get: vi.fn().mockRejectedValue(new SellingProfileError("NOT_FOUND")), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) };
  const app = express(); app.use(express.json());
  app.use(createSellingProfileRouter({ authorize } as Pick<AuthService, "authorize">, service as Pick<SellingProfileService, "list" | "get" | "create" | "update">));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error instanceof Error && error.message === "DENIED" ? 403 : 500).json({ code: "DENIED" }); };
  app.use(errors); return { app, authorize, service };
}

describe("selling catalog HTTP authorization and executable bodies", () => {
  it("requires catalog view without granting broader reference permissions", async () => {
    const { app, authorize, service } = harness();
    await request(app).get("/sales/catalog?page=2&pageSize=20&search=milk").expect(200);
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ permission: "sales_catalog.view", requireCsrf: false }));
    expect(service.list).toHaveBeenCalledWith({ userId: 4n, companyId: 7n }, { page: 2, pageSize: 20, search: "milk" });
  });
  it("denies before reading the database", async () => {
    const { app, authorize, service } = harness(); authorize.mockRejectedValue(new Error("DENIED"));
    await request(app).get("/sales/catalog").expect(403); expect(service.list).not.toHaveBeenCalled();
  });
  it("requires manage and CSRF plus a bounded key, and parses ids as bigint", async () => {
    const { app, authorize, service } = harness();
    const body = { unitPrice: "0", currencyId: "2", revenueAccountId: "3" };
    await request(app).post("/sales/catalog/items/11/selling-profile").send(body).expect(400);
    expect(service.create).not.toHaveBeenCalled();
    await request(app).post("/sales/catalog/items/11/selling-profile").set("Idempotency-Key", "profile-key-1").set("X-CSRF-Token", "csrf").send(body).expect(201);
    expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({ permission: "sales_catalog.manage", requireCsrf: true, csrfToken: "csrf" }));
    expect(service.create).toHaveBeenCalledWith({ userId: 4n, companyId: 7n }, 11n,
      { unitPrice: "0", currencyId: 2n, revenueAccountId: 3n, taxRateId: null }, "profile-key-1");
  });
  it("rejects unbounded search and pages, server-owned fields and missing version", async () => {
    const { app, service } = harness();
    for (const query of ["page=10001", "pageSize=101", `search=${"x".repeat(101)}`]) await request(app).get(`/sales/catalog?${query}`).expect(400);
    await request(app).post("/sales/catalog/items/1/selling-profile").set("Idempotency-Key", "profile-key-1")
      .send({ unitPrice: "2", currencyId: "2", revenueAccountId: "3", companyId: "99" }).expect(400);
    await request(app).patch("/sales/catalog/items/1/selling-profile").set("Idempotency-Key", "profile-key-1").send({ isActive: false }).expect(400);
    expect(service.list).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled(); expect(service.update).not.toHaveBeenCalled();
  });
  it("returns scoped 404 and stale version 409 without database details", async () => {
    const { app, service } = harness(); await request(app).get("/sales/catalog/items/999").expect(404);
    service.update.mockRejectedValue(new SellingProfileError("VERSION_CONFLICT"));
    const result = await request(app).patch("/sales/catalog/items/1/selling-profile").set("Idempotency-Key", "profile-key-1").send({ version: 1, isActive: false }).expect(409);
    expect(result.body.reason).toBe("VERSION_CONFLICT");
  });
});
