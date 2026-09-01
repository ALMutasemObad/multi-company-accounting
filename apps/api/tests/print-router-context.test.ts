import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import type { AuthStore, StoredSession } from "../src/auth/auth-store.js";
import { hashToken } from "../src/auth/session-tokens.js";
import type { ActorContext } from "../src/platform/actor-context.js";
import { CompanyCapabilityService } from "../src/platform-subscriptions/company-capability-service.js";
import type { PlatformModuleCode } from "../src/platform-subscriptions/platform-entitlement-ports.js";
import { currentRequestContext } from "../src/operations/request-context.js";
import type { PrintableDocumentKind } from "../src/printing/print-ports.js";
import type { PrintService } from "../src/printing/print-service.js";

const expected = { "X-POS-Expected-User-Id": "1", "X-POS-Expected-Company-Id": "2" };

function fixture() {
  const session: StoredSession = { id: 3n, state: "AUTHENTICATED", userId: 1n, selectedCompanyId: 2n,
    csrfHash: hashToken("csrf-a"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
  const modules: PlatformModuleCode[] = ["CORE_ACCOUNTING", "SALES", "PURCHASES", "TREASURY"];
  const state = { permission: true, modules,
    beforeArchive: () => {}, afterRender: () => {}, afterEffects: () => {}, archived: false, printCount: 0 };
  const findSession = vi.fn(async (hash: Uint8Array) => Buffer.from(hash).equals(Buffer.from(hashToken("session-a"))) ? { ...session } : null);
  const hasPermission = vi.fn(async (_input: { userId: bigint; companyId: bigint; code: string }) => state.permission);
  const auth = new AuthService({ findSession, hasPermission } as unknown as AuthStore, { verify: async () => false }, {
    preAuthTtlMinutes: 10, sessionTtlHours: 12,
    companyCapabilities: new CompanyCapabilityService({ findCompanyEntitlements: async companyId => ({
      companyId, subscriptionId: 5n, status: "ACTIVE", version: 1,
      plan: { code: "TEST", versionNumber: 1, displayName: "Fixture" }, moduleCodes: state.modules,
    }) }),
  });
  const print = vi.fn(async (_actor: ActorContext, _kind: PrintableDocumentKind, _entityId: bigint, assertAuthorized?: () => Promise<void>) => {
    state.beforeArchive(); await assertAuthorized?.(); state.archived = true;
    state.afterRender(); await assertAuthorized?.(); state.printCount += 1;
    state.afterEffects();
    return { buffer: Buffer.from("fixture PDF"), filename: "invoice-118.pdf", archive: {
      id: "901", hash: "a".repeat(64), printCount: state.printCount, archivedAt: "2026-08-31T10:00:00.000Z", lastPrintedAt: "2026-08-31T10:30:00.000Z",
    } };
  });
  const app = createApp({ NODE_ENV: "test", PORT: 3165, WEB_ORIGIN: "http://127.0.0.1:4215",
    SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 }, { auth, printing: { print } as unknown as PrintService });
  const call = (path = "/sales-invoices/801/pdf") => request(app).get("/api/v1" + path).set("Cookie", "sid=session-a");
  return { app, call, state, session, print, hasPermission, findSession };
}

describe("optional POS context on the existing sales A4 route (real AuthService, fixture printing port)", () => {
  it.each([
    ["/sales-invoices/801/pdf", "SALES_INVOICE", "sales_invoices.print"], ["/purchase-invoices/801/pdf", "PURCHASE_INVOICE", "purchase_invoices.print"],
    ["/receipts/801/pdf", "RECEIPT", "receipts.print"], ["/payments/801/pdf", "PAYMENT", "payments.print"],
    ["/manual-journals/801/pdf", "MANUAL_JOURNAL", "manual_journals.print"],
  ])("preserves unscoped %s and its single original authorization", async (path, kind, permission) => {
    const f = fixture(); const response = await f.call(path).expect(200);
    expect(f.print).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), kind, 801n);
    expect(f.hasPermission).toHaveBeenCalledExactlyOnceWith({ userId: 1n, companyId: 2n, code: permission });
    expect(response.headers["content-type"]).toContain("application/pdf"); expect(response.headers["content-disposition"]).toContain("invoice-118.pdf");
    expect(response.headers["x-print-archive-id"]).toBe("901"); expect(response.headers["x-print-archive-hash"]).toBe("a".repeat(64));
    expect(response.headers).not.toHaveProperty("x-pos-user-id"); expect(response.headers).not.toHaveProperty("x-pos-company-id");
    expect(response.headers).not.toHaveProperty("x-sales-invoice-id"); expect(f.state.printCount).toBe(1);
  });

  it("uses SALES authorization at every checkpoint and returns captured user/company plus source invoice identity", async () => {
    const f = fixture(); const response = await f.call().set(expected).expect(200);
    expect(f.print).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), "SALES_INVOICE", 801n, expect.any(Function));
    expect(f.hasPermission).toHaveBeenCalledTimes(4);
    for (const [input] of f.hasPermission.mock.calls) expect(input).toEqual({ userId: 1n, companyId: 2n, code: "sales_invoices.print" });
    expect(response.headers["x-pos-user-id"]).toBe("1"); expect(response.headers["x-pos-company-id"]).toBe("2");
    expect(response.headers["x-sales-invoice-id"]).toBe("801"); expect(response.headers["x-print-archive-id"]).toBe("901");
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("does not add POS header semantics to unrelated legacy document kinds", async () => {
    const f = fixture(); await f.call("/receipts/801/pdf").set("X-POS-Expected-User-Id", "01").expect(200);
    expect(f.hasPermission).toHaveBeenCalledTimes(1); expect(f.print.mock.calls[0]).toHaveLength(3);
  });

  it.each([
    { "X-POS-Expected-User-Id": "1" }, { "X-POS-Expected-Company-Id": "2" },
    { ...expected, "X-POS-Expected-User-Id": ["1", "1"] }, { ...expected, "X-POS-Expected-Company-Id": ["2", "2"] },
    { ...expected, "X-POS-Expected-User-Id": "1, 1" }, { ...expected, "X-POS-Expected-Company-Id": "01" },
    { ...expected, "X-POS-Expected-Company-Id": "0" }, { ...expected, "X-POS-Expected-User-Id": "18446744073709551616" },
  ])("rejects partial, duplicate or noncanonical headers without falling back: %j", async pair => {
    const f = fixture(); const response = await f.call().set(pair).expect(400);
    expect(response.body).toEqual({ status: 400, code: "POS_CONTEXT_REQUIRED" });
    expect(f.print).not.toHaveBeenCalled(); expect(f.hasPermission).not.toHaveBeenCalled();
  });

  it.each(["user", "company"])("blocks stale expected %s before calling Printing", async change => {
    const f = fixture(); if (change === "user") f.session.userId = 9n; else f.session.selectedCompanyId = 22n;
    const response = await f.call().set(expected).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" }); expect(f.print).not.toHaveBeenCalled();
  });

  it.each(["permission", "SALES"])("requires %s before Printing regardless of valid expected identity", async denied => {
    const f = fixture(); if (denied === "permission") f.state.permission = false; else f.state.modules = ["CORE_ACCOUNTING", "TREASURY"];
    await f.call().set(expected).expect(403); expect(f.print).not.toHaveBeenCalled();
  });

  it("does not treat expected headers as authentication", async () => {
    const f = fixture(); await request(f.app).get("/api/v1/sales-invoices/801/pdf").set(expected).expect(401);
    expect(f.print).not.toHaveBeenCalled();
  });

  it.each(["beforeArchive", "afterRender", "afterEffects"] as const)("rejects a company switch at %s and never labels committed effects as rolled back", async stage => {
    const f = fixture(); f.state[stage] = () => { f.session.selectedCompanyId = 22n; };
    const response = await f.call().set(expected).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" });
    expect(response.headers).not.toHaveProperty("x-pos-company-id"); expect(response.headers).not.toHaveProperty("x-print-archive-id");
    expect(f.state.archived).toBe(stage !== "beforeArchive"); expect(f.state.printCount).toBe(stage === "afterEffects" ? 1 : 0);
  });

  it.each(["permission", "session", "SALES"])("rejects revoked %s after render without starting printCount/Audit", async revoked => {
    const f = fixture(); f.state.afterRender = () => {
      if (revoked === "permission") f.state.permission = false;
      else if (revoked === "session") f.session.revokedAt = new Date();
      else f.state.modules = ["CORE_ACCOUNTING"];
    };
    const response = await f.call().set(expected).expect(revoked === "session" ? 401 : 403);
    expect(f.state.archived).toBe(true); expect(f.state.printCount).toBe(0);
    expect(response.headers).not.toHaveProperty("x-pos-user-id"); expect(response.headers["content-type"]).not.toContain("application/pdf");
  });

  it.each(["beforeArchive", "afterRender"] as const)("stops scoped work at its request deadline at %s", async stage => {
    const f = fixture(); f.state[stage] = () => { currentRequestContext()!.deadlineAt = Date.now() - 1; };
    await f.call().set(expected).expect(504);
    expect(f.state.archived).toBe(stage === "afterRender"); expect(f.state.printCount).toBe(0);
  });
});
