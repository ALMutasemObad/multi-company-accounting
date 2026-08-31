import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/auth/auth-service.js";
import { createPlatformSubscriptionRouter } from "../src/platform-subscriptions/platform-subscription-router.js";
import { PlatformSubscriptionCatalogService } from "../src/platform-subscriptions/platform-subscription-service.js";

function fixture(allow = true, companyId: bigint | null = 9n) {
  const context = { sessionId: 1n, userId: 7n, companyId };
  const authorize = vi.fn().mockImplementation(() => allow
    ? Promise.resolve(context)
    : Promise.reject(new AuthError("FORBIDDEN")));
  const authenticate = vi.fn().mockResolvedValue(context);
  const catalog = {
    publicCatalog: vi.fn().mockResolvedValue({ plans: [], meta: { page: 1, pageSize: 9, total: 0, totalPages: 0 } }),
    setPublicListing: vi.fn().mockResolvedValue({ version: { id: "12", publiclyListed: true, version: 2 } }),
    listModules: vi.fn().mockResolvedValue({ modules: [] }),
    listPlans: vi.fn().mockResolvedValue({ plans: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    updatePlan: vi.fn().mockResolvedValue({ plan: { id: "12", code: "BASIC", active: false, version: 2 } }),
  };
  const lifecycle = {
    ownerCompany: vi.fn().mockResolvedValue({ company: { id: String(companyId), code: "QA", name: "QA Company", active: true }, subscription: {}, current: {}, effectiveModules: [], scheduled: null, pending: null, history: [], meta: {}, generatedAt: new Date().toISOString() }),
    ownerCatalog: vi.fn().mockResolvedValue({ plans: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    requestOwnerChange: vi.fn().mockResolvedValue({ change: { state: "PENDING_APPROVAL" }, subscriptionVersion: 2, paymentCollected: false }),
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformSubscriptionRouter({ authorize, authenticate } as never, catalog as never, lifecycle as never));
  app.use(((error, _request, response, _next) => {
    response.status(error instanceof AuthError && error.reason === "FORBIDDEN" ? 403 : 400).json({ code: error instanceof AuthError ? error.reason : "VALIDATION_ERROR" });
  }) satisfies ErrorRequestHandler);
  return { app, authenticate, authorize, lifecycle, catalog };
}

describe("platform subscription router permissions and contracts", () => {
  it("serves the public catalog without authentication or company context and bounds its query", async () => {
    const { app, authenticate, authorize, catalog, lifecycle } = fixture(false, null);
    await request(app).get("/public/subscription-plans?page=2").expect(200);
    for (const query of ["page=0", "page=1001", "page=1.5", "page=1&page=2", "pageSize=100", "companyId=4"]) {
      await request(app).get(`/public/subscription-plans?${query}`).expect(400);
    }
    expect(catalog.publicCatalog).toHaveBeenCalledExactlyOnceWith(2);
    expect(authenticate).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(lifecycle.requestOwnerChange).not.toHaveBeenCalled();
  });

  it("uses a strict generated visibility command and requires CSRF authentication without tenant scope", async () => {
    const { app, authenticate, catalog } = fixture(true, null);
    await request(app).put("/platform/subscription-plan-versions/12/public-listing")
      .set("Cookie", "sid=session").set("X-CSRF-Token", "csrf").send({ publiclyListed: true, version: 1 }).expect(200);
    expect(authenticate).toHaveBeenCalledWith({ sid: "session", csrfToken: "csrf", requireCsrf: true });
    expect(catalog.setPublicListing).toHaveBeenCalledExactlyOnceWith({ userId: 7n }, 12n, { publiclyListed: true, version: 1 });
    for (const body of [{ publiclyListed: true }, { publiclyListed: "true", version: 1 }, { publiclyListed: true, version: 1, companyId: "9" }]) {
      await request(app).put("/platform/subscription-plan-versions/12/public-listing").send(body).expect(400);
    }
    expect(catalog.setPublicListing).toHaveBeenCalledTimes(1);
    authenticate.mockRejectedValueOnce(new AuthError("FORBIDDEN"));
    await request(app).put("/platform/subscription-plan-versions/12/public-listing").send({ publiclyListed: false, version: 2 }).expect(403);
    expect(catalog.setPublicListing).toHaveBeenCalledTimes(1);
  });
  it("keeps owner reads and writes on separate explicit permissions", async () => {
    const { app, authorize, lifecycle } = fixture();
    await request(app).get("/subscription?page=2&pageSize=10").set("Cookie", "sid=session").expect(200);
    await request(app).get("/subscription/catalog").set("Cookie", "sid=session").expect(200);
    await request(app).post("/subscription/change-requests")
      .set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "owner-subscription-change")
      .send({ expectedCompanyId: "9", targetPlanVersionId: "12", optionalModuleIds: ["4"], subscriptionVersion: 1 })
      .expect(201);

    expect(authorize.mock.calls.map(([input]) => [input.permission, input.requireCsrf])).toEqual([
      ["subscriptions.view", false], ["subscriptions.view", false], ["subscriptions.manage", true],
    ]);
    expect(lifecycle.ownerCompany).toHaveBeenCalledWith(9n, { page: 2, pageSize: 10 });
    expect(lifecycle.requestOwnerChange).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 9n, userId: 7n }),
      expect.objectContaining({ expectedCompanyId: 9n, targetPlanVersionId: 12n, optionalModuleIds: [4n], idempotencyKey: "owner-subscription-change" }),
    );
  });

  it("rejects direct API access without the permission before reading another company scope", async () => {
    const { app, lifecycle } = fixture(false);
    await request(app).get("/subscription").set("Cookie", "sid=session").expect(403);
    await request(app).post("/subscription/change-requests")
      .set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "owner-subscription-change")
      .send({ expectedCompanyId: "9", targetPlanVersionId: "12", optionalModuleIds: [], subscriptionVersion: 1 })
      .expect(403);
    expect(lifecycle.ownerCompany).not.toHaveBeenCalled();
    expect(lifecycle.requestOwnerChange).not.toHaveBeenCalled();
  });

  it("bounds database-backed catalog pagination before invoking the service", async () => {
    const { app, catalog } = fixture();
    await request(app).get("/platform/subscription-plans?page=3&pageSize=40&active=ACTIVE&publicationStatus=DRAFT").expect(200);
    await request(app).get("/platform/subscription-plans?pageSize=101").expect(400);
    expect(catalog.listPlans).toHaveBeenCalledTimes(1);
    expect(catalog.listPlans).toHaveBeenCalledWith(7n, {
      page: 3, pageSize: 40, search: undefined, active: "ACTIVE", publicationStatus: "DRAFT",
    });
  });

  it("allows a CSRF-protected platform operator write without inventing a selected company", async () => {
    const { app, catalog } = fixture(true, null);
    await request(app).patch("/platform/subscription-plans/12")
      .set("Cookie", "sid=session").set("X-CSRF-Token", "csrf")
      .send({ active: false, version: 1 })
      .expect(200);
    expect(catalog.updatePlan).toHaveBeenCalledWith(
      { userId: 7n }, 12n, { active: false, version: 1 },
    );
  });

  it("rejects direct platform catalog access when operator capability is absent", async () => {
    const { app, catalog } = fixture();
    const guardedCatalog = new PlatformSubscriptionCatalogService(
      {} as never,
      { isOperator: vi.fn().mockResolvedValue(false) },
    );
    catalog.listPlans.mockImplementationOnce(() => guardedCatalog.listPlans(7n, {
      page: 1, pageSize: 20, active: "ALL", publicationStatus: "ALL",
    }));
    await request(app).get("/platform/subscription-plans").set("Cookie", "sid=session").expect(403);
  });
});
