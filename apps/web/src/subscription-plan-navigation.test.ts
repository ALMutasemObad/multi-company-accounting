import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSubscriptionPlanPreference, preferredSubscriptionPlan, rememberSubscriptionPlan,
  subscriptionPlanForRoute, subscriptionPlanHash, subscriptionPlanHref, subscriptionRouteBase,
} from "./public-plans";

describe("canonical subscription navigation carries a preference, never an instruction", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["login", "register", "subscription"] as const)("round-trips an exact BIGINT through %s", destination => {
    const id = "9007199254740993";
    const href = subscriptionPlanHref(destination, id);
    expect(href).toBe(`/#${destination}?plan=${id}`);
    const hash = href.slice(1);
    expect(subscriptionRouteBase(hash)).toBe(`#${destination}`);
    expect(subscriptionPlanForRoute(hash)).toBe(id);
    captureSubscriptionPlanPreference(hash);
    expect(preferredSubscriptionPlan()).toBe(id);
  });

  it("preserves the URL selection through login/register/review when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); },
    });
    let hash = "#login?plan=102";
    for (const destination of ["register", "login", "subscription"] as const) {
      captureSubscriptionPlanPreference(hash);
      hash = `#${subscriptionPlanHash(destination, subscriptionPlanForRoute(hash))}`;
      expect(hash).toBe(`#${destination}?plan=102`);
    }
    expect(subscriptionPlanForRoute(hash)).toBe("102");
  });

  it.each(["plan=0", "plan=", "plan=1&plan=2", "plan=1&plan=1", "plan=%201", "plan=1%26activate%3Dtrue", "plan=1?plan=2"])(
    "does not replace invalid explicit %s with an older stored choice", query => {
      rememberSubscriptionPlan("88");
      const hash = `#login?${query}`;
      expect(subscriptionPlanForRoute(hash)).toBeNull();
      captureSubscriptionPlanPreference(hash);
      expect(preferredSubscriptionPlan()).toBeNull();
      expect(subscriptionPlanHash("register", subscriptionPlanForRoute(hash))).toBe("register");
    },
  );

  it.each(["#pos?plan=102", "#register-other?plan=102", "#reset-password?plan=102", "#home?plan=102"])(
    "does not capture a plan from unrelated route %s", hash => {
      captureSubscriptionPlanPreference(hash);
      expect(preferredSubscriptionPlan()).toBeNull();
    },
  );

  it("carries only the plan across routes, never token/redirect/activation flags", () => {
    const hash = "#register?plan=102&token=private&redirect=https://invalid.example&activate=true";
    expect(subscriptionPlanHref("login", subscriptionPlanForRoute(hash))).toBe("/#login?plan=102");
    captureSubscriptionPlanPreference(hash);
    expect([...values.values()].join()).not.toMatch(/token|private|redirect|activate/);
  });

  it("uses a stored preference only when the route has no explicit plan", () => {
    rememberSubscriptionPlan("77");
    expect(subscriptionPlanForRoute("#login")).toBe("77");
    expect(subscriptionPlanForRoute("#login?plan=102")).toBe("102");
    expect(subscriptionPlanHref("subscription", "javascript:alert(1)")).toBe("/#subscription");
  });
});
