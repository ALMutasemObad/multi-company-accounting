export const MAX_BANK_STATEMENT_BYTES = 512 * 1024;
export const MAX_BANK_STATEMENT_ENTRIES = 5_000;

export type BankStatementFormat = "CSV" | "CAMT053";
export type BankStatementDirection = "CREDIT" | "DEBIT";
export type BankStatementDateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";

export type CsvBankStatementColumns = {
  bookingDate: string;
  valueDate?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  externalId?: string;
  reference?: string;
  description?: string;
};

export type CsvBankStatementProfile = {
  delimiter: "," | ";" | "\t";
  dateFormat: BankStatementDateFormat;
  decimalSeparator: "." | ",";
  thousandsSeparator?: "," | "." | " ";
  defaultCurrency: string;
  accountIdentifier?: string;
  positiveAmountDirection?: BankStatementDirection;
  columns: CsvBankStatementColumns;
};

export type CsvBankStatementParseRequest = {
  format: "CSV";
  fileName?: string;
  profile: CsvBankStatementProfile;
};

export type Camt053BankStatementParseRequest = {
  format: "CAMT053";
  fileName?: string;
  expectedAccountIdentifier?: string;
  expectedCurrency?: string;
};

export type BankStatementParseRequest =
  | CsvBankStatementParseRequest
  | Camt053BankStatementParseRequest;

export type NormalizedBankStatementLine = {
  sourceRowNumber: number;
  bookingDate: string;
  amount: string;
  direction: BankStatementDirection;
  currency: string;
  fingerprintSha256: string;
  valueDate?: string;
  externalId?: string;
  reference?: string;
  description?: string;
};

export type NormalizedBankStatement = {
  format: BankStatementFormat;
  sourceHashSha256: string;
  currency: string;
  netMovement: string;
  ignoredEntryCount: number;
  sourceTimeZoneOffsets: string[];
  lines: NormalizedBankStatementLine[];
  statementId?: string;
  accountIdentifier?: string;
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: string;
  closingBalance?: string;
};

export interface BankStatementParserPort {
  sniff(input: Uint8Array): BankStatementFormat;
  parse(input: Uint8Array, request: BankStatementParseRequest): NormalizedBankStatement;
}
