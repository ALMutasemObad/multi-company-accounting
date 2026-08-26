import { parse } from "csv-parse/sync";
import { BankStatementParseError } from "../bank-statement-error.js";
import {
  amountAndDirection,
  fingerprintLine,
  normalizeCurrency,
  normalizeDate,
  normalizeMoney,
  normalizeText,
  sumAmounts,
} from "../bank-statement-normalization.js";
import {
  MAX_BANK_STATEMENT_ENTRIES,
  type CsvBankStatementProfile,
  type NormalizedBankStatement,
  type NormalizedBankStatementLine,
} from "../bank-statement-types.js";

const configuredColumnNames = (profile: CsvBankStatementProfile) =>
  Object.values(profile.columns).filter((value): value is string => value !== undefined);

const requireValidProfile = (profile: CsvBankStatementProfile) => {
  const hasSignedAmount = profile.columns.amount !== undefined;
  const hasSplitAmount = profile.columns.debit !== undefined && profile.columns.credit !== undefined;
  if (
    hasSignedAmount === hasSplitAmount
    || hasSignedAmount && profile.positiveAmountDirection === undefined
    || profile.columns.debit !== undefined !== (profile.columns.credit !== undefined)
    || new Set(configuredColumnNames(profile)).size !== configuredColumnNames(profile).length
  ) {
    throw new BankStatementParseError("INVALID_PROFILE");
  }
};

const valueAt = (row: readonly string[], indexes: ReadonlyMap<string, number>, column?: string) =>
  column === undefined ? undefined : row[indexes.get(column)!];

export class CsvBankStatementAdapter {
  parse(
    text: string,
    sourceHashSha256: string,
    profile: CsvBankStatementProfile,
  ): NormalizedBankStatement {
    requireValidProfile(profile);
    const currency = normalizeCurrency(profile.defaultCurrency);
    const accountIdentifier = normalizeText(profile.accountIdentifier, 128);
    let records: string[][];
    try {
      records = parse(text, {
        bom: true,
        delimiter: profile.delimiter,
        skip_empty_lines: true,
        relax_column_count: false,
        trim: true,
        max_record_size: 64 * 1024,
      }) as string[][];
    } catch {
      throw new BankStatementParseError("INVALID_CSV");
    }
    const headers = records[0];
    if (!headers || headers.length === 0 || headers.some((header) => !header)) {
      throw new BankStatementParseError("INVALID_HEADERS", 1);
    }
    if (new Set(headers).size !== headers.length) {
      throw new BankStatementParseError("INVALID_HEADERS", 1);
    }
    const indexes = new Map(headers.map((header, index) => [header, index]));
    if (configuredColumnNames(profile).some((header) => !indexes.has(header))) {
      throw new BankStatementParseError("INVALID_HEADERS", 1);
    }

    const rows = records.slice(1);
    if (rows.length > MAX_BANK_STATEMENT_ENTRIES) {
      throw new BankStatementParseError("ENTRY_LIMIT_EXCEEDED");
    }
    if (rows.length === 0) throw new BankStatementParseError("INVALID_CSV");

    const lines = rows.map((row, index): NormalizedBankStatementLine => {
      const sourceRowNumber = index + 2;
      const bookingDate = normalizeDate(
        valueAt(row, indexes, profile.columns.bookingDate) ?? "",
        profile.dateFormat,
        sourceRowNumber,
      );
      const valueDateValue = valueAt(row, indexes, profile.columns.valueDate);
      const valueDate = valueDateValue
        ? normalizeDate(valueDateValue, profile.dateFormat, sourceRowNumber)
        : undefined;
      const rowCurrencyValue = valueAt(row, indexes, profile.columns.currency);
      const rowCurrency = normalizeCurrency(rowCurrencyValue || currency, sourceRowNumber);
      if (rowCurrency !== currency) {
        throw new BankStatementParseError("CURRENCY_MISMATCH", sourceRowNumber);
      }

      let signedAmount: ReturnType<typeof normalizeMoney>;
      if (profile.columns.amount !== undefined) {
        const rawAmount = normalizeMoney(valueAt(row, indexes, profile.columns.amount) ?? "", {
          decimalSeparator: profile.decimalSeparator,
          ...(profile.thousandsSeparator === undefined ? {} : { thousandsSeparator: profile.thousandsSeparator }),
          allowNegative: true,
          sourceRowNumber,
        });
        signedAmount = profile.positiveAmountDirection === "DEBIT" ? rawAmount.negated() : rawAmount;
      } else {
        const debit = valueAt(row, indexes, profile.columns.debit)?.trim() ?? "";
        const credit = valueAt(row, indexes, profile.columns.credit)?.trim() ?? "";
        if ((!debit && !credit) || (debit && credit)) {
          throw new BankStatementParseError("INVALID_AMOUNT", sourceRowNumber);
        }
        const rawAmount = normalizeMoney(debit || credit, {
          decimalSeparator: profile.decimalSeparator,
          ...(profile.thousandsSeparator === undefined ? {} : { thousandsSeparator: profile.thousandsSeparator }),
          allowNegative: false,
          sourceRowNumber,
        });
        signedAmount = debit ? rawAmount.negated() : rawAmount;
      }
      const normalizedAmount = amountAndDirection(signedAmount, sourceRowNumber);
      const externalId = normalizeText(valueAt(row, indexes, profile.columns.externalId), 200, sourceRowNumber);
      const reference = normalizeText(valueAt(row, indexes, profile.columns.reference), 200, sourceRowNumber);
      const description = normalizeText(valueAt(row, indexes, profile.columns.description), 500, sourceRowNumber);
      const lineWithoutFingerprint = {
        bookingDate,
        ...(valueDate === undefined ? {} : { valueDate }),
        ...normalizedAmount,
        currency,
        ...(externalId === undefined ? {} : { externalId }),
        ...(reference === undefined ? {} : { reference }),
        ...(description === undefined ? {} : { description }),
      };
      return {
        sourceRowNumber,
        ...lineWithoutFingerprint,
        fingerprintSha256: fingerprintLine(lineWithoutFingerprint, accountIdentifier),
      };
    });

    const dates = lines.map((line) => line.bookingDate).sort();
    return {
      format: "CSV",
      sourceHashSha256,
      currency,
      netMovement: sumAmounts(lines),
      ignoredEntryCount: 0,
      sourceTimeZoneOffsets: [],
      lines,
      ...(accountIdentifier === undefined ? {} : { accountIdentifier }),
      periodStart: dates[0]!,
      periodEnd: dates.at(-1)!,
    };
  }
}
