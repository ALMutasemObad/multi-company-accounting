import { Prisma } from "@prisma/client";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { BankStatementParseError } from "../bank-statement-error.js";
import {
  amountAndDirection,
  fingerprintLine,
  normalizeCurrency,
  normalizeIsoDate,
  normalizeMoney,
  normalizeText,
  sumAmounts,
} from "../bank-statement-normalization.js";
import {
  MAX_BANK_STATEMENT_ENTRIES,
  type Camt053BankStatementParseRequest,
  type NormalizedBankStatement,
  type NormalizedBankStatementLine,
} from "../bank-statement-types.js";

type XmlRecord = Record<string, unknown>;

const asRecord = (value: unknown): XmlRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as XmlRecord : undefined;
const oneOrMany = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record?.["#text"] === "string" ? record["#text"] : undefined;
};
const child = (value: unknown, key: string) => asRecord(value)?.[key];
const childText = (value: unknown, key: string) => text(child(value, key));
const nestedText = (value: unknown, ...path: string[]) => {
  let cursor = value;
  for (const key of path) cursor = child(cursor, key);
  return text(cursor);
};

const camtAmount = (value: unknown, sourceRowNumber?: number) => {
  const amountText = text(value);
  if (!amountText) throw new BankStatementParseError("INVALID_AMOUNT", sourceRowNumber);
  return normalizeMoney(amountText, {
    decimalSeparator: ".",
    allowNegative: false,
    ...(sourceRowNumber === undefined ? {} : { sourceRowNumber }),
  });
};

const signedCamtAmount = (amountNode: unknown, indicator: string | undefined, sourceRowNumber?: number) => {
  const amount = camtAmount(amountNode, sourceRowNumber);
  if (indicator === "CRDT") return amount;
  if (indicator === "DBIT") return amount.negated();
  throw new BankStatementParseError("INVALID_AMOUNT", sourceRowNumber);
};

const amountCurrency = (amountNode: unknown) => {
  const currency = asRecord(amountNode)?.["@_Ccy"];
  return typeof currency === "string" ? currency : undefined;
};

const entryStatus = (entry: unknown) => childText(entry, "Sts") ?? nestedText(entry, "Sts", "Cd");

const transactionDetails = (entry: unknown) => {
  const details = oneOrMany(child(child(entry, "NtryDtls"), "TxDtls"));
  return details.map(asRecord).filter((value): value is XmlRecord => value !== undefined);
};

const entryDescription = (entry: unknown) => {
  const unstructured = transactionDetails(entry).flatMap((detail) =>
    oneOrMany(child(child(detail, "RmtInf"), "Ustrd")).map(text).filter((value): value is string => value !== undefined));
  return unstructured.join(" | ") || childText(entry, "AddtlNtryInf");
};

const entryEndToEndId = (entry: unknown) => {
  for (const detail of transactionDetails(entry)) {
    const value = nestedText(detail, "Refs", "EndToEndId");
    if (value && value !== "NOTPROVIDED") return value;
  }
  return undefined;
};

const balanceByCode = (statement: unknown, code: "OPBD" | "CLBD", currency: string) => {
  const balance = oneOrMany(child(statement, "Bal")).find((candidate) =>
    nestedText(candidate, "Tp", "CdOrPrtry", "Cd") === code);
  if (!balance) return undefined;
  const amountNode = child(balance, "Amt");
  const balanceCurrency = normalizeCurrency(amountCurrency(amountNode) ?? currency);
  if (balanceCurrency !== currency) throw new BankStatementParseError("CURRENCY_MISMATCH");
  return signedCamtAmount(amountNode, childText(balance, "CdtDbtInd")).toFixed(4);
};

const timeZoneOffsets = (...values: Array<string | undefined>) =>
  [...new Set(values.flatMap((value) => {
    const match = value?.match(/(?:Z|[+-]\d{2}:\d{2})$/u);
    return match ? [match[0]!] : [];
  }))].sort();

export class Camt053BankStatementAdapter {
  parse(
    source: string,
    sourceHashSha256: string,
    request: Camt053BankStatementParseRequest,
  ): NormalizedBankStatement {
    if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
      throw new BankStatementParseError("UNSAFE_XML");
    }
    if (XMLValidator.validate(source) !== true) {
      throw new BankStatementParseError("INVALID_XML");
    }

    let parsed: unknown;
    try {
      parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseTagValue: false,
        parseAttributeValue: false,
        processEntities: false,
        trimValues: true,
      }).parse(source);
    } catch {
      throw new BankStatementParseError("INVALID_XML");
    }
    const customerStatement = child(child(parsed, "Document"), "BkToCstmrStmt");
    if (!customerStatement) throw new BankStatementParseError("UNSUPPORTED_CAMT_DOCUMENT");
    const statements = oneOrMany(child(customerStatement, "Stmt"));
    if (statements.length !== 1) {
      throw new BankStatementParseError("MULTIPLE_STATEMENTS_NOT_SUPPORTED");
    }
    const statement = statements[0]!;
    const accountIdentifier = normalizeText(
      nestedText(statement, "Acct", "Id", "IBAN") ?? nestedText(statement, "Acct", "Id", "Othr", "Id"),
      128,
    );
    if (!accountIdentifier) throw new BankStatementParseError("UNSUPPORTED_CAMT_DOCUMENT");
    const expectedAccountIdentifier = normalizeText(request.expectedAccountIdentifier, 128);
    if (expectedAccountIdentifier && expectedAccountIdentifier !== accountIdentifier) {
      throw new BankStatementParseError("ACCOUNT_MISMATCH");
    }
    const currency = normalizeCurrency(nestedText(statement, "Acct", "Ccy") ?? "");
    if (request.expectedCurrency && normalizeCurrency(request.expectedCurrency) !== currency) {
      throw new BankStatementParseError("CURRENCY_MISMATCH");
    }

    const entries = oneOrMany(child(statement, "Ntry"));
    if (entries.length > MAX_BANK_STATEMENT_ENTRIES) {
      throw new BankStatementParseError("ENTRY_LIMIT_EXCEEDED");
    }
    let ignoredEntryCount = 0;
    const lines: NormalizedBankStatementLine[] = [];
    entries.forEach((entry, index) => {
      const sourceRowNumber = index + 1;
      if (entryStatus(entry) !== "BOOK") {
        ignoredEntryCount += 1;
        return;
      }
      const amountNode = child(entry, "Amt");
      const entryCurrency = normalizeCurrency(amountCurrency(amountNode) ?? currency, sourceRowNumber);
      if (entryCurrency !== currency) {
        throw new BankStatementParseError("CURRENCY_MISMATCH", sourceRowNumber);
      }
      const signedAmount = signedCamtAmount(amountNode, childText(entry, "CdtDbtInd"), sourceRowNumber);
      const normalizedAmount = amountAndDirection(signedAmount, sourceRowNumber);
      const bookingDateRaw = nestedText(entry, "BookgDt", "Dt") ?? nestedText(entry, "BookgDt", "DtTm");
      if (!bookingDateRaw) throw new BankStatementParseError("INVALID_DATE", sourceRowNumber);
      const bookingDate = normalizeIsoDate(bookingDateRaw, sourceRowNumber);
      const valueDateRaw = nestedText(entry, "ValDt", "Dt") ?? nestedText(entry, "ValDt", "DtTm");
      const valueDate = valueDateRaw ? normalizeIsoDate(valueDateRaw, sourceRowNumber) : undefined;
      const serviceReference = normalizeText(childText(entry, "AcctSvcrRef"), 200, sourceRowNumber);
      const endToEndId = normalizeText(entryEndToEndId(entry), 200, sourceRowNumber);
      const externalId = serviceReference ?? endToEndId;
      const reference = endToEndId;
      const description = normalizeText(entryDescription(entry), 500, sourceRowNumber);
      const lineWithoutFingerprint = {
        bookingDate,
        ...(valueDate === undefined ? {} : { valueDate }),
        ...normalizedAmount,
        currency,
        ...(externalId === undefined ? {} : { externalId }),
        ...(reference === undefined ? {} : { reference }),
        ...(description === undefined ? {} : { description }),
      };
      lines.push({
        sourceRowNumber,
        ...lineWithoutFingerprint,
        fingerprintSha256: fingerprintLine(lineWithoutFingerprint, accountIdentifier),
      });
    });
    if (lines.length === 0) throw new BankStatementParseError("UNSUPPORTED_CAMT_DOCUMENT");

    const openingBalance = balanceByCode(statement, "OPBD", currency);
    const closingBalance = balanceByCode(statement, "CLBD", currency);
    const netMovement = sumAmounts(lines);
    if (
      ignoredEntryCount === 0
      && openingBalance !== undefined
      && closingBalance !== undefined
      && !new Prisma.Decimal(openingBalance).plus(netMovement).equals(closingBalance)
    ) {
      throw new BankStatementParseError("BALANCE_MISMATCH");
    }
    const bookingDates = lines.map((line) => line.bookingDate).sort();
    const periodStartRaw = nestedText(statement, "FrToDt", "FrDtTm") ?? nestedText(statement, "FrToDt", "FrDt");
    const periodEndRaw = nestedText(statement, "FrToDt", "ToDtTm") ?? nestedText(statement, "FrToDt", "ToDt");
    const statementId = normalizeText(childText(statement, "Id"), 200);

    return {
      format: "CAMT053",
      sourceHashSha256,
      currency,
      netMovement,
      ignoredEntryCount,
      sourceTimeZoneOffsets: timeZoneOffsets(periodStartRaw, periodEndRaw),
      lines,
      accountIdentifier,
      ...(statementId === undefined ? {} : { statementId }),
      periodStart: periodStartRaw ? normalizeIsoDate(periodStartRaw) : bookingDates[0]!,
      periodEnd: periodEndRaw ? normalizeIsoDate(periodEndRaw) : bookingDates.at(-1)!,
      ...(openingBalance === undefined ? {} : { openingBalance }),
      ...(closingBalance === undefined ? {} : { closingBalance }),
    };
  }
}
