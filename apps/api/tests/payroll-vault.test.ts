import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PayrollVault } from "../src/payroll/payroll-vault.js";

const keys = { old: Buffer.alloc(32, 1).toString("base64"), current: Buffer.alloc(32, 2).toString("base64") };
const scope = { companyId: 1n, kind: "AGREEMENT" as const, publicId: "fixture" };
const schema = z.object({ salary: z.string() }).strict();
describe("payroll secret storage", () => {
  it("uses randomized authenticated encryption bound to company, kind and record", () => {
    const vault = new PayrollVault("old", keys, "old");
    const envelope = vault.seal(scope, { salary: "7123.45" });
    expect(JSON.stringify(envelope)).not.toContain("7123.45");
    expect(vault.seal(scope, { salary: "7123.45" })).not.toEqual(envelope);
    expect(vault.open(scope, envelope, schema)).toEqual({ salary: "7123.45" });
    for (const changed of [{ ...scope, companyId: 2n }, { ...scope, kind: "RUN" as const }, { ...scope, publicId: "other" }]) {
      expect(() => vault.open(changed, envelope, schema)).toThrow("PAYROLL_PRIVATE_DATA_UNAVAILABLE");
    }
    expect(() => vault.open(scope, { ...envelope, tag: Buffer.alloc(16).toString("base64") }, schema)).toThrow("PAYROLL_PRIVATE_DATA_UNAVAILABLE");
  });
  it("retains old key reads and stable command fingerprints during active-key rotation", () => {
    const old = new PayrollVault("old", keys, "old"), rotated = new PayrollVault("current", keys, "old");
    expect(rotated.open(scope, old.seal(scope, { salary: "1" }), schema)).toEqual({ salary: "1" });
    expect(rotated.fingerprint("command")).toBe(old.fingerprint("command"));
    expect(rotated.seal(scope, {}).keyId).toBe("current");
  });
  it("fails closed without valid secrets or production policy review", () => {
    expect(PayrollVault.fromEnvironment({})).toBeNull();
    expect(() => PayrollVault.fromEnvironment({ PAYROLL_ENABLED: "true" })).toThrow("PAYROLL_CONFIGURATION_INVALID");
    expect(() => PayrollVault.fromEnvironment({ PAYROLL_ENABLED: "true", NODE_ENV: "production" })).toThrow("PAYROLL_POLICY_REVIEW_REQUIRED");
    expect(() => new PayrollVault("old", { old: "bad" }, "old")).toThrow();
  });
  it("recovers old envelopes only after restoring the exact external key", () => {
    const original = new PayrollVault("old", keys, "current");
    const backup = JSON.parse(JSON.stringify(original.seal(scope, { salary: "8123.45" })));
    const missing = new PayrollVault("current", { current: keys.current }, "current");
    expect(() => missing.open(scope, backup, schema)).toThrow("PAYROLL_PRIVATE_DATA_UNAVAILABLE");
    const replaced = new PayrollVault("current", { ...keys, old: Buffer.alloc(32, 9).toString("base64") }, "current");
    expect(() => replaced.open(scope, backup, schema)).toThrow("PAYROLL_PRIVATE_DATA_UNAVAILABLE");
    const restored = PayrollVault.fromEnvironment({ NODE_ENV: "test", PAYROLL_ENABLED: "true",
      PAYROLL_KEY_RING: JSON.stringify(keys), PAYROLL_ACTIVE_KEY_ID: "current", PAYROLL_FINGERPRINT_KEY_ID: "current" })!;
    expect(restored.open(scope, backup, schema)).toEqual({ salary: "8123.45" });
    expect(restored.fingerprint("pending-command")).toBe(original.fingerprint("pending-command"));
    expect(backup.keyId).toBe("old");
  });
  it("preserves approval hashes across JSON database property ordering", () => {
    const vault = new PayrollVault("old", keys, "current");
    const envelope = vault.seal(scope, { salary: "1" });
    const reordered = { ciphertext: envelope.ciphertext, tag: envelope.tag, nonce: envelope.nonce, keyId: envelope.keyId };
    expect(vault.snapshotHash(reordered)).toBe(vault.snapshotHash(envelope));
    expect(vault.snapshotHash({ ...envelope, ciphertext: "AAAA" })).not.toBe(vault.snapshotHash(envelope));
  });
});
