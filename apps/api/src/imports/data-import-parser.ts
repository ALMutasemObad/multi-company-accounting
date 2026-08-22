import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";
import { readSheet, type CellValue } from "read-excel-file/node";
import type { DataImportFormatValue, DataImportInvoiceGroup, DataImportRow, DataImportRowError, DataImportTypeValue } from "./data-import-types.js";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_ROWS = 500;
const MAX_INVOICES = 100;
const MAX_INVOICE_LINES = 500;
const MAX_LINES_PER_INVOICE = 200;
const MAX_XLSX_ENTRIES = 128;
const MAX_XLSX_UNCOMPRESSED = 8 * 1024 * 1024;

export const importHeaders: Record<DataImportTypeValue, readonly string[]> = {
  CUSTOMERS: ["receivable_account_code", "name_ar", "name_en", "phone", "email", "tax_number", "address_type", "address_line1", "address_line2", "city", "region", "postal_code", "country_code", "is_primary"],
  SUPPLIERS: ["payable_account_code", "name_ar", "name_en", "phone", "email", "tax_number", "address_type", "address_line1", "address_line2", "city", "region", "postal_code", "country_code", "is_primary"],
  SALES_INVOICES: ["invoice_key", "document_date", "due_date", "description", "customer_code", "currency_code", "exchange_rate", "customer_address", "notes", "line_description", "quantity", "unit_price", "discount_amount", "account_code", "tax_code", "cost_center_code"],
  PURCHASE_INVOICES: ["invoice_key", "document_date", "due_date", "description", "supplier_code", "supplier_invoice_number", "currency_code", "exchange_rate", "supplier_address", "notes", "line_description", "quantity", "unit_price", "discount_amount", "account_code", "tax_code", "cost_center_code"],
};

export const importExamples: Record<DataImportTypeValue, readonly string[]> = {
  CUSTOMERS: ["110100", "عميل تجريبي", "Sample customer", "+966500000000", "customer@example.com", "1234567890", "BILLING", "شارع الملك", "", "الرياض", "الرياض", "12345", "SA", "true"],
  SUPPLIERS: ["210100", "مورد تجريبي", "Sample supplier", "+966500000001", "supplier@example.com", "1234567890", "PAYMENT", "طريق الملك", "", "الرياض", "الرياض", "12345", "SA", "true"],
  SALES_INVOICES: ["INV-001", "2026-08-22", "2026-09-21", "فاتورة مبيعات مستوردة", "CUS-000001", "SAR", "1.00000000", "", "", "خدمة استشارية", "1.0000", "1000.0000", "0.0000", "410100", "", ""],
  PURCHASE_INVOICES: ["PINV-001", "2026-08-22", "2026-09-21", "فاتورة مشتريات مستوردة", "SUP-000001", "SUP-INV-001", "SAR", "1.00000000", "", "", "مصروف تشغيلي", "1.0000", "500.0000", "0.0000", "510100", "", ""],
};

export class DataImportParseError extends Error {
  constructor(public readonly reason: string, public readonly errors: DataImportRowError[] = []) { super(reason); }
}

function strictBase64(value: string) {
  if (!value || value.length > 720_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new DataImportParseError("INVALID_FILE_ENCODING");
  const buffer = Buffer.from(value, "base64");
  if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES || buffer.toString("base64") !== value) throw new DataImportParseError(buffer.length > MAX_FILE_BYTES ? "FILE_TOO_LARGE" : "INVALID_FILE_ENCODING");
  return buffer;
}

function csvMatrix(buffer: Buffer) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new DataImportParseError("INVALID_UTF8"); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let quoteClosed = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') { quoted = false; quoteClosed = true; }
      else cell += char;
    } else if (quoteClosed && char !== "," && char !== "\r" && char !== "\n") throw new DataImportParseError("INVALID_CSV");
    else if (char === '"' && cell === "") quoted = true;
    else if (char === '"') throw new DataImportParseError("INVALID_CSV");
    else if (char === ",") { row.push(cell); cell = ""; quoteClosed = false; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = ""; quoteClosed = false;
    } else cell += char;
  }
  if (quoted) throw new DataImportParseError("INVALID_CSV");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function assertSafeXlsx(buffer: Buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw new DataImportParseError("INVALID_XLSX");
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  if (eocd < 0) throw new DataImportParseError("INVALID_XLSX");
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > MAX_XLSX_ENTRIES || centralOffset + centralSize > eocd) throw new DataImportParseError("UNSAFE_XLSX_ARCHIVE");
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) throw new DataImportParseError("INVALID_XLSX");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || name.includes("..") || name.startsWith("/") || size > 4 * 1024 * 1024) throw new DataImportParseError("UNSAFE_XLSX_ARCHIVE");
    total += size;
    if (total > MAX_XLSX_UNCOMPRESSED) throw new DataImportParseError("UNSAFE_XLSX_ARCHIVE");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buffer)); } catch { throw new DataImportParseError("INVALID_XLSX"); }
  for (const [name, data] of Object.entries(files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) continue;
    const source = Buffer.from(data).toString("utf8");
    if (/<f(?:\s|>)/i.test(source) || /<row\b[^>]*\bhidden\s*=\s*["'](?:1|true)["']/i.test(source)) throw new DataImportParseError("UNSAFE_XLSX_CONTENT");
  }
}

function cellText(value: CellValue<number> | null) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

async function xlsxMatrix(buffer: Buffer) {
  assertSafeXlsx(buffer);
  try { return (await readSheet(buffer, 1)).map((row) => row.map(cellText)); }
  catch { throw new DataImportParseError("INVALID_XLSX"); }
}

function rowsFromMatrix(matrix: string[][], type: DataImportTypeValue) {
  const nonEmpty = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length < 2) throw new DataImportParseError("EMPTY_IMPORT_FILE");
  const headers = nonEmpty[0]!.map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) throw new DataImportParseError("INVALID_HEADERS");
  const expected = importHeaders[type];
  const missing = expected.filter((header) => !headers.includes(header));
  const unknown = headers.filter((header) => !expected.includes(header));
  if (missing.length || unknown.length) throw new DataImportParseError("INVALID_HEADERS", [...missing.map((column) => ({ row: 1, column, code: "MISSING_HEADER" })), ...unknown.map((column) => ({ row: 1, column, code: "UNKNOWN_HEADER" }))]);
  const data = nonEmpty.slice(1);
  if (data.length > MAX_ROWS) throw new DataImportParseError("ROW_LIMIT_EXCEEDED");
  return data.map((cells, index): DataImportRow => ({ rowNumber: index + 2, values: Object.fromEntries(headers.map((header, column) => [header, (cells[column] ?? "").trim()])) }));
}

export async function parseImportFile(contentBase64: string, format: DataImportFormatValue, type: DataImportTypeValue) {
  const buffer = strictBase64(contentBase64);
  const matrix = format === "CSV" ? csvMatrix(buffer) : await xlsxMatrix(buffer);
  const rows = rowsFromMatrix(matrix, type);
  return { buffer, rows };
}

export function groupInvoiceRows(rows: DataImportRow[]) {
  const groups = new Map<string, DataImportRow[]>();
  const errors: DataImportRowError[] = [];
  for (const row of rows) {
    const key = row.values.invoice_key?.trim() ?? "";
    if (!key) { errors.push({ row: row.rowNumber, column: "invoice_key", code: "REQUIRED" }); continue; }
    const existing = groups.get(key) ?? [];
    existing.push(row); groups.set(key, existing);
  }
  if (groups.size > MAX_INVOICES) throw new DataImportParseError("INVOICE_LIMIT_EXCEEDED");
  if (rows.length > MAX_INVOICE_LINES) throw new DataImportParseError("INVOICE_LINE_LIMIT_EXCEEDED");
  if ([...groups.values()].some((group) => group.length > MAX_LINES_PER_INVOICE)) throw new DataImportParseError("INVOICE_LINE_LIMIT_EXCEEDED");
  return { groups: [...groups].map(([key, groupedRows]): DataImportInvoiceGroup => ({ key, rows: groupedRows })), errors };
}
