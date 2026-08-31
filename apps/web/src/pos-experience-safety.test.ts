import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { createPosAttemptStore, isConfirmedPosResult, isPosOutcomeUnknown, POS_SAFE_RETRY_WINDOW_MS } from "./pos-experience-checkout";
import type { PosCheckoutResult } from "./types";
import { decrementPosQuantity, posDecimal, posLineSubtotal, posMoneyText, posSubtotal } from "./pos-experience-money";
import { posPreferenceKey } from "./pos-experience-preferences";

describe("R1 exact decimal presentation", () => {
  it("preserves high precision, rounds half up, and rejects invalid input", () => {
    expect(posDecimal("900719925474099.1234", 4)).toBe("900719925474099.1234");
    expect(posDecimal("1.12345", 4)).toBeNull();
    expect(posDecimal("1e2", 4)).toBeNull();
    expect(posDecimal("", 4)).toBeNull();
    expect(posLineSubtotal({ quantity: "0.000001", unitPrice: "50.0000", discountAmount: "0" })).toBe("0.0001");
    expect(posSubtotal([{ quantity: "3", unitPrice: "0.1", discountAmount: "0" }])).toBe("0.3000");
    expect(posMoneyText("900719925474099.1234")).toBe("900,719,925,474,099.1234");
    expect(posSubtotal([{ quantity: "1", unitPrice: "1", discountAmount: "2" }])).toBeNull();
    expect(decrementPosQuantity("1.000001")).toBe("0.000001");
    expect(decrementPosQuantity("1")).toBeNull();
  });
});

describe("R1 checkout recovery and isolation", () => {
  it("locks synchronous double submit and preserves key/body on explicit retry", () => {
    const store = createPosAttemptStore<{ quantity: string }>();
    const attempt = store.begin("user1/company1", "exact body", { quantity: "2" }, () => "key1");
    expect(store.begin("user1/company1", "changed", { quantity: "3" }, () => "key2")).toBeNull();
    expect(store.retry("user1/company1")).toBeNull();
    store.unknown("user1/company1");
    expect(store.retry("user1/company1")).toMatchObject({ key: attempt?.key, body: attempt?.body, everUnknown: true });
    expect(attempt?.body).toBe("exact body");
    expect(attempt?.key).toBe("key1");
    expect(store.get("user2/company1")).toBeUndefined();
    expect(store.get("user1/company2")).toBeUndefined();
    store.clear("user1/company1");
    expect(store.begin("user1/company1", "next", { quantity: "1" }, () => "next-key")?.key).toBe("next-key");
  });
  it("does not treat lost/5xx responses as rejected business operations", () => {
    expect(isPosOutcomeUnknown(new TypeError("network"))).toBe(true);
    expect(isPosOutcomeUnknown(new ApiError("timeout", 504))).toBe(true);
    expect(isPosOutcomeUnknown(new ApiError("pending", 409, "IDEMPOTENCY_IN_PROGRESS"))).toBe(true);
    expect(isPosOutcomeUnknown(new ApiError("stock", 422, "INSUFFICIENT_STOCK"))).toBe(false);
  });
  it("never accepts a malformed, partial or unposted success response", () => {
    expect(isConfirmedPosResult({} as PosCheckoutResult)).toBe(false);
    const response = { id: "1", completedAt: "2026-08-31", invoice: { id: "1", documentNumber: "SI-1", status: "POSTED", total: "0.0000" }, receipt: { id: "2", documentNumber: "R-1", status: "POSTED" } } as PosCheckoutResult;
    expect(isConfirmedPosResult(response)).toBe(true);
    expect(isConfirmedPosResult({ ...response, receipt: undefined } as unknown as PosCheckoutResult)).toBe(false);
    expect(isConfirmedPosResult({ ...response, invoice: { ...response.invoice, total: "2e1" } })).toBe(false);
  });
  it("keeps completion locked until an explicit new sale and notifies remounted consumers", () => {
    const store = createPosAttemptStore<null>();
    let changes = 0; const unsubscribe = store.subscribe(() => { changes += 1; });
    store.begin("scope", "body", null, () => "key");
    store.complete("scope", {} as PosCheckoutResult);
    expect(store.get("scope")?.status).toBe("completed");
    expect(store.retry("scope")).toBeNull();
    expect(store.begin("scope", "other", null, () => "other")).toBeNull();
    expect(changes).toBe(2); unsubscribe(); store.clear("scope"); expect(changes).toBe(2);
  });
  it("refuses retries at or after the conservative client window and keeps the attempt locked", () => {
    for (const afterBoundary of [0, 1]) {
      let clock = 1000;
      const store = createPosAttemptStore<null>(() => clock);
      store.begin("scope", "body", null, () => "key"); store.unknown("scope");
      clock += POS_SAFE_RETRY_WINDOW_MS + afterBoundary;
      expect(store.retry("scope")).toBeNull();
      expect(store.get("scope")).toMatchObject({ key: "key", body: "body", status: "unknown" });
      expect(store.begin("scope", "new body", null, () => "new key")).toBeNull();
      clock = 2000; expect(store.retry("scope")).toBeNull();
    }
  });
  it("does not extend creation or deadline on retry and fails closed on clock rollback/invalid time", () => {
    let clock = 1000;
    const store = createPosAttemptStore<null>(() => clock);
    const original = store.begin("scope", "body", null, () => "key")!;
    clock = 2000; store.unknown("scope");
    clock = 3000;
    const retry = store.retry("scope")!;
    expect(retry.createdAt).toBe(original.createdAt); expect(retry.retryExpiresAt).toBe(original.retryExpiresAt);
    store.unknown("scope"); clock = 2500;
    expect(store.retry("scope")).toBeNull();
    clock = 4000; expect(store.retry("scope")).toBeNull();
    expect(store.get("scope")?.retryClockInvalid).toBe(true);
    store.begin("other", "body", null, () => "other"); store.unknown("other");
    clock = Number.NaN; expect(store.retry("other")).toBeNull();
    expect(store.begin("new", "body", null, () => "new")).toBeNull();
  });
  it("scopes display preferences to both user and company without ambiguous separators", () => {
    expect(posPreferenceKey("1", "2")).not.toBe(posPreferenceKey("2", "1"));
    expect(posPreferenceKey("a/b", "c")).not.toBe(posPreferenceKey("a", "b/c"));
  });
});
