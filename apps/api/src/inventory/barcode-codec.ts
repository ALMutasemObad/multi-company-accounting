export const inventoryBarcodeSymbologies = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "CODE_128",
  "QR",
] as const;

export type InventoryBarcodeSymbology =
  (typeof inventoryBarcodeSymbologies)[number];

export type BarcodeCodecErrorReason =
  | "INVALID_BARCODE_VALUE"
  | "INVALID_BARCODE_CHECK_DIGIT"
  | "UNSUPPORTED_BARCODE_SYMBOLOGY"
  | "GS1_NOT_SUPPORTED";

export class BarcodeCodecError extends Error {
  constructor(public readonly reason: BarcodeCodecErrorReason) {
    super(reason);
  }
}

export type EncodedBarcode = {
  symbology: InventoryBarcodeSymbology;
  value: string;
  normalizedValue: string;
};

const GTIN_LENGTHS = new Set([8, 12, 13]);
const MAX_BARCODE_CHARACTERS = 255;
const ASCII_PRINTABLE = /^[\u0020-\u007e]+$/u;
const CONTAINS_DISALLOWED_UNICODE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const GS1_AIM_PREFIX = /^\](?:C1|d2|Q3)/u;

function characterLength(value: string) {
  return Array.from(value).length;
}

function assertCommonValue(value: string) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || characterLength(value) > MAX_BARCODE_CHARACTERS
  ) {
    throw new BarcodeCodecError("INVALID_BARCODE_VALUE");
  }
  if (value.includes("\u001d") || GS1_AIM_PREFIX.test(value)) {
    throw new BarcodeCodecError("GS1_NOT_SUPPORTED");
  }
}

function hasValidGtinCheckDigit(value: string) {
  if (!/^\d+$/u.test(value) || !GTIN_LENGTHS.has(value.length)) return false;
  const suppliedCheckDigit = Number(value.at(-1));
  let sum = 0;
  let weight = 3;
  for (let index = value.length - 2; index >= 0; index -= 1) {
    sum += Number(value[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === suppliedCheckDigit;
}

function encodeGtin(value: string, expectedLength: number) {
  if (!new RegExp(`^\\d{${expectedLength}}$`, "u").test(value)) {
    throw new BarcodeCodecError("INVALID_BARCODE_VALUE");
  }
  if (!hasValidGtinCheckDigit(value)) {
    throw new BarcodeCodecError("INVALID_BARCODE_CHECK_DIGIT");
  }
  return value.padStart(14, "0");
}

function normalizeGeneralValue(value: string, code128Only: boolean) {
  assertCommonValue(value);
  const normalized = value.normalize("NFC");
  if (
    characterLength(normalized) > MAX_BARCODE_CHARACTERS
    || (code128Only
      ? !ASCII_PRINTABLE.test(normalized)
      : CONTAINS_DISALLOWED_UNICODE.test(normalized))
  ) {
    throw new BarcodeCodecError("INVALID_BARCODE_VALUE");
  }
  return hasValidGtinCheckDigit(normalized)
    ? normalized.padStart(14, "0")
    : normalized;
}

export function encodeBarcode(
  symbology: InventoryBarcodeSymbology,
  value: string,
): EncodedBarcode {
  assertCommonValue(value);
  let normalizedValue: string;
  switch (symbology) {
    case "EAN_13":
      normalizedValue = encodeGtin(value, 13);
      break;
    case "EAN_8":
      normalizedValue = encodeGtin(value, 8);
      break;
    case "UPC_A":
      normalizedValue = encodeGtin(value, 12);
      break;
    case "CODE_128":
      normalizedValue = normalizeGeneralValue(value, true);
      break;
    case "QR":
      normalizedValue = normalizeGeneralValue(value, false);
      break;
    default:
      throw new BarcodeCodecError("UNSUPPORTED_BARCODE_SYMBOLOGY");
  }
  return { symbology, value, normalizedValue };
}

export function normalizeBarcodeLookup(
  value: string,
  symbology?: InventoryBarcodeSymbology,
) {
  if (symbology !== undefined) return encodeBarcode(symbology, value).normalizedValue;
  return normalizeGeneralValue(value, false);
}
