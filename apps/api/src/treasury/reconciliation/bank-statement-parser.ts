import { Camt053BankStatementAdapter } from "./adapters/camt053-bank-statement-adapter.js";
import { CsvBankStatementAdapter } from "./adapters/csv-bank-statement-adapter.js";
import { BankStatementParseError } from "./bank-statement-error.js";
import { decodeBankStatement, sha256Hex } from "./bank-statement-normalization.js";
import {
  MAX_BANK_STATEMENT_BYTES,
  type BankStatementFormat,
  type BankStatementParseRequest,
  type BankStatementParserPort,
  type NormalizedBankStatement,
} from "./bank-statement-types.js";

export class BankStatementParser implements BankStatementParserPort {
  readonly #csv = new CsvBankStatementAdapter();
  readonly #camt053 = new Camt053BankStatementAdapter();

  sniff(input: Uint8Array): BankStatementFormat {
    const source = this.#read(input);
    const withoutBom = source.replace(/^\uFEFF/u, "").trimStart();
    if (withoutBom.startsWith("<")) {
      if (/<(?:[A-Za-z_][\w.-]*:)?BkToCstmrStmt[\s>]/u.test(withoutBom)) return "CAMT053";
      throw new BankStatementParseError("UNSUPPORTED_FORMAT");
    }
    if (withoutBom.includes("\n") || withoutBom.includes("\r")) return "CSV";
    throw new BankStatementParseError("UNSUPPORTED_FORMAT");
  }

  parse(input: Uint8Array, request: BankStatementParseRequest): NormalizedBankStatement {
    const detectedFormat = this.sniff(input);
    if (detectedFormat !== request.format) {
      throw new BankStatementParseError("FORMAT_MISMATCH");
    }
    if (request.fileName !== undefined) {
      const fileName = request.fileName.normalize("NFC").trim();
      if (fileName.length === 0 || fileName.length > 255) {
        throw new BankStatementParseError("FORMAT_MISMATCH");
      }
      const extension = /(?:\.([^.\\/]+))$/u.exec(fileName)?.[1]?.toLowerCase();
      const expectedExtension = request.format === "CSV" ? "csv" : "xml";
      if (extension !== expectedExtension) throw new BankStatementParseError("FORMAT_MISMATCH");
    }
    const source = this.#read(input);
    const sourceHashSha256 = sha256Hex(input);
    return request.format === "CSV"
      ? this.#csv.parse(source, sourceHashSha256, request.profile)
      : this.#camt053.parse(source, sourceHashSha256, request);
  }

  #read(input: Uint8Array): string {
    if (input.byteLength > MAX_BANK_STATEMENT_BYTES) {
      throw new BankStatementParseError("FILE_TOO_LARGE");
    }
    return decodeBankStatement(input);
  }
}

export { BankStatementParseError } from "./bank-statement-error.js";
export type {
  BankStatementParseRequest,
  BankStatementParserPort,
  Camt053BankStatementParseRequest,
  CsvBankStatementParseRequest,
  CsvBankStatementProfile,
  NormalizedBankStatement,
  NormalizedBankStatementLine,
} from "./bank-statement-types.js";
