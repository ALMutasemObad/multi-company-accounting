import { describe, expect, it } from "vitest";
import { allows } from "./authorization";
import { ledgerAccountReferenceLabel, treasuryPermissionPolicies } from "./treasury-permission-policies";

describe("treasury permission boundaries", () => {
  it("keeps read and manage permissions independent", () => {
    const viewOnly = new Set(["cash_bank_accounts.view"]);
    const manager = new Set(["cash_bank_accounts.view", "cash_bank_accounts.manage"]);

    expect(allows(viewOnly, treasuryPermissionPolicies.view)).toBe(true);
    expect(allows(viewOnly, treasuryPermissionPolicies.manage)).toBe(false);
    expect(allows(manager, treasuryPermissionPolicies.manage)).toBe(true);
  });

  it("never falls back to an internal ledger account id", () => {
    expect(ledgerAccountReferenceLabel(null)).toBe("—");
    expect(ledgerAccountReferenceLabel(undefined)).toBe("—");
    expect(ledgerAccountReferenceLabel({ code: "111000", name: "Cash" })).toBe("111000 — Cash");
  });
});
