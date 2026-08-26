import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BankStatementParseError } from "./bank-statement-error.js";
import type {
  BankStatementDateFormat,
  BankStatementDirection,
  NormalizedBankStatementLine,
} from "./bank-statement-types.js";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CURRENCY = /^[A-Z]{3}$/u;

export const sha256Hex = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

export function decodeBankStatement(input: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    if (text.includes("\u0000")) throw new BankStatementParseError("INVALID_UTF8");
    return text;
  } catch (error) {
    if (error instanceof BankStatementParseError) throw error;
    throw new BankStatementParseError("INVALID_UTF8");
  }
}

export function normalizeCurrency(value: string, sourceRowNumber?: number): string {
  const currency = value.trim().toUpperCase();
  if (!CURRENCY.test(currency)) {
    throw new BankStatementParseError("INVALID_CURRENCY", sourceRowNumber);
  }
  return currency;
}

export function normalizeDate(
  value: string,
  format: BankStatementDateFormat,
  sourceRowNumber?: number,
): string {
  const trimmed = value.trim();
  const match = format === "YYYY-MM-DD"
    ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed)
    : /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(trimmed);
  if (!match) throw new BankStatementParseError("INVALID_DATE", sourceRowNumber);

  const [year, month, day] = format === "YYYY-MM-DD"
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : format === "DD/MM/YYYY"
      ? [Number(match[3]), Number(match[2]), Number(match[1])]
      : [Number(match[3]), Number(match[1]), Number(match[2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new BankStatementParseError("INVALID_DATE", sourceRowNumber);
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function normalizeIsoDate(value: string, sourceRowNumber?: number): string {
  return normalizeDate(value.trim().slice(0, 10), "YYYY-MM-DD", sourceRowNumber);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function normalizeMoney(
  value: string,
  options: {
    decimalSeparator: "." | ",";
    thousandsSeparator?: "," | "." | " ";
    allowNegative: boolean;
    sourceRowNumber?: number;
  },
): Prisma.Decimal {
  let raw = value.trim();
  let negativeByParentheses = false;
  if (raw.startsWith("(") && raw.endsWith(")")) {
    negativeByParentheses = true;
    raw = raw.slice(1, -1).trim();
  }
  const hasExplicitSign = raw.startsWith("-") || raw.startsWith("+");
  let negativeBySign = false;
  if (hasExplicitSign) {
    negativeBySign = raw[0] === "-";
    raw = raw.slice(1);
  }
  if (!raw || negativeByParentheses && hasExplicitSign) {
    throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
  }
  if (options.thousandsSeparator === options.decimalSeparator) {
    throw new BankStatementParseError("INVALID_PROFILE");
  }

  const decimalParts = raw.split(options.decimalSeparator);
  if (decimalParts.length > 2) {
    throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
  }
  const integerPart = decimalParts[0] ?? "";
  const fractionPart = decimalParts[1];
  if (fractionPart !== undefined && (!/^\d{1,4}$/u.test(fractionPart))) {
    throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
  }

  if (options.thousandsSeparator && integerPart.includes(options.thousandsSeparator)) {
    const separator = escapeRegExp(options.thousandsSeparator);
    if (!new RegExp(`^\\d{1,3}(?:${separator}\\d{3})+$`, "u").test(integerPart)) {
      throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
    }
  } else if (!/^\d+$/u.test(integerPart)) {
    throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
  }

  const digits = options.thousandsSeparator
    ? integerPart.replaceAll(options.thousandsSeparator, "")
    : integerPart;
  const canonical = `${negativeByParentheses || negativeBySign ? "-" : ""}${digits}${fractionPart === undefined ? "" : `.${fractionPart}`}`;
  const decimal = new Prisma.Decimal(canonical);
  if (!options.allowNegative && decimal.isNegative()) {
    throw new BankStatementParseError("INVALID_AMOUNT", options.sourceRowNumber);
  }
  return decimal;
}

export function normalizeText(
  value: string | undefined,
  limit: number,
  sourceRowNumber?: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.normalize("NFC").trim();
  if (!normalized) return undefined;
  if (normalized.length > limit || CONTROL_CHARACTERS.test(normalized)) {
    throw new BankStatementParseError("INVALID_TEXT", sourceRowNumber);
  }
  return normalized;
}

export function amountAndDirection(
  amount: Prisma.Decimal,
  sourceRowNumber?: number,
): { amount: string; direction: BankStatementDirection } {
  if (amount.isZero()) throw new BankStatementParseError("INVALID_AMOUNT", sourceRowNumber);
  return {
    amount: amount.toFixed(4),
    direction: amount.isNegative() ? "DEBIT" : "CREDIT",
  };
}

export function fingerprintLine(
  line: Omit<NormalizedBankStatementLine, "fingerprintSha256" | "sourceRowNumber" | "direction">,
  accountIdentifier?: string,
): string {
  return sha256Hex(JSON.stringify([
    accountIdentifier ?? "",
    line.currency,
    line.bookingDate,
    line.valueDate ?? "",
    line.amount,
    line.externalId ?? "",
    line.reference ?? "",
    line.description ?? "",
  ]));
}

export function sumAmounts(lines: readonly NormalizedBankStatementLine[]): string {
  return lines
    .reduce((total, line) => total.plus(line.amount), new Prisma.Decimal(0))
    .toFixed(4);
}
