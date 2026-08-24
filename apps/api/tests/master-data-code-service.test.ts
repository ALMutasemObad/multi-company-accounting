import { describe, expect, it } from "vitest";
import { formatMasterDataCode } from "../src/platform/master-data-code-service.js";

describe("master-data code formatting", () => {
  it("formats stable padded reference codes", () => {
    expect(formatMasterDataCode("CUS-", 1n, 6)).toBe("CUS-000001");
    expect(formatMasterDataCode("SUP-", 42n, 6)).toBe("SUP-000042");
    expect(formatMasterDataCode("CC-", 7n, 6)).toBe("CC-000007");
    expect(formatMasterDataCode("CB-", 8n, 6)).toBe("CB-000008");
    expect(formatMasterDataCode("WH-", 12n, 6)).toBe("WH-000012");
    expect(formatMasterDataCode("ITM-", 13n, 6)).toBe("ITM-000013");
    expect(formatMasterDataCode("PM-42-", 9n, 6)).toBe("PM-42-000009");
    expect(formatMasterDataCode("TAX-", 10n, 6)).toBe("TAX-000010");
    expect(formatMasterDataCode("ROL-", 11n, 6)).toBe("ROL-000011");
    expect(formatMasterDataCode("CUS-", 1_000_000n, 6)).toBe("CUS-1000000");
  });

  it("rejects invalid sequence values and codes beyond the storage limit", () => {
    expect(() => formatMasterDataCode("CUS-", 0n, 6)).toThrow(RangeError);
    expect(() => formatMasterDataCode("CUS-", 1n, 0)).toThrow(RangeError);
    expect(() => formatMasterDataCode("X".repeat(40), 1n, 6)).toThrow(
      RangeError,
    );
  });
});
