import { snapshotHashMatches } from './print-archive.js';
import type { PrintSnapshot } from './print-types.js';
import type { RetailReceiptPreview, RetailReceiptStoredArchive } from './retail-receipt-types.js';

export const retailReceiptPermission = 'sales_invoices.print' as const;
export const RETAIL_RECEIPT_PERMISSION = retailReceiptPermission;
// Matches the POS checkout line bound. Never silently truncate a receipt.
export const RETAIL_RECEIPT_MAX_LINES = 50;
// Guard the complete original JSON before calling its recursive hash verifier.
// These are safety bounds, not a replacement PrintSnapshot schema: depth 32,
// 50,000 JSON values, and 2 Mi UTF-16 code units across strings and object keys.
const maxJsonDepth = 32, maxJsonValues = 50_000, maxJsonCharacters = 2 * 1024 * 1024;
const maxUnsignedBigInt = 18_446_744_073_709_551_615n;

export type RetailReceiptErrorReason = 'NOT_FOUND' | 'ARCHIVE_NOT_AVAILABLE'
  | 'ARCHIVE_INTEGRITY_FAILED' | 'RECEIPT_PREVIEW_UNSUPPORTED' | 'RECEIPT_PREVIEW_LIMIT_EXCEEDED';
export class RetailReceiptError extends Error {
  constructor(public readonly reason: RetailReceiptErrorReason) { super(reason); }
}

const unsupported = (): never => { throw new RetailReceiptError('RECEIPT_PREVIEW_UNSUPPORTED'); };
// Comparing the whole match avoids JavaScript's $ matching before a final newline.
const fullMatch = (pattern: RegExp, value: string) => pattern.exec(value)?.[0] === value;
const field = (value: Record<string, unknown>, key: string): unknown => Object.hasOwn(value, key) ? value[key] : undefined;
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return unsupported();
  return value as Record<string, unknown>;
};

function assertBoundedJson(source: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: source, depth: 0 }];
  let values = 0, characters = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++values > maxJsonValues || depth > maxJsonDepth) unsupported();
    if (typeof value === 'string') characters += value.length;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) unsupported(); }
    else if (value === null || typeof value === 'boolean') { /* JSON primitives. */ }
    else if (typeof value === 'object') {
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) unsupported();
      if (Object.getOwnPropertySymbols(value).length) unsupported();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors);
      if (keys.length + pending.length + values > maxJsonValues + (array ? 1 : 0)) unsupported();
      if (array && keys.length !== value.length + 1) unsupported();
      if (array) for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(descriptors, index)) unsupported();
      }
      for (const key of keys) {
        if (array && key === 'length') continue;
        const descriptor = descriptors[key]!;
        // Accessors and hidden properties are not database JSON. Reject before
        // reading them so the fields we project are also covered by the hash.
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) unsupported();
        if (!array) characters += key.length;
        pending.push({ value: descriptor.value as unknown, depth: depth + 1 });
      }
    } else unsupported();
    if (characters > maxJsonCharacters) unsupported();
  }
}

const text = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2048) return unsupported();
  return value;
};
const optionalText = (value: unknown): string | null => value == null ? null : text(value);
const decimalText = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 80 || !fullMatch(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u, value)) return unsupported();
  return value; // No conversion, rounding, grouping, arithmetic or trimming.
};
const positiveId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 20 || !fullMatch(/^[1-9]\d*$/u, value)
    || BigInt(value) > maxUnsignedBigInt) return unsupported();
  return value;
};
const lineNumber = (value: unknown): number => {
  // SalesInvoiceLine.lineNumber is an UnsignedSmallInt; it is not a money value.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) return unsupported();
  return value;
};
const archivedTimestamp = (value: unknown): string => {
  // Existing snapshot writers use Date.toISOString(): UTC with milliseconds.
  if (typeof value !== 'string' || value.length !== 24
    || !fullMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, value)) return unsupported();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return unsupported();
  return value;
};

export function projectRetailReceipt(
  archive: RetailReceiptStoredArchive,
  scope: { companyId: bigint; accountingDocumentId: bigint; salesInvoiceId: bigint },
): RetailReceiptPreview {
  const companyId = scope.companyId.toString(), documentId = scope.accountingDocumentId.toString();
  if (archive.companyId !== companyId || archive.accountingDocumentId !== documentId) throw new RetailReceiptError('NOT_FOUND');
  assertBoundedJson(archive.snapshot);
  const snapshot = record(archive.snapshot), company = record(field(snapshot, 'company')), document = record(field(snapshot, 'document'));
  if (field(company, 'id') !== companyId || field(document, 'id') !== documentId) throw new RetailReceiptError('NOT_FOUND');
  const archiveId = positiveId(archive.id);
  if (typeof archive.snapshotHash !== 'string' || !fullMatch(/^[a-f0-9]{64}$/u, archive.snapshotHash)) {
    throw new RetailReceiptError('ARCHIVE_INTEGRITY_FAILED');
  }
  // The existing verifier only serializes JSON. This narrow type bridge does not
  // claim a valid complete PrintSnapshot; pass the unchanged original object,
  // including fields intentionally omitted from the public receipt projection.
  if (!snapshotHashMatches(archive.snapshot as PrintSnapshot, archive.snapshotHash)) throw new RetailReceiptError('ARCHIVE_INTEGRITY_FAILED');
  if (field(snapshot, 'formatVersion') !== 1 || field(document, 'type') !== 'SALES_INVOICE'
    || field(document, 'statusAtArchive') !== 'POSTED' || field(snapshot, 'settlement') !== null) return unsupported();
  const invoice = record(field(snapshot, 'invoice')), lines = field(invoice, 'lines');
  if (!Array.isArray(lines)) return unsupported();
  if (!lines.length || lines.length > RETAIL_RECEIPT_MAX_LINES) throw new RetailReceiptError('RECEIPT_PREVIEW_LIMIT_EXCEEDED');
  return {
    source: { salesInvoiceId: positiveId(scope.salesInvoiceId.toString()), archiveId,
      archiveHash: archive.snapshotHash, archivedAt: archivedTimestamp(field(snapshot, 'archivedAt')) },
    company: { id: positiveId(companyId), name: text(field(company, 'name')) },
    document: { id: positiveId(documentId), type: 'SALES_INVOICE', number: text(field(document, 'number')),
      date: text(field(document, 'date')), statusAtArchive: 'POSTED' },
    invoice: {
      currencyCode: text(field(invoice, 'currencyCode')), subtotal: decimalText(field(invoice, 'subtotal')),
      discountTotal: decimalText(field(invoice, 'discountTotal')), taxTotal: decimalText(field(invoice, 'taxTotal')),
      total: decimalText(field(invoice, 'total')),
      lines: lines.map((value) => {
        const line = record(value);
        return {
          number: lineNumber(field(line, 'number')), itemCode: optionalText(field(line, 'itemCode')),
          itemName: optionalText(field(line, 'itemName')), unitOfMeasureCode: optionalText(field(line, 'unitOfMeasureCode')),
          description: text(field(line, 'description')), quantity: decimalText(field(line, 'quantity')),
          unitPrice: decimalText(field(line, 'unitPrice')), discount: decimalText(field(line, 'discount')),
          taxRate: decimalText(field(line, 'taxRate')), tax: decimalText(field(line, 'tax')), total: decimalText(field(line, 'total')),
        };
      }),
    },
    barcodeStatus: 'NOT_CAPTURED_IN_V1', pdfFormat: 'A4',
  };
}
