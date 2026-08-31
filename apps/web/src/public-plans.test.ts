import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSubscriptionPlanPreference, clearSubscriptionPlanPreference, isPublicPlansLocation, preferredSubscriptionPlan, registrationPlanHref, rememberSubscriptionPlan } from "./public-plans";

describe("public plan navigation and untrusted selection preference", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("recognizes an independent public route and its hash alias", () => {
    expect(isPublicPlansLocation("/plans", "")).toBe(true);
    expect(isPublicPlansLocation("/plans/", "#plans-faq")).toBe(true);
    expect(isPublicPlansLocation("/", "#plans")).toBe(true);
    expect(isPublicPlansLocation("/", "#plans-faq")).toBe(true);
    expect(isPublicPlansLocation("/", "#platformSubscriptions")).toBe(false);
    expect(isPublicPlansLocation("/plans-private", "")).toBe(false);
  });
  it("preserves a version identifier exactly and expires the preference after 24 hours", () => {
    rememberSubscriptionPlan("9007199254740993");
    expect(preferredSubscriptionPlan()).toBe("9007199254740993");
    vi.advanceTimersByTime(86_400_001);
    expect(preferredSubscriptionPlan()).toBeNull();
  });
  it("captures a registration choice, not payment or entitlements, and clears it explicitly", () => {
    captureSubscriptionPlanPreference("#register?plan=123&activate=true");
    expect(preferredSubscriptionPlan()).toBe("123");
    expect(registrationPlanHref("123")).toBe("/#register?plan=123");
    expect([...values.values()][0]).not.toMatch(/activate|payment|entitlement/);
    clearSubscriptionPlanPreference();
    expect(preferredSubscriptionPlan()).toBeNull();
  });
  it.each(["0", "-1", "1.2", "javascript:alert(1)", "1&activate=true", "1".repeat(21)])("ignores an invalid identifier %s", (id) => {
    rememberSubscriptionPlan(id);
    expect(preferredSubscriptionPlan()).toBeNull();
    expect(registrationPlanHref(id)).toBe("/#register");
  });
  it("handles disabled or malformed storage without blocking registration", () => {
    values.set("mcap.subscription-plan-intent", "{malformed");
    expect(preferredSubscriptionPlan()).toBeNull();
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } });
    expect(() => rememberSubscriptionPlan("1")).not.toThrow();
    expect(() => clearSubscriptionPlanPreference()).not.toThrow();
    expect(preferredSubscriptionPlan()).toBeNull();
  });
});
