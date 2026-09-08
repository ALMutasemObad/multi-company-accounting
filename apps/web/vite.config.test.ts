import { describe, expect, it } from "vitest";
import { uncompressedUtf8Bytes } from "./vite.config";

describe("locale chunk size gate", () => {
  it("measures emitted chunks as UTF-8 bytes rather than JavaScript code units", () => {
    const source = "العربية हिन्दी";

    expect(uncompressedUtf8Bytes(source)).toBe(Buffer.byteLength(source, "utf8"));
    expect(uncompressedUtf8Bytes(source)).toBeGreaterThan(source.length);
    expect(uncompressedUtf8Bytes("a".repeat(500 * 1024 + 1))).toBeGreaterThan(500 * 1024);
  });
});
