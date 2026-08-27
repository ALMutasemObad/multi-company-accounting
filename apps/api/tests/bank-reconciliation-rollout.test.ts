import { describe, expect, it } from "vitest";
import { BankReconciliationRolloutPolicy } from "../src/treasury/reconciliation/reconciliation-rollout.js";

describe("bank reconciliation rollout policy", () => {
  it("keeps companies outside the allowlist disabled", () => {
    const policy = new BankReconciliationRolloutPolicy(true, "7", "CLOSE");
    expect(policy.capability(8n)).toEqual({ enabled: false, stage: "OFF" });
    expect(() => policy.require(8n, "SHADOW")).toThrowError("FEATURE_NOT_AVAILABLE");
  });

  it("enforces shadow, review and close stages independently", () => {
    const shadow = new BankReconciliationRolloutPolicy(true, "7", "SHADOW");
    expect(shadow.capability(7n)).toEqual({ enabled: true, stage: "SHADOW" });
    expect(() => shadow.require(7n, "SHADOW")).not.toThrow();
    expect(() => shadow.require(7n, "REVIEW")).toThrowError("FEATURE_NOT_AVAILABLE");

    const close = new BankReconciliationRolloutPolicy(true, "7", "CLOSE");
    expect(() => close.require(7n, "CLOSE")).not.toThrow();
  });

  it("allows wildcard rollout only when configuration has already permitted it", () => {
    const policy = new BankReconciliationRolloutPolicy(true, "*", "REVIEW");
    expect(policy.capability(999n)).toEqual({ enabled: true, stage: "REVIEW" });
  });
});
