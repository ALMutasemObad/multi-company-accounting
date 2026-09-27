import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { readSheet, type CellValue } from "read-excel-file/node";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { encodeBarcode } from "./barcode-codec.js";

export type CatalogImportInput = {
  contentBase64: string;
  sourceFormat: "CSV" | "XLSX";
  unitOfMeasureId: bigint;
};

export type CatalogImportRowError = { row: number; column: string; code: string };
type CatalogRow = {
  row: number;
  sourceKey: string;
  nameAr: string;
  author: string | null;
  publicationIdentifier: string | null;
  publicationYear: number | null;
  issueNumber: string | null;
  publisher: string | null;
  edition: string | null;
};

const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 500;
const HEADERS = ["source_key", "name_ar", "author", "publication_identifier", "publication_year", "issue_number", "publisher", "edition"] as const;
const LIMITS: Record<string, number> = {
  source_key: 120, name_ar: 200, author: 200, publication_identifier: 40,
  issue_number: 40, publisher: 200, edition: 120,
};

export class InventoryCatalogImportError extends Error {
  constructor(public readonly reason: string, public readonly errors: CatalogImportRowError[] = []) {
    super(reason);
  }
}

function decodeFile(contentBase64: string) {
  if (!contentBase64 || contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(contentBase64) || contentBase64.length % 4 !== 0) {
    throw new InventoryCatalogImportError("INVALID_FILE_ENCODING");
  }
  const file = Buffer.from(contentBase64, "base64");
  if (!file.length || file.length > MAX_BYTES || file.toString("base64") !== contentBase64) {
    throw new InventoryCatalogImportError(file.length > MAX_BYTES ? "FILE_TOO_LARGE" : "INVALID_FILE_ENCODING");
  }
  return file;
}

function assertSafeXlsx(file: Buffer) {
  if (file.length < 22 || file.readUInt32LE(0) !== 0x04034b50) throw new InventoryCatalogImportError("INVALID_XLSX");
  let end = -1;
  for (let offset = file.length - 22; offset >= Math.max(0, file.length - 65_557); offset -= 1) {
    if (file.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new InventoryCatalogImportError("INVALID_XLSX");
  const count = file.readUInt16LE(end + 10);
  const centralSize = file.readUInt32LE(end + 12);
  let offset = file.readUInt32LE(end + 16);
  if (count < 1 || count > 128 || offset + centralSize > end) throw new InventoryCatalogImportError("UNSAFE_XLSX_ARCHIVE");
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || file.readUInt32LE(offset) !== 0x02014b50) throw new InventoryCatalogImportError("INVALID_XLSX");
    const flags = file.readUInt16LE(offset + 8);
    const method = file.readUInt16LE(offset + 10);
    const size = file.readUInt32LE(offset + 24);
    const nameLength = file.readUInt16LE(offset + 28);
    const extraLength = file.readUInt16LE(offset + 30);
    const commentLength = file.readUInt16LE(offset + 32);
    const name = file.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || name.includes("..") || name.startsWith("/") || size > 4 * 1024 * 1024) {
      throw new InventoryCatalogImportError("UNSAFE_XLSX_ARCHIVE");
    }
    total += size;
    if (total > 8 * 1024 * 1024) throw new InventoryCatalogImportError("UNSAFE_XLSX_ARCHIVE");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(file)); }
  catch { throw new InventoryCatalogImportError("INVALID_XLSX"); }
  for (const [name, data] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/iu.test(name)) continue;
    const xml = Buffer.from(data).toString("utf8");
    if (/<f(?:\s|>)/iu.test(xml) || /<row\b[^>]*\bhidden\s*=\s*["'](?:1|true)["']/iu.test(xml)) {
      throw new InventoryCatalogImportError("UNSAFE_XLSX_CONTENT");
    }
  }
}

function cellText(value: CellValue<number> | null) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

async function matrixFromFile(file: Buffer, format: CatalogImportInput["sourceFormat"]): Promise<string[][]> {
  if (format === "CSV") {
    let decoded: string;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(file); }
    catch { throw new InventoryCatalogImportError("INVALID_UTF8"); }
    try {
      return parseCsv(decoded.replace(/^\uFEFF/u, ""), { bom: true, relax_quotes: false, skip_empty_lines: true }) as string[][];
    } catch { throw new InventoryCatalogImportError("INVALID_CSV"); }
  }
  assertSafeXlsx(file);
  try { return (await readSheet(file, 1)).map((row) => row.map(cellText)); }
  catch { throw new InventoryCatalogImportError("INVALID_XLSX"); }
}

export async function parseCatalogImportFile(input: CatalogImportInput) {
  const file = decodeFile(input.contentBase64);
  const matrix = (await matrixFromFile(file, input.sourceFormat)).filter((cells) => cells.some((cell) => cell.trim()));
  if (matrix.length < 2) throw new InventoryCatalogImportError("EMPTY_IMPORT_FILE");
  const headers = matrix[0]!.map((value) => value.trim().toLowerCase());
  const errors: CatalogImportRowError[] = [];
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) {
    throw new InventoryCatalogImportError("INVALID_HEADERS");
  }
  for (const header of ["source_key", "name_ar"]) if (!headers.includes(header)) errors.push({ row: 1, column: header, code: "MISSING_HEADER" });
  for (const header of headers) if (!HEADERS.includes(header as typeof HEADERS[number])) errors.push({ row: 1, column: header, code: "UNKNOWN_HEADER" });
  if (errors.length) throw new InventoryCatalogImportError("INVALID_HEADERS", errors);
  if (matrix.length - 1 > MAX_ROWS) throw new InventoryCatalogImportError("ROW_LIMIT_EXCEEDED");
  const seen = new Set<string>();
  const rows: CatalogRow[] = matrix.slice(1).map((cells, index) => {
    const row = index + 2;
    const values = Object.fromEntries(headers.map((key, column) => [key, (cells[column] ?? "").trim()]));
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim())) errors.push({ row, column: "*", code: "EXTRA_COLUMN" });
    for (const [column, length] of Object.entries(LIMITS)) {
      if ((values[column] ?? "").length > length) errors.push({ row, column, code: "TOO_LONG" });
    }
    for (const column of ["source_key", "name_ar"]) if (!values[column]) errors.push({ row, column, code: "REQUIRED" });
    const sourceKey = values.source_key ?? "";
    if (sourceKey) {
      if (seen.has(sourceKey)) errors.push({ row, column: "source_key", code: "DUPLICATE_SOURCE_KEY" });
      seen.add(sourceKey);
    }
    const year = values.publication_year ?? "";
    if (year && (!/^[1-9][0-9]{0,3}$/u.test(year) || Number(year) > 9999)) errors.push({ row, column: "publication_year", code: "INVALID_YEAR" });
    const optional = (column: string) => values[column] || null;
    return {
      row, sourceKey, nameAr: values.name_ar ?? "", author: optional("author"),
      publicationIdentifier: optional("publication_identifier"), publicationYear: /^[1-9][0-9]{0,3}$/u.test(year) ? Number(year) : null,
      issueNumber: optional("issue_number"), publisher: optional("publisher"), edition: optional("edition"),
    };
  });
  return { file, rows, errors };
}

export class InventoryCatalogImportService {
  private readonly transactions: TransactionExecutor;
  constructor(private readonly prisma: PrismaClient) { this.transactions = new TransactionExecutor(prisma); }

  private previewHash(context: ActorContext, input: CatalogImportInput, file: Buffer) {
    return createHash("sha256").update(context.companyId.toString()).update(":")
      .update(input.unitOfMeasureId.toString()).update(":").update(input.sourceFormat).update(":").update(file).digest("hex");
  }

  private async requireUnit(client: PrismaClient | Prisma.TransactionClient, context: ActorContext, unitOfMeasureId: bigint) {
    const unit = await client.unitOfMeasure.findFirst({ where: { id: unitOfMeasureId, companyId: context.companyId, isActive: true }, select: { id: true } });
    if (!unit) throw new InventoryCatalogImportError("INVALID_UNIT_OF_MEASURE");
  }

  async preview(context: ActorContext, input: CatalogImportInput) {
    const parsed = await parseCatalogImportFile(input);
    await this.requireUnit(this.prisma, context, input.unitOfMeasureId);
    const existing = await this.prisma.inventoryItem.findMany({
      where: { companyId: context.companyId, importSourceKey: { in: parsed.rows.map((row) => row.sourceKey).filter(Boolean) } },
      select: { importSourceKey: true },
    });
    const keys = new Set(existing.map((item) => item.importSourceKey));
    const badRows = new Set(parsed.errors.map((error) => error.row));
    const rows = parsed.rows.map((row) => ({
      row: row.row, sourceKey: row.sourceKey, nameAr: row.nameAr,
      status: badRows.has(row.row) ? "ERROR" as const : keys.has(row.sourceKey) ? "SKIP" as const : "CREATE" as const,
    }));
    return {
      previewHash: this.previewHash(context, input, parsed.file), rowCount: rows.length,
      createCount: rows.filter((row) => row.status === "CREATE").length,
      skipCount: rows.filter((row) => row.status === "SKIP").length,
      errors: parsed.errors, rows,
    };
  }

  async commit(context: ActorContext, input: CatalogImportInput, previewHash: string) {
    const parsed = await parseCatalogImportFile(input);
    if (this.previewHash(context, input, parsed.file) !== previewHash) throw new InventoryCatalogImportError("PREVIEW_MISMATCH");
    if (parsed.errors.length) throw new InventoryCatalogImportError("ROW_VALIDATION_FAILED", parsed.errors);
    try {
      // Each row reserves a code and writes an item, primary barcode, and audit event.
      // A full 500-row import therefore needs a longer transaction window.
      return await this.transactions.execute({
        operation: "IMPORT_INVENTORY_CATALOG", companyId: context.companyId,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        deadlineMs: 120_000, timeoutMs: 120_000,
      }, async (tx) => {
        await this.requireUnit(tx, context, input.unitOfMeasureId);
        const existing = await tx.inventoryItem.findMany({
          where: { companyId: context.companyId, importSourceKey: { in: parsed.rows.map((row) => row.sourceKey) } },
          select: { importSourceKey: true },
        });
        const existingKeys = new Set(existing.map((item) => item.importSourceKey));
        let created = 0;
        let skipped = 0;
        for (const row of parsed.rows) {
          if (existingKeys.has(row.sourceKey)) { skipped += 1; continue; }
          let code: string | undefined;
          let barcode: string | undefined;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const candidate = await reserveMasterDataCode(tx, context.companyId, "INVENTORY_ITEM");
            const value = `BK-${candidate.slice(4)}`;
            const [itemTaken, barcodeTaken] = await Promise.all([
              tx.inventoryItem.findFirst({ where: { companyId: context.companyId, code: candidate }, select: { id: true } }),
              tx.inventoryItemBarcode.findFirst({ where: { companyId: context.companyId, normalizedValue: value }, select: { id: true } }),
            ]);
            if (!itemTaken && !barcodeTaken) { code = candidate; barcode = value; break; }
          }
          if (!code || !barcode) throw new InventoryCatalogImportError("ITEM_CODE_EXHAUSTED");
          const item = await tx.inventoryItem.create({ data: {
            companyId: context.companyId, unitOfMeasureId: input.unitOfMeasureId, code,
            importSourceKey: row.sourceKey, nameAr: row.nameAr, author: row.author,
            publicationIdentifier: row.publicationIdentifier, publicationYear: row.publicationYear,
            issueNumber: row.issueNumber, publisher: row.publisher, edition: row.edition,
          } });
          const encoded = encodeBarcode("CODE_128", barcode);
          await tx.inventoryItemBarcode.create({ data: {
            companyId: context.companyId, inventoryItemId: item.id, symbology: encoded.symbology,
            value: encoded.value, normalizedValue: encoded.normalizedValue,
            isPrimary: true, primaryInventoryItemId: item.id,
          } });
          await appendAudit(tx, { data: {
            companyId: context.companyId, actorUserId: context.userId, action: "INVENTORY_ITEM_IMPORTED",
            entityType: "INVENTORY_ITEM", entityId: String(item.id),
            details: { sourceKey: row.sourceKey, row: row.row, code },
          } });
          created += 1;
        }
        await appendAudit(tx, { data: {
          companyId: context.companyId, actorUserId: context.userId, action: "INVENTORY_CATALOG_IMPORTED",
          entityType: "INVENTORY_CATALOG", entityId: previewHash,
          details: { rowCount: parsed.rows.length, created, skipped },
        } });
        return { created, skipped };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new InventoryCatalogImportError("CONCURRENT_IMPORT_CONFLICT");
      }
      throw error;
    }
  }
}
