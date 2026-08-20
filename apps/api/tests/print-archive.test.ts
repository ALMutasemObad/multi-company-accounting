import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { snapshotHash, snapshotHashMatches } from "../src/printing/print-archive.js";
import type { PrintSnapshot } from "../src/printing/print-types.js";
import { printSnapshotFixture } from "./fixtures/print-snapshot.js";

const reverseObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
  }
  return value;
};

describe("print archive integrity hashing", () => {
  it("is stable when a MySQL JSON column reorders object keys", () => {
    const reordered = reverseObjectKeys(printSnapshotFixture) as PrintSnapshot;
    expect(snapshotHash(reordered)).toBe(snapshotHash(printSnapshotFixture));
  });

  it("continues to verify legacy insertion-order hashes", () => {
    const legacy = createHash("sha256").update(JSON.stringify(printSnapshotFixture)).digest("hex");
    expect(snapshotHashMatches(printSnapshotFixture, legacy)).toBe(true);
    expect(snapshotHashMatches(printSnapshotFixture, "0".repeat(64))).toBe(false);
  });
});
