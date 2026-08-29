import { describe, expect, it } from "vitest";
import {
  BarcodeCodecError,
  encodeBarcode,
  normalizeBarcodeLookup,
} from "../src/inventory/barcode-codec.js";

describe("inventory barcode codec", () => {
  it.each([
    ["EAN_13", "4006381333931", "04006381333931"],
    ["EAN_8", "96385074", "00000096385074"],
    ["UPC_A", "036000291452", "00036000291452"],
  ] as const)("validates %s and canonicalizes it to GTIN-14", (symbology, value, normalizedValue) => {
    expect(encodeBarcode(symbology, value)).toEqual({ symbology, value, normalizedValue });
  });

  it("preserves leading zeros in the managed value", () => {
    expect(encodeBarcode("EAN_13", "0012345678905")).toEqual({
      symbology: "EAN_13",
      value: "0012345678905",
      normalizedValue: "00012345678905",
    });
  });

  it("canonicalizes equivalent UPC, EAN and scanner payloads to one identity", () => {
    const normalized = "00036000291452";
    expect(encodeBarcode("UPC_A", "036000291452").normalizedValue).toBe(normalized);
    expect(encodeBarcode("EAN_13", "0036000291452").normalizedValue).toBe(normalized);
    expect(encodeBarcode("CODE_128", "036000291452").normalizedValue).toBe(normalized);
    expect(normalizeBarcodeLookup("036000291452")).toBe(normalized);
  });

  it("rejects an invalid declared GTIN check digit without coercing to Number", () => {
    expect(() => encodeBarcode("EAN_13", "4006381333932"))
      .toThrowError(expect.objectContaining<Partial<BarcodeCodecError>>({
        reason: "INVALID_BARCODE_CHECK_DIGIT",
      }));
    expect(() => encodeBarcode("EAN_8", "96385075"))
      .toThrowError(expect.objectContaining<Partial<BarcodeCodecError>>({
        reason: "INVALID_BARCODE_CHECK_DIGIT",
      }));
  });

  it("keeps non-GTIN identities case-sensitive and NFC-normalized", () => {
    expect(encodeBarcode("CODE_128", "ABC-001").normalizedValue).toBe("ABC-001");
    expect(encodeBarcode("CODE_128", "abc-001").normalizedValue).toBe("abc-001");
    expect(encodeBarcode("QR", "Cafe\u0301")).toEqual({
      symbology: "QR",
      value: "Cafe\u0301",
      normalizedValue: "Café",
    });
  });

  it.each([
    ["CODE_128", " value", "INVALID_BARCODE_VALUE"],
    ["QR", "value ", "INVALID_BARCODE_VALUE"],
    ["CODE_128", "س-١", "INVALID_BARCODE_VALUE"],
    ["QR", "line\nfeed", "INVALID_BARCODE_VALUE"],
    ["QR", "lone-\ud800-surrogate", "INVALID_BARCODE_VALUE"],
    ["QR", "line\u2028separator", "INVALID_BARCODE_VALUE"],
    ["QR", "paragraph\u2029separator", "INVALID_BARCODE_VALUE"],
    ["CODE_128", "]C10109501101530003", "GS1_NOT_SUPPORTED"],
    ["QR", "0109501101530003\u001d17270101", "GS1_NOT_SUPPORTED"],
  ] as const)("rejects unsafe or unsupported %s input", (symbology, value, reason) => {
    expect(() => encodeBarcode(symbology, value))
      .toThrowError(expect.objectContaining<Partial<BarcodeCodecError>>({ reason }));
  });

  it("rejects a runtime symbology outside the B1 allow-list", () => {
    expect(() => encodeBarcode("GS1_128" as "CODE_128", "ABC"))
      .toThrowError(expect.objectContaining<Partial<BarcodeCodecError>>({
        reason: "UNSUPPORTED_BARCODE_SYMBOLOGY",
      }));
  });

  it("lets an untyped scanner value match a non-GTIN Code 128 value", () => {
    expect(normalizeBarcodeLookup("4006381333932")).toBe("4006381333932");
  });
});
