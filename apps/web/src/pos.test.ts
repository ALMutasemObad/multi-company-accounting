import { describe, expect, it } from "vitest";
import { normalizePosRate } from "./PosPage";

describe("واجهة نقاط البيع", () => {
  it("ترسل سعر الصرف بدقة العقد ذات الثماني منازل", () => {
    expect(normalizePosRate("1")).toBe("1.00000000");
    expect(normalizePosRate("3.75")).toBe("3.75000000");
    expect(normalizePosRate("0.12345678")).toBe("0.12345678");
  });

  it("لا تخفي مدخلًا غير صالح بتقريب صامت", () => {
    expect(normalizePosRate("1.123456789")).toBe("1.123456789");
    expect(normalizePosRate("rate")).toBe("rate");
  });
});
