import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import type { AuthStore, StoredSession } from "../src/auth/auth-store.js";
import { hashToken } from "../src/auth/session-tokens.js";
import { CompanyCapabilityService } from "../src/platform-subscriptions/company-capability-service.js";
import { PrismaPosRecoveryQueryAdapter } from "../src/platform/prisma-pos-recovery-query-adapter.js";
import { PosRecoveryService } from "../src/pos/recovery-service.js";
import type { PosService } from "../src/pos/pos-service.js";
import { IdempotentCommandRejection } from "../src/platform/idempotent-command-executor.js";

const attemptKey = "550e8400-e29b-41d4-a716-446655440000";
const keyHash = new Uint8Array(createHash("sha256").update(attemptKey).digest());
const result = { id: "701", completedAt: "2026-08-31T08:30:00.000Z",
  invoice: { id: "801", documentNumber: "SI-801", status: "POSTED", customerName: "Test customer",
    total: "900719925474099.1234", baseTotal: "900719925474099.1234", generatedJournalEntryIds: ["1001"] },
  receipt: { id: "901", documentNumber: "RC-901", status: "POSTED", generatedJournalEntryIds: ["1002"] } };
const rejection = { code: "POS_CHECKOUT_REJECTED", reason: "INVALID_CASH_BANK_ACCOUNT" };
const tombstone = { kind: "POS_CHECKOUT_REJECTION", version: 1, rejection };

function fixture() {
  const session: StoredSession = { id: 3n, state: "AUTHENTICATED", userId: 1n, selectedCompanyId: 2n,
    csrfHash: hashToken("synthetic-csrf"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
  const state = { permission: true, entitled: true, responseStatus: 201, responseBody: result as unknown,
    afterLookup: (() => {}) as () => void, present: true };
  const findSession = vi.fn(async (token: Uint8Array) => Buffer.from(token).equals(Buffer.from(hashToken("synthetic-session"))) ? { ...session } : null);
  const hasPermission = vi.fn(async ({ code }: { code: string }) => state.permission && code === "pos.checkout");
  const auth = new AuthService({ findSession, hasPermission } as unknown as AuthStore, { verify: async () => false }, {
    preAuthTtlMinutes: 10, sessionTtlHours: 12,
    companyCapabilities: new CompanyCapabilityService({ findCompanyEntitlements: async companyId => ({
      companyId, subscriptionId: 5n, status: "ACTIVE", version: 1,
      plan: { code: "TEST", versionNumber: 1, displayName: "Test" }, moduleCodes: state.entitled ? ["POS"] : [],
    }) }),
  });
  const findUnique = vi.fn(async ({ where }: { where: { companyId_userId_operation_keyHash: {
    companyId: bigint; userId: bigint; operation: string; keyHash: Uint8Array;
  } } }) => {
    const scope = where.companyId_userId_operation_keyHash;
    const matches = state.present && scope.companyId === 2n && scope.userId === 1n && scope.operation === "COMPLETE_POS_CHECKOUT"
      && Buffer.from(scope.keyHash).equals(Buffer.from(keyHash));
    state.afterLookup();
    return matches ? { companyId: 2n, userId: 1n, operation: "COMPLETE_POS_CHECKOUT", status: "COMPLETED",
      responseStatus: state.responseStatus, responseBody: state.responseBody, expiresAt: new Date(Date.now() + 60_000) } : null;
  });
  const checkout = vi.fn();
  const app = createApp({ NODE_ENV: "test", PORT: 3165, WEB_ORIGIN: "http://127.0.0.1:4215", SESSION_COOKIE_SECURE: false,
    PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 }, {
    auth, pos: { checkout } as unknown as PosService,
    posRecovery: new PosRecoveryService(new PrismaPosRecoveryQueryAdapter({ idempotencyRecord: { findUnique } } as unknown as PrismaClient)),
  });
  const post = () => request(app).post("/api/v1/pos/checkouts/recovery").set("Cookie", "sid=synthetic-session").set("X-CSRF-Token", "synthetic-csrf");
  return { app, post, state, session, findUnique, hasPermission, checkout };
}

describe("mounted POS recovery with real authorization and generated HTTP contracts (fixture storage, not DB)", () => {
  it("returns the original invoice id, precise Decimal and no correlation under private cache headers", async () => {
    const f = fixture(); const response = await f.post().send({ attemptKey }).expect(200);
    expect(response.body).toEqual({ outcome: "CONFIRMED", result });
    expect(response.body.result.invoice.id).toBe("801");
    expect(response.body.result.invoice.id).not.toBe(result.invoice.generatedJournalEntryIds[0]);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(response.body)).not.toMatch(/attemptKey|keyHash|Fingerprint|companyId|userId/);
    expect(f.hasPermission).toHaveBeenCalledTimes(2);
    expect(f.checkout).not.toHaveBeenCalled();
    expect(f.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { companyId_userId_operation_keyHash: {
      companyId: 2n, userId: 1n, operation: "COMPLETE_POS_CHECKOUT", keyHash,
    } }, select: { companyId: true, userId: true, operation: true, status: true, responseStatus: true, expiresAt: true, responseBody: true } });
  });
  it.each(["permission", "entitled"] as const)("denies recovery without %s and never performs lookup", async denied => {
    const f = fixture(); f.state[denied] = false;
    const response = await f.post().send({ attemptKey }).expect(403);
    expect(response.headers["cache-control"]).toContain("no-store"); expect(f.findUnique).not.toHaveBeenCalled();
  });
  it("requires the real authenticated CSRF pair", async () => {
    const f = fixture();
    await request(f.app).post("/api/v1/pos/checkouts/recovery").set("Cookie", "sid=synthetic-session").send({ attemptKey }).expect(403);
    await request(f.app).post("/api/v1/pos/checkouts/recovery").set("X-CSRF-Token", "synthetic-csrf").send({ attemptKey }).expect(401);
    expect(f.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ attemptKey, companyId: "2" }, { attemptKey, userId: "1" }, { attemptKey: "invalid" },
    { attemptKey: "550e8400-e29b-11d4-a716-446655440000" }, {}])("rejects untrusted scope and invalid UUID bodies", async body => {
    const f = fixture(); await f.post().send(body).expect(400); expect(f.findUnique).not.toHaveBeenCalled();
  });
  it.each(["user", "company"] as const)("does not disclose another %s's evidence", async scope => {
    const f = fixture(); if (scope === "user") f.session.userId = 8n; else f.session.selectedCompanyId = 9n;
    expect((await f.post().send({ attemptKey }).expect(200)).body).toEqual({ outcome: "UNKNOWN" });
  });
  it.each(["user", "company", "permission", "entitled"] as const)("checks %s again after result lookup", async changed => {
    const f = fixture(); f.state.afterLookup = () => {
      if (changed === "user") f.session.userId = 8n;
      else if (changed === "company") f.session.selectedCompanyId = 9n;
      else f.state[changed] = false;
    };
    const response = await f.post().send({ attemptKey }).expect(changed === "user" || changed === "company" ? 200 : 403);
    expect(JSON.stringify(response.body)).not.toContain("SI-801");
  });
  it("reads a retained versioned rejection after a lost response without any financial POST", async () => {
    const f = fixture(); f.state.responseStatus = 422; f.state.responseBody = tombstone;
    expect((await f.post().send({ attemptKey }).expect(200)).body).toEqual({ outcome: "REJECTED", rejection });
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it.each([tombstone, { code: "POS_CHECKOUT_REJECTED", reason: "INVALID_TOTAL" }])("never returns a rejection body as CONFIRMED", async body => {
    const f = fixture(); f.state.responseBody = body;
    expect((await f.post().send({ attemptKey }).expect(200)).body).toEqual({ outcome: "UNKNOWN" });
  });
  it("hides version/kind and stored payload when mapping a terminal checkout error", async () => {
    const f = fixture(); f.checkout.mockRejectedValue(new IdempotentCommandRejection(422, tombstone));
    const response = await request(f.app).post("/api/v1/pos/checkouts").set("Cookie", "sid=synthetic-session")
      .set("X-CSRF-Token", "synthetic-csrf").set("Idempotency-Key", attemptKey).send({
        fiscalPeriodId: "1", documentDate: "2026-08-31", description: "Test sale", customerId: "1", warehouseId: "1", currencyId: "1",
        exchangeRate: "1.00000000", cashBankAccountId: "1", paymentMethodId: "1",
        lines: [{ inventoryItemId: "1", description: "Item", quantity: "1.000000", unitPrice: "2.0000", discountAmount: "0.0000", revenueAccountId: "1" }],
      }).expect(422);
    expect(f.checkout).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ companyId: 2n, userId: 1n }),
      expect.objectContaining({ lines: [expect.objectContaining({ inventoryItemId: 1n })] }),
      attemptKey,
    );
    expect(response.body).toEqual({ status: 422, ...rejection });
  });
});
