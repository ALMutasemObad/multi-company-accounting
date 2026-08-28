import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  BankStatementParseError,
  BankStatementParser,
  type BankStatementParseRequest,
  type BankStatementParserPort,
  type CsvBankStatementProfile,
  type NormalizedBankStatement,
} from "../src/treasury/reconciliation/bank-statement-parser.js";
import { MAX_BANK_STATEMENT_BYTES } from "../src/treasury/reconciliation/bank-statement-types.js";

const parser = new BankStatementParser();
const encode = (value: string) => new TextEncoder().encode(value);
const fixture = (name: string) => readFile(new URL(`fixtures/bank-statements/${name}`, import.meta.url));
const csvProfile: CsvBankStatementProfile = {
  delimiter: ",",
  dateFormat: "YYYY-MM-DD",
  decimalSeparator: ".",
  thousandsSeparator: ",",
  defaultCurrency: "SAR",
  accountIdentifier: "SA0000000000000000000001",
  columns: {
    bookingDate: "booking_date",
    valueDate: "value_date",
    debit: "debit",
    credit: "credit",
    currency: "currency",
    externalId: "transaction_id",
    reference: "reference",
    description: "description",
  },
};

const contractSource = encode("date,amount\n2026-08-01,1.2500");
const contractRequest: BankStatementParseRequest = {
  format: "CSV",
  profile: {
    delimiter: ",",
    dateFormat: "YYYY-MM-DD",
    decimalSeparator: ".",
    defaultCurrency: "SAR",
    positiveAmountDirection: "CREDIT",
    columns: { bookingDate: "date", amount: "amount" },
  },
};
const contractResult: NormalizedBankStatement = {
  format: "CSV",
  sourceHashSha256: "0".repeat(64),
  currency: "SAR",
  netMovement: "1.2500",
  ignoredEntryCount: 0,
  sourceTimeZoneOffsets: [],
  periodStart: "2026-08-01",
  periodEnd: "2026-08-01",
  lines: [{
    sourceRowNumber: 2,
    bookingDate: "2026-08-01",
    amount: "1.2500",
    direction: "CREDIT",
    currency: "SAR",
    fingerprintSha256: "1".repeat(64),
  }],
};

class FakeBankStatementParser implements BankStatementParserPort {
  sniff(): "CSV" {
    return "CSV";
  }

  parse(): NormalizedBankStatement {
    return contractResult;
  }
}

describe.each([
  ["open-source adapters", () => new BankStatementParser()],
  ["test fake", () => new FakeBankStatementParser()],
] as const)("BankStatementParserPort contract: %s", (_name, createParser) => {
  it("returns only the stable normalized contract", () => {
    const implementation = createParser();
    expect(implementation.sniff(contractSource)).toBe("CSV");
    const result = implementation.parse(contractSource, contractRequest);
    expect(result).toMatchObject({
      format: "CSV",
      currency: "SAR",
      netMovement: "1.2500",
      ignoredEntryCount: 0,
      sourceTimeZoneOffsets: [],
    });
    expect(result.lines[0]).toMatchObject({
      bookingDate: "2026-08-01",
      amount: "1.2500",
      direction: "CREDIT",
      currency: "SAR",
    });
    expect(Object.keys(result.lines[0] ?? {}).some((key) => key.startsWith("@_") || key === "record")).toBe(false);
  });
});

describe("bank statement parser contract", () => {
  it("normalizes a profiled CSV without binary floating-point drift", async () => {
    const source = await fixture("generic-bank.csv");
    expect(parser.sniff(source)).toBe("CSV");
    const statement = parser.parse(source, { format: "CSV", profile: csvProfile });

    expect(statement).toMatchObject({
      format: "CSV",
      accountIdentifier: "SA0000000000000000000001",
      currency: "SAR",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-02",
      netMovement: "800.0500",
      ignoredEntryCount: 0,
      sourceTimeZoneOffsets: [],
    });
    expect(statement.lines.map(({ amount, direction }) => ({ amount, direction }))).toEqual([
      { amount: "1000.1000", direction: "CREDIT" },
      { amount: "-200.0500", direction: "DEBIT" },
    ]);
    expect(statement.lines[0]?.description).toBe("دفعة عميل");
    expect(statement.lines.every((line) => /^[a-f0-9]{64}$/u.test(line.fingerprintSha256))).toBe(true);
    expect(parser.parse(source, { format: "CSV", profile: csvProfile }).lines[0]?.fingerprintSha256)
      .toBe(statement.lines[0]?.fingerprintSha256);
  });

  it("normalizes CAMT.053 booked entries and verifies the balance equation", async () => {
    const source = await fixture("camt053.001.08.xml");
    expect(parser.sniff(source)).toBe("CAMT053");
    const statement = parser.parse(source, {
      format: "CAMT053",
      expectedAccountIdentifier: "SA0000000000000000000001",
      expectedCurrency: "SAR",
    });

    expect(statement).toMatchObject({
      statementId: "STMT-2026-08-02",
      accountIdentifier: "SA0000000000000000000001",
      currency: "SAR",
      openingBalance: "1000.0000",
      closingBalance: "1200.1500",
      netMovement: "200.1500",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-02",
      ignoredEntryCount: 0,
      sourceTimeZoneOffsets: ["+03:00"],
    });
    expect(statement.lines).toHaveLength(2);
    expect(statement.lines[0]).toMatchObject({
      externalId: "ASR-001",
      reference: "E2E-001",
      amount: "250.2500",
      direction: "CREDIT",
    });
    expect(statement.lines[1]).toMatchObject({ amount: "-50.1000", direction: "DEBIT" });
  });

  it("requires an explicit CSV profile instead of guessing ambiguous semantics", () => {
    const source = encode("date,amount\n01/02/2026,1.00");
    expect(() => parser.parse(source, {
      format: "CSV",
      profile: {
        delimiter: ",",
        dateFormat: "DD/MM/YYYY",
        decimalSeparator: ".",
        defaultCurrency: "SAR",
        columns: { bookingDate: "date", amount: "amount" },
      },
    })).toThrowError(expect.objectContaining({ reason: "INVALID_PROFILE" }));
  });

  it("supports semicolon/BOM profiles and signed amounts without guessing direction", () => {
    const source = encode("\uFEFFالتاريخ;المبلغ;البيان\n26/08/2026;10,2500;تحصيل\n27/08/2026;-2,1000;رد");
    const statement = parser.parse(source, {
      format: "CSV",
      fileName: "bank.csv",
      profile: {
        delimiter: ";",
        dateFormat: "DD/MM/YYYY",
        decimalSeparator: ",",
        defaultCurrency: "SAR",
        positiveAmountDirection: "CREDIT",
        columns: { bookingDate: "التاريخ", amount: "المبلغ", description: "البيان" },
      },
    });
    expect(statement.lines.map((line) => line.amount)).toEqual(["10.2500", "-2.1000"]);
    expect(statement.netMovement).toBe("8.1500");
  });

  it("accepts older CAMT.053 namespaces through the local normalized contract", async () => {
    const source = await fixture("camt053.001.08.xml");
    const olderNamespace = encode(source.toString("utf8").replace("camt.053.001.08", "camt.053.001.02"));
    expect(parser.parse(olderNamespace, { format: "CAMT053", fileName: "statement.xml" }).netMovement)
      .toBe("200.1500");
  });

  it("rejects account, currency, and balance mismatches", async () => {
    const source = await fixture("camt053.001.08.xml");
    expect(() => parser.parse(source, {
      format: "CAMT053",
      expectedAccountIdentifier: "SA-WRONG",
    })).toThrowError(expect.objectContaining({ reason: "ACCOUNT_MISMATCH" }));
    expect(() => parser.parse(source, {
      format: "CAMT053",
      expectedCurrency: "USD",
    })).toThrowError(expect.objectContaining({ reason: "CURRENCY_MISMATCH" }));
    expect(() => parser.parse(
      encode(source.toString("utf8").replace("1200.1500", "1200.1600")),
      { format: "CAMT053" },
    )).toThrowError(expect.objectContaining({ reason: "BALANCE_MISMATCH" }));
  });
});

describe("bank statement parser security and capacity boundaries", () => {
  it("rejects DTD/entity declarations before XML parsing", () => {
    const unsafe = encode(`<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Document><BkToCstmrStmt><Stmt>&xxe;</Stmt></BkToCstmrStmt></Document>`);
    expect(() => parser.parse(unsafe, { format: "CAMT053" }))
      .toThrowError(expect.objectContaining({ reason: "UNSAFE_XML" }));
  });

  it("rejects oversized, invalid UTF-8, and format-mismatched inputs", () => {
    expect(() => parser.sniff(new Uint8Array(MAX_BANK_STATEMENT_BYTES + 1)))
      .toThrowError(expect.objectContaining({ reason: "FILE_TOO_LARGE" }));
    expect(() => parser.sniff(new Uint8Array([0xc3, 0x28])))
      .toThrowError(expect.objectContaining({ reason: "INVALID_UTF8" }));
    expect(() => parser.parse(encode("a,b\n1,2"), { format: "CAMT053" }))
      .toThrowError(expect.objectContaining({ reason: "FORMAT_MISMATCH" }));
    expect(() => parser.parse(encode("a,b\n1,2"), {
      format: "CSV",
      fileName: "statement.xml",
      profile: csvProfile,
    })).toThrowError(expect.objectContaining({ reason: "FORMAT_MISMATCH" }));
  });

  it("preserves spreadsheet-like text as inert data", () => {
    const source = encode("date,amount,description\n2026-08-01,0.1000,=1+1\n2026-08-02,0.2000,@SUM(A1:A2)");
    const statement = parser.parse(source, {
      format: "CSV",
      profile: {
        delimiter: ",",
        dateFormat: "YYYY-MM-DD",
        decimalSeparator: ".",
        defaultCurrency: "SAR",
        positiveAmountDirection: "CREDIT",
        columns: { bookingDate: "date", amount: "amount", description: "description" },
      },
    });
    expect(statement.netMovement).toBe("0.3000");
    expect(statement.lines.map((line) => line.description)).toEqual(["=1+1", "@SUM(A1:A2)"]);
  });

  it("parses the maximum supported CSV batch within the spike budget", () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => `2026-08-01,0.0001,ROW-${index}`);
    const source = encode(`date,amount,reference\n${rows.join("\n")}`);
    const startedAt = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const statement = parser.parse(source, {
      format: "CSV",
      profile: {
        delimiter: ",",
        dateFormat: "YYYY-MM-DD",
        decimalSeparator: ".",
        defaultCurrency: "SAR",
        positiveAmountDirection: "CREDIT",
        columns: { bookingDate: "date", amount: "amount", reference: "reference" },
      },
    });
    const durationMs = performance.now() - startedAt;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    expect(statement.lines).toHaveLength(5_000);
    expect(statement.netMovement).toBe("0.5000");
    expect(durationMs).toBeLessThan(4_000);
    expect(heapDeltaBytes).toBeLessThan(64 * 1024 * 1024);
  }, 10_000);

  it("enforces the entry limit independently from the byte limit", () => {
    const rows = Array.from({ length: 5_001 }, () => "2026-08-01,1");
    const source = encode(`date,amount\n${rows.join("\n")}`);
    expect(() => parser.parse(source, {
      format: "CSV",
      profile: {
        delimiter: ",",
        dateFormat: "YYYY-MM-DD",
        decimalSeparator: ".",
        defaultCurrency: "SAR",
        positiveAmountDirection: "CREDIT",
        columns: { bookingDate: "date", amount: "amount" },
      },
    })).toThrowError(expect.objectContaining({ reason: "ENTRY_LIMIT_EXCEEDED" }));
  });

  it("exposes stable typed errors without leaking parser exceptions", () => {
    try {
      parser.parse(encode("date,amount\nnot-a-date,1"), {
        format: "CSV",
        profile: {
          delimiter: ",",
          dateFormat: "YYYY-MM-DD",
          decimalSeparator: ".",
          defaultCurrency: "SAR",
          positiveAmountDirection: "CREDIT",
          columns: { bookingDate: "date", amount: "amount" },
        },
      });
      throw new Error("expected parser error");
    } catch (error) {
      expect(error).toBeInstanceOf(BankStatementParseError);
      expect(error).toMatchObject({ reason: "INVALID_DATE", sourceRowNumber: 2 });
    }
  });

  it("rejects zero, excessive precision, conflicting split amounts, and duplicate headers", () => {
    const profile: CsvBankStatementProfile = {
      delimiter: ",",
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: ".",
      defaultCurrency: "SAR",
      positiveAmountDirection: "CREDIT",
      columns: { bookingDate: "date", amount: "amount" },
    };
    for (const amount of ["0", "1.00001"]) {
      expect(() => parser.parse(encode(`date,amount\n2026-08-01,${amount}`), { format: "CSV", profile }))
        .toThrowError(expect.objectContaining({ reason: "INVALID_AMOUNT" }));
    }
    expect(() => parser.parse(encode("date,debit,credit\n2026-08-01,1,1"), {
      format: "CSV",
      profile: {
        delimiter: ",",
        dateFormat: "YYYY-MM-DD",
        decimalSeparator: ".",
        defaultCurrency: "SAR",
        columns: { bookingDate: "date", debit: "debit", credit: "credit" },
      },
    })).toThrowError(expect.objectContaining({ reason: "INVALID_AMOUNT" }));
    expect(() => parser.parse(encode("date,date,amount\n2026-08-01,2026-08-01,1"), { format: "CSV", profile }))
      .toThrowError(expect.objectContaining({ reason: "INVALID_HEADERS" }));
  });
});
