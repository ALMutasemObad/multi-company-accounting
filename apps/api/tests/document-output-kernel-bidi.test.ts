import { describe, expect, it } from "vitest";
import { prepareBidiText } from "../src/document-output-kernel/bidi.js";

describe("document output bidi", () => {
  it("normalizes Arabic mixed content while preserving LTR content", () => {
    expect(prepareBidiText("نسبة 15%: اختبار")).toContain("٥١بالمائة، اختبار");
    expect(prepareBidiText("Account 1200-AB", "LTR")).toBe("Account 1200-AB");
  });
});
