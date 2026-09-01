import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppServices } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import type { AuthStore, StoredSession } from "../src/auth/auth-store.js";
import { hashToken } from "../src/auth/session-tokens.js";
import { CompanyCapabilityService } from "../src/platform-subscriptions/company-capability-service.js";
import { PosRecoveryService } from "../src/pos/recovery-service.js";
import { canonicalCheckoutFingerprint, PosError } from "../src/pos/pos-service.js";
import { openApiRequestBodySchemas, openApiResponseBodySchemas, posCheckoutResultResponseComponentSchema } from "../src/generated/openapi-request-guards.js";
import { CashierContextPeriodError } from "../src/core-accounting/cashier-context-period-policy.js";
import type { CashierContextPeriodResult } from "../src/core-accounting/cashier-context-period-port.js";

const headers = { "X-POS-Expected-User-Id": "1", "X-POS-Expected-Company-Id": "2" };
const identity = { userId: "1", companyId: "2" };
const key = "550e8400-e29b-41d4-a716-446655440000";
const payload = { fiscalPeriodId: "10", documentDate: "2026-08-31", description: "Fixture sale",
  customerId: "11", warehouseId: "12", currencyId: "13", exchangeRate: "1.00000000",
  cashBankAccountId: "14", paymentMethodId: "15",
  lines: [{ inventoryItemId: "16", description: "Fixture item", quantity: "1.000000", unitPrice: "2.0000",
    discountAmount: "0.0000", revenueAccountId: "17" }] };
const sale = { id: "701", completedAt: "2026-08-31T08:30:00.000Z",
  invoice: { id: "801", documentNumber: "SI-801", status: "POSTED", customerName: "Fixture customer",
    total: "900719925474099.1234", baseTotal: "900719925474099.1234", generatedJournalEntryIds: ["1001"] },
  receipt: { id: "901", documentNumber: "RC-901", status: "POSTED", generatedJournalEntryIds: ["1002"] } };
const barcode = { barcode: { id: "31", symbology: "EAN_13", isPrimary: true },
  inventoryItem: { id: "16", code: "ITM-16", nameAr: "صنف اختبار", nameEn: null, description: null,
    unitOfMeasure: { id: "21", code: "EA", nameAr: "حبة", decimalPlaces: 0 } } };
const catalogItem = { inventoryItemId: "16", code: "ITM-16", nameAr: "صنف اختبار", nameEn: null,
  description: null, isActive: true, unitOfMeasure: { id: "21", code: "EA", nameAr: "حبة", nameEn: null, decimalPlaces: 0, isActive: true },
  sellingProfile: null, isReady: false, readinessReason: "PROFILE_MISSING" };

function fixture() {
  const first: StoredSession = { id: 3n, state: "AUTHENTICATED", userId: 1n, selectedCompanyId: 2n,
    csrfHash: hashToken("csrf-a"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
  const second: StoredSession = { ...first, id: 4n, userId: 9n, csrfHash: hashToken("csrf-b") };
  const state = { afterRead: () => {}, permissions: true, denied: new Set<string>() };
  const findSession = vi.fn(async (hash: Uint8Array) => {
    if (Buffer.from(hash).equals(Buffer.from(hashToken("session-a")))) return { ...first };
    if (Buffer.from(hash).equals(Buffer.from(hashToken("session-b")))) return { ...second };
    return null;
  });
  const hasPermission = vi.fn(async ({ code }: { code: string }) => state.permissions && !state.denied.has(code));
  const auth = new AuthService({ findSession, hasPermission } as unknown as AuthStore, { verify: async () => false }, {
    preAuthTtlMinutes: 10, sessionTtlHours: 12,
    companyCapabilities: new CompanyCapabilityService({ findCompanyEntitlements: async companyId => ({
      companyId, subscriptionId: 5n, status: "ACTIVE", version: 1,
      plan: { code: "TEST", versionNumber: 1, displayName: "Fixture" },
      moduleCodes: ["POS", "CORE_ACCOUNTING", "SALES", "PURCHASES", "INVENTORY", "TREASURY"],
    }) }),
  });
  const work = vi.fn(() => state.afterRead());
  const list = vi.fn(async () => { work(); return { data: [], total: 0 }; });
  const page = { page: 1, pageSize: 24, total: 0, totalPages: 0 };
  const catalog = { list: vi.fn(async () => { work(); return { data: [], meta: page }; }),
    get: vi.fn(async () => { work(); return { data: catalogItem }; }) };
  const resolveBarcode = vi.fn(async () => { work(); return barcode; });
  const checkout = vi.fn(async () => { work(); return sale; });
  const lookup = vi.fn(async () => { work(); return {
    companyId: 2n, userId: 1n, operation: "COMPLETE_POS_CHECKOUT" as const, status: "COMPLETED" as const,
    responseStatus: 201, responseBody: sale, expiresAt: new Date(Date.now() + 60_000),
  }; });
  const period = vi.fn(async (): Promise<CashierContextPeriodResult> => { work(); return { documentDate: "2026-08-31", status: "MISSING" }; });
  const reference = vi.fn(async () => { work(); return { status: "unavailable" as const }; });
  const options = vi.fn(async () => { work(); return { data: [], meta: { ...page, pageSize: 20 } }; });
  const services: AppServices = {
    auth,
    accounts: { listAccounts: list } as unknown as NonNullable<AppServices["accounts"]>,
    taxes: { list } as unknown as NonNullable<AppServices["taxes"]>,
    customers: { listCustomers: list } as unknown as NonNullable<AppServices["customers"]>,
    sellingProfiles: catalog as unknown as NonNullable<AppServices["sellingProfiles"]>,
    inventoryBarcodes: { resolveBarcode } as unknown as NonNullable<AppServices["inventoryBarcodes"]>,
    pos: { list, checkout } as unknown as NonNullable<AppServices["pos"]>,
    posRecovery: new PosRecoveryService({ find: lookup }),
    posContext: { period, reference, options } as unknown as NonNullable<AppServices["posContext"]>,
  };
  const app = createApp({ NODE_ENV: "test", PORT: 3165, WEB_ORIGIN: "http://127.0.0.1:4215",
    SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 }, services);
  const call = (path: string, method: "get" | "post" = "get") => request(app)[method]("/api/v1" + path)
    .set("Cookie", "sid=session-a").set("X-CSRF-Token", "csrf-a");
  return { app, call, first, second, state, auth, findSession, hasPermission, work, list, catalog, resolveBarcode,
    checkout, lookup, period, reference, options };
}

const readers = [
  { path: "/accounts?active=true&allowsPosting=true&accountClasses=REVENUE", permission: "accounts.view" },
  { path: "/tax-rates?activeOnly=true", permission: "sales_invoices.view" },
  { path: "/customers?active=true", permission: "customers.view" },
  { path: "/sales/catalog", permission: "sales_catalog.view" },
  { path: "/sales/catalog/items/16", permission: "sales_catalog.view" },
] as const;

describe("POS identity bound to real owner HTTP readers (fixture storage, no DB)", () => {
  it.each(readers)("preserves legacy response and one authorization for $path without either header", async ({ path, permission }) => {
    const f = fixture();
    const response = await f.call(path).expect(200);
    expect(response.body).not.toHaveProperty("posContext");
    expect(f.work).toHaveBeenCalledTimes(1);
    expect(f.hasPermission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: permission, companyId: 2n, userId: 1n }));
  });
  it.each(readers)("returns captured identity and reauthorizes $path", async ({ path }) => {
    const f = fixture();
    const response = await f.call(path).set(headers).expect(200);
    expect(response.body.posContext).toEqual(identity);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(f.hasPermission).toHaveBeenCalledTimes(2); expect(f.work).toHaveBeenCalledTimes(1);
  });
  it.each(readers)("does not read a different company from stale POS intent at $path", async ({ path }) => {
    const f = fixture(); f.first.selectedCompanyId = 22n; // same sid and same CSRF hash
    const response = await f.call(path).set(headers).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" });
    expect(f.work).not.toHaveBeenCalled();
  });
  it.each(readers)("does not deliver data when the same sid switches company during $path", async ({ path }) => {
    const f = fixture(); f.state.afterRead = () => { f.first.selectedCompanyId = 22n; };
    const response = await f.call(path).set(headers).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" });
    expect(response.body).not.toHaveProperty("data"); expect(response.body).not.toHaveProperty("posContext");
    expect(f.work).toHaveBeenCalledTimes(1);
  });
  it.each(readers)("never downgrades partial, duplicate, merged or noncanonical headers at $path", async ({ path }) => {
    const badPairs: Array<Record<string, string | string[]>> = [
      { "X-POS-Expected-User-Id": "1" }, { "X-POS-Expected-Company-Id": "2" },
      { ...headers, "X-POS-Expected-User-Id": ["1", "1"] },
      { ...headers, "X-POS-Expected-Company-Id": ["2", "2"] },
      { ...headers, "X-POS-Expected-Company-Id": "2, 2" },
      { ...headers, "X-POS-Expected-User-Id": "01" },
      { ...headers, "X-POS-Expected-Company-Id": "+2" },
      { ...headers, "X-POS-Expected-Company-Id": "0" },
      { ...headers, "X-POS-Expected-User-Id": "18446744073709551616" },
    ];
    for (const pair of badPairs) {
      const f = fixture();
      expect((await f.call(path).set(pair).expect(400)).body).toEqual({ status: 400, code: "POS_CONTEXT_REQUIRED" });
      expect(f.work).not.toHaveBeenCalled();
    }
  });
  it.each(["/accounts", "/tax-rates", "/sales/catalog"])("rejects new-login user at %s independently of company equality", async path => {
    const f = fixture();
    const response = await request(f.app).get("/api/v1" + path).set("Cookie", "sid=session-b").set(headers).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" }); expect(f.work).not.toHaveBeenCalled();
  });
  it("keeps barcode value/CSRF/owner contract and adds only identity metadata", async () => {
    const f = fixture();
    const legacy = await f.call("/inventory-barcodes/resolve", "post").send({ value: "04006381333931" }).expect(200);
    expect(legacy.body).toEqual(barcode);
    const response = await f.call("/inventory-barcodes/resolve", "post").set(headers).send({ value: "04006381333931" }).expect(200);
    expect(response.body).toEqual({ ...barcode, posContext: identity });
    expect(f.resolveBarcode).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 1n, companyId: 2n }), { value: "04006381333931" });
    await request(f.app).post("/api/v1/inventory-barcodes/resolve").set("Cookie", "sid=session-b")
      .set("X-CSRF-Token", "csrf-a").set(headers).send({ value: "04006381333931" }).expect(403);
    expect(f.resolveBarcode).toHaveBeenCalledTimes(2);
  });
  it("rejects barcode scope changes before and after resolve without revealing another barcode", async () => {
    const f = fixture(); f.state.afterRead = () => { f.first.selectedCompanyId = 22n; };
    const response = await f.call("/inventory-barcodes/resolve", "post").set(headers).send({ value: "04006381333931" }).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" });
    await f.call("/inventory-barcodes/resolve", "post").set(headers).send({ value: "04006381333931" }).expect(409);
    expect(f.resolveBarcode).toHaveBeenCalledTimes(1);
  });
});

describe("mounted cashier context and unchanged financial command boundary", () => {
  it("preserves view-only history identity without granting checkout or N2 references", async () => {
    const f = fixture(); f.state.denied.add("pos.checkout");
    await f.call("/pos/context/identity?purpose=history").set(headers).expect(200);
    await f.call("/pos/sales").set(headers).expect(200);
    await f.call("/pos/context/identity").set(headers).expect(403);
    await f.call("/pos/context/references/currencyId/13").set(headers).expect(403);
    expect(f.reference).not.toHaveBeenCalled(); expect(f.checkout).not.toHaveBeenCalled();
  });
  it.each(["/pos/context/identity", "/pos/context/period?documentDate=2026-08-31",
    "/pos/context/references/currencyId/999", "/pos/context/options/paymentMethodId?page=1&pageSize=20", "/pos/sales"])(
    "requires header pair and proves identity at %s", async path => {
      const f = fixture(); await f.call(path).expect(400); expect(f.work).not.toHaveBeenCalled();
      expect((await f.call(path).set(headers).expect(200)).body.posContext).toEqual(identity);
    });
  it("reads exact ID 999 without a list and checks POS and owner rights twice", async () => {
    const f = fixture(); await f.call("/pos/context/references/currencyId/999").set(headers).expect(200);
    expect(f.reference).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), "currencyId", 999n);
    expect(f.options).not.toHaveBeenCalled();
    expect(f.hasPermission.mock.calls.map(([entry]) => entry.code)).toEqual(["pos.checkout", "currencies.view", "pos.checkout", "currencies.view"]);
  });
  it.each(["%0A", "%0D", "%0D%0A", "%E2%80%A8", "%E2%80%A9", "%20", "%09"])("rejects encoded trailing whitespace in exact reference ID: %s", async suffix => {
    const f = fixture();
    const response = await f.call("/pos/context/references/currencyId/999" + suffix).set(headers).expect(400);
    expect(response.body).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(f.reference).not.toHaveBeenCalled(); expect(f.options).not.toHaveBeenCalled();
  });
  it("retains the unsigned64 maximum for exact reference IDs without accepting overflow", async () => {
    const f = fixture();
    await f.call("/pos/context/references/currencyId/18446744073709551615").set(headers).expect(200);
    expect(f.reference).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), "currencyId", 18446744073709551615n);
    await f.call("/pos/context/references/currencyId/18446744073709551616").set(headers).expect(400);
    expect(f.reference).toHaveBeenCalledTimes(1);
  });
  it("preserves the owner's real initial period version zero in the executable HTTP contract", async () => {
    const f = fixture();
    const resolved: CashierContextPeriodResult = { documentDate: "2026-08-31", status: "RESOLVED", period: {
      id: "81", name: "August", startDate: "2026-08-01", endDate: "2026-08-31", status: "OPEN", version: 0,
    } };
    f.period.mockResolvedValue(resolved);
    const response = await f.call("/pos/context/period?documentDate=2026-08-31").set(headers).expect(200);
    expect(response.body).toEqual({ ...resolved, posContext: identity });
    expect(openApiResponseBodySchemas.resolvePosContextPeriod[200].safeParse(response.body).success).toBe(true);
    expect(openApiResponseBodySchemas.resolvePosContextPeriod[200].safeParse({ ...response.body, period: { ...response.body.period, version: -1 } }).success).toBe(false);
    expect(f.period).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), "2026-08-31");
  });
  it.each(["pos.checkout", "cash_bank_accounts.view"])("requires %s before returning payment metadata", async permission => {
    const f = fixture(); f.state.denied.add(permission);
    await f.call("/pos/context/references/paymentMethodId/15").set(headers).expect(403); expect(f.reference).not.toHaveBeenCalled();
  });
  it.each(["page=10001", "pageSize=101", "page=0", "search=" + "x".repeat(101)])("bounds options before owner port: %s", async query => {
    const f = fixture(); await f.call("/pos/context/options/paymentMethodId?" + query).set(headers).expect(400);
    expect(f.options).not.toHaveBeenCalled();
  });
  it("maps owner strict-date rejection to a bounded validation error", async () => {
    const f = fixture(); f.period.mockRejectedValue(new CashierContextPeriodError());
    expect((await f.call("/pos/context/period?documentDate=2026-02-29").set(headers).expect(400)).body)
      .toEqual({ status: 400, code: "VALIDATION_ERROR" });
  });
  it("precondition rejection does not enter checkout or recovery for same sid in another company", async () => {
    const f = fixture(); f.first.selectedCompanyId = 22n;
    await f.call("/pos/checkouts", "post").set(headers).set("Idempotency-Key", key).send(payload).expect(409);
    await f.call("/pos/checkouts/recovery", "post").set(headers).send({ attemptKey: key }).expect(409);
    expect(f.checkout).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("new-login CSRF failure and matching-CSRF user mismatch are distinct before checkout", async () => {
    const f = fixture();
    await request(f.app).post("/api/v1/pos/checkouts").set("Cookie", "sid=session-b").set("X-CSRF-Token", "csrf-a")
      .set(headers).set("Idempotency-Key", key).send(payload).expect(403);
    const response = await request(f.app).post("/api/v1/pos/checkouts").set("Cookie", "sid=session-b").set("X-CSRF-Token", "csrf-b")
      .set(headers).set("Idempotency-Key", key).send(payload).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" }); expect(f.checkout).not.toHaveBeenCalled();
  });
  it("adds context only at HTTP preserving command, fingerprint, original invoice ID and cached result", async () => {
    const f = fixture(); const input = openApiRequestBodySchemas.completePosCheckout.parse(payload);
    expect(posCheckoutResultResponseComponentSchema.safeParse(sale).success).toBe(true);
    expect(openApiResponseBodySchemas.completePosCheckout[201].safeParse(sale).success).toBe(false);
    const fingerprint = canonicalCheckoutFingerprint(input);
    const response = await f.call("/pos/checkouts", "post").set(headers).set("Idempotency-Key", key).send(payload).expect(201);
    expect(response.body).toEqual({ ...sale, posContext: identity });
    expect(f.checkout).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 1n, companyId: 2n }), input, key);
    expect(canonicalCheckoutFingerprint(input)).toBe(fingerprint);
    const recovered = await f.call("/pos/checkouts/recovery", "post").set(headers).send({ attemptKey: key }).expect(200);
    expect(recovered.body).toEqual({ outcome: "CONFIRMED", result: sale, posContext: identity });
    expect(recovered.body.result.invoice.id).toBe("801");
    expect(sale).not.toHaveProperty("posContext"); expect(recovered.body.result).not.toHaveProperty("posContext");
  });
  it("company switch after work is not a definitive business rejection", async () => {
    const f = fixture(); f.state.afterRead = () => { f.first.selectedCompanyId = 22n; };
    const response = await f.call("/pos/checkouts", "post").set(headers).set("Idempotency-Key", key).send(payload).expect(409);
    expect(response.body).toEqual({ status: 409, code: "POS_CONTEXT_CHANGED" }); expect(f.checkout).toHaveBeenCalledTimes(1);
    f.state.afterRead = () => {}; f.first.selectedCompanyId = 2n;
    const recovered = await f.call("/pos/checkouts/recovery", "post").set(headers).send({ attemptKey: key }).expect(200);
    expect(recovered.body.result.invoice.id).toBe("801"); expect(f.checkout).toHaveBeenCalledTimes(1);
  });
  it("idempotency mismatch keeps its original conflict instead of becoming a scope conflict", async () => {
    const f = fixture(); f.checkout.mockRejectedValue(new PosError("IDEMPOTENCY_MISMATCH"));
    const response = await f.call("/pos/checkouts", "post").set(headers).set("Idempotency-Key", key).send(payload).expect(409);
    expect(response.body).toEqual({ status: 409, code: "BUSINESS_RULE_VIOLATION", reason: "IDEMPOTENCY_MISMATCH" });
  });
});
