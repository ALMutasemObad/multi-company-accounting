import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { createPosAttemptStore, isPosOutcomeUnknown } from "./pos-experience-checkout";
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
  it("scopes display preferences to both user and company without ambiguous separators", () => {
    expect(posPreferenceKey("1", "2")).not.toBe(posPreferenceKey("2", "1"));
    expect(posPreferenceKey("a/b", "c")).not.toBe(posPreferenceKey("a", "b/c"));
  });
});
