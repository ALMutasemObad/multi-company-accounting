import type { PrintTableCell } from "./print-table-row.js";

type DescriptionFields = {
  itemCode?: string | null | undefined;
  itemName?: string | null | undefined;
  unitOfMeasureCode?: string | null | undefined;
  description: string;
};
export type InvoiceDescriptionFont = "Arabic" | "ArabicLatin";
type DescriptionField = "itemCode" | "itemName" | "unitOfMeasureCode" | "description";
export type InvoiceDescriptionBlock = {
  field: DescriptionField;
  rawText: string;
  text: string;
  font: InvoiceDescriptionFont;
  start: number;
  contentEnd: number;
  end: number;
};
export type InvoiceDescription = { text: string; blocks: readonly InvoiceDescriptionBlock[] };
export type InvoiceDescriptionMetrics = {
  heightOfString: (text: string, font: InvoiceDescriptionFont) => number;
  draw: (text: string, font: InvoiceDescriptionFont, x: number, y: number) => void;
};
type DescriptionPiece = {
  field: DescriptionField;
  text: string;
  font: InvoiceDescriptionFont;
  y: number;
  height: number;
};
export type InvoiceDescriptionFragment = { start: number; end: number; height: number; pieces: readonly DescriptionPiece[] };
export type InvoiceDescriptionCell = PrintTableCell & {
  cursor: number;
  fragment: (text: string) => InvoiceDescriptionFragment;
  draw: (text: string, x: number, y: number) => void;
  advance: (consumed: number) => InvoiceDescriptionCell;
};

/** Only independently identified ASCII codes qualify; free text is never classified. */
export function prepareInvoiceDescription(
  fields: DescriptionFields, prepareArabic: (text: string) => string,
): InvoiceDescription | null {
  if (!fields.itemName) return null; // Preserve the existing archive visibility rule.
  const codes = [fields.itemCode, fields.unitOfMeasureCode].filter((code): code is string => code != null);
  if (!codes.length || codes.some((code) => code.length === 0 || /[^\x20-\x7e]/.test(code))) return null;

  const values: Array<Omit<InvoiceDescriptionBlock, "start" | "contentEnd" | "end">> = [];
  if (fields.itemCode != null) values.push({ field: "itemCode", rawText: fields.itemCode, text: fields.itemCode, font: "ArabicLatin" });
  values.push({ field: "itemName", rawText: fields.itemName, text: prepareArabic(fields.itemName), font: "Arabic" });
  if (fields.unitOfMeasureCode != null) values.push({ field: "unitOfMeasureCode", rawText: fields.unitOfMeasureCode, text: `(${fields.unitOfMeasureCode})`, font: "ArabicLatin" });
  values.push({ field: "description", rawText: fields.description, text: prepareArabic(fields.description), font: "Arabic" });

  // A synthetic newline owns one block gap, separate from any source newlines.
  // Its span belongs to the preceding block and is consumed exactly once by R3.
  const visible = values.filter((block) => block.text.length > 0);
  const blocks: InvoiceDescriptionBlock[] = [];
  let text = "";
  for (const [index, block] of visible.entries()) {
    const start = text.length;
    text += block.text;
    const contentEnd = text.length;
    if (index < visible.length - 1) text += "\n";
    blocks.push({ ...block, start, contentEnd, end: text.length });
  }
  return { text, blocks };
}

/** A fixed-cursor view: measurement probes cannot consume or relocate source text. */
export function createInvoiceDescriptionCell(
  description: InvoiceDescription, metrics: InvoiceDescriptionMetrics, cursor = 0,
): InvoiceDescriptionCell {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > description.text.length) throw new Error("Invalid invoice description cursor");
  const text = description.text.slice(cursor);
  let cached: InvoiceDescriptionFragment | undefined;
  const fragment = (prefix: string): InvoiceDescriptionFragment => {
    const end = cursor + prefix.length;
    if (end > description.text.length || description.text.slice(cursor, end) !== prefix) throw new Error("Invoice description range is not the pending prefix");
    if (cached?.end === end) return cached;
    const pieces: DescriptionPiece[] = [];
    let height = 0;
    for (const block of description.blocks) {
      const from = Math.max(cursor, block.start), to = Math.min(end, block.contentEnd);
      if (from < to) {
        const part = description.text.slice(from, to);
        const partHeight = metrics.heightOfString(part, block.font);
        pieces.push({ field: block.field, text: part, font: block.font, y: height, height: partHeight });
        height += partHeight;
      }
      if (block.end > block.contentEnd && cursor <= block.contentEnd && end > block.contentEnd) height += 2;
    }
    cached = { start: cursor, end, height, pieces };
    return cached;
  };
  return {
    text, cursor, splittable: true, fragment,
    measureHeight: (prefix) => fragment(prefix).height,
    draw: (prefix, x, y) => {
      for (const piece of fragment(prefix).pieces) metrics.draw(piece.text, piece.font, x, y + piece.y);
    },
    advance: (consumed) => {
      if (!Number.isInteger(consumed) || consumed < 0 || consumed > text.length) throw new Error("Invalid invoice description consumption");
      return createInvoiceDescriptionCell(description, metrics, cursor + consumed);
    },
  };
}
