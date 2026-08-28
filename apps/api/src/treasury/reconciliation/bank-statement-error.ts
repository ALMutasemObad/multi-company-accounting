export type BankStatementParseErrorReason =
  | "FILE_TOO_LARGE"
  | "INVALID_UTF8"
  | "UNSUPPORTED_FORMAT"
  | "FORMAT_MISMATCH"
  | "UNSAFE_XML"
  | "INVALID_XML"
  | "UNSUPPORTED_CAMT_DOCUMENT"
  | "MULTIPLE_STATEMENTS_NOT_SUPPORTED"
  | "ENTRY_LIMIT_EXCEEDED"
  | "INVALID_CSV"
  | "INVALID_PROFILE"
  | "INVALID_HEADERS"
  | "INVALID_DATE"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_TEXT"
  | "ACCOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "BALANCE_MISMATCH";

export class BankStatementParseError extends Error {
  constructor(
    public readonly reason: BankStatementParseErrorReason,
    public readonly sourceRowNumber?: number,
  ) {
    super(sourceRowNumber === undefined ? reason : `${reason} at source row ${sourceRowNumber}`);
    this.name = "BankStatementParseError";
  }
}
