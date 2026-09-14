import { describe, expect, it } from "vitest";
import { prepareBidiText } from "../src/document-output-kernel/bidi.js";

describe("document output bidi", () => {
  it("preserves Arabic mixed content and LTR content exactly", () => {
    expect(prepareBidiText("نسبة 15%: اختبار")).toBe("نسبة 15%: اختبار");
    expect(prepareBidiText("SI-2026-15: نسبة 15%")).toBe("SI-2026-15: نسبة 15%");
    expect(prepareBidiText("1,234.5000 SAR — فاتورة SI-15")).toBe("1,234.5000 SAR — فاتورة SI-15");
    expect(prepareBidiText("Account 1200-AB", "LTR")).toBe("Account 1200-AB");
  });
});
