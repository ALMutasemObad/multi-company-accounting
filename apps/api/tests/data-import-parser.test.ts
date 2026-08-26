import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tableToXlsx } from "../src/reports/financial-statement-exporter.js";
import { DataImportParseError, groupInvoiceRows, importHeaders, parseImportFile } from "../src/imports/data-import-parser.js";

const base64 = (value: Buffer | string) => Buffer.from(value).toString("base64");
const csv = (headers: readonly string[], row: readonly string[]) => `\uFEFF${headers.map((value) => `"${value}"`).join(",")}\r\n${row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")}`;

describe("data import file boundary", () => {
  it("parses strict UTF-8 CSV with quoted commas without executing spreadsheet cells", async () => {
    const headers = importHeaders.CUSTOMERS;
    const row = ["110100", "عميل، تجريبي", "Sample", "", "customer@example.com", "", "BILLING", "شارع \"أ\"", "", "الرياض", "", "", "SA", "true"];
    const parsed = await parseImportFile(base64(csv(headers, row)), "CSV", "CUSTOMERS");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.values.name_ar).toBe("عميل، تجريبي");
    expect(parsed.rows[0]?.values.address_line1).toBe('شارع "أ"');
    await expect(parseImportFile(base64(csv(headers, row).replace('"110100"', '"110100"x')), "CSV", "CUSTOMERS")).rejects.toMatchObject({ reason: "INVALID_CSV" });
  });

  it("reads the first XLSX sheet produced by the official template", async () => {
    const headers = importHeaders.SUPPLIERS;
    const values = ["210100", "مورد", "Supplier", "", "", "", "PAYMENT", "الرياض", "", "", "", "", "SA", "false"];
    const workbook = tableToXlsx([headers.map((value) => ({ value })), values.map((value) => ({ value }))], "import_template");
    const parsed = await parseImportFile(base64(workbook), "XLSX", "SUPPLIERS");
    expect(parsed.rows[0]?.values.payable_account_code).toBe("210100");
    expect(parsed.rows[0]?.values.name_ar).toBe("مورد");
    expect(importHeaders.SALES_INVOICES).toEqual(expect.arrayContaining(["warehouse_code", "inventory_item_code"]));
  });

  it("keeps prior invoice templates compatible when inventory columns are absent", async () => {
    const headers = importHeaders.SALES_INVOICES.filter((header) => !["warehouse_code", "inventory_item_code"].includes(header));
    const values = headers.map((header) => ({
      invoice_key: "LEGACY-1",
      document_date: "2026-08-22",
      due_date: "2026-08-22",
      description: "فاتورة قديمة",
      customer_code: "CUS-000001",
      currency_code: "SAR",
      exchange_rate: "1.00000000",
      line_description: "خدمة",
      quantity: "1.0000",
      unit_price: "1.0000",
      discount_amount: "0.0000",
      account_code: "4110",
    } as Record<string, string>)[header] ?? "");
    const parsed = await parseImportFile(base64(csv(headers, values)), "CSV", "SALES_INVOICES");
    expect(parsed.rows[0]?.values.inventory_item_code).toBeUndefined();
  });

  it("rejects formulas before a workbook parser can return cached values", async () => {
    const workbook = tableToXlsx([[{ value: "name_ar" }], [{ value: "safe" }]], "import_template");
    const files = unzipSync(new Uint8Array(workbook));
    const sheet = "xl/worksheets/sheet1.xml";
    files[sheet] = Buffer.from(Buffer.from(files[sheet]!).toString("utf8").replace("<sheetData>", "<sheetData><row r=\"9\"><c r=\"A9\"><f>1+1</f><v>2</v></c></row>"));
    const unsafe = Buffer.from(zipSync(files));
    await expect(parseImportFile(base64(unsafe), "XLSX", "CUSTOMERS")).rejects.toEqual(new DataImportParseError("UNSAFE_XLSX_CONTENT"));
  });

  it("reports missing and unknown headers without accepting a near-match", async () => {
    const headers = [...importHeaders.CUSTOMERS];
    headers[0] = "account_code";
    await expect(parseImportFile(base64(csv(headers, Array(headers.length).fill("x"))), "CSV", "CUSTOMERS")).rejects.toMatchObject({ reason: "INVALID_HEADERS", errors: expect.arrayContaining([{ row: 1, column: "receivable_account_code", code: "MISSING_HEADER" }, { row: 1, column: "account_code", code: "UNKNOWN_HEADER" }]) });
  });

  it("groups invoice lines by a stable file-local key and caps invoice count", () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ rowNumber: index + 2, values: { invoice_key: `INV-${index}` } }));
    expect(() => groupInvoiceRows(rows)).toThrowError(expect.objectContaining({ reason: "INVOICE_LIMIT_EXCEEDED" }));
    const oversizedInvoice = Array.from({ length: 201 }, (_, index) => ({ rowNumber: index + 2, values: { invoice_key: "INV-ONE" } }));
    expect(() => groupInvoiceRows(oversizedInvoice)).toThrowError(expect.objectContaining({ reason: "INVOICE_LINE_LIMIT_EXCEEDED" }));
  });
});
