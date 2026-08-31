import { describe, expect, it } from "vitest";
import { createInvoiceDescriptionCell, prepareInvoiceDescription, type InvoiceDescriptionFont, type InvoiceDescriptionMetrics } from "../src/printing/print-invoice-description.js";
import { takePrintTableFragment, type PrintTableCell } from "../src/printing/print-table-row.js";

const fields = { itemCode: "ITM-012345", itemName: "اسم", unitOfMeasureCode: "UNIT-98", description: "وصف" };
const unchanged = (text: string) => text;

// Deliberately different font heights and a narrow wrap width expose stale cursors
// and measuring a Latin continuation with the preceding Arabic block's metrics.
function metrics(width = 4) {
  const measured: Array<{ text: string; font: InvoiceDescriptionFont }> = [];
  const drawn: Array<{ text: string; font: InvoiceDescriptionFont; x: number; y: number }> = [];
  const value: InvoiceDescriptionMetrics = {
    heightOfString: (text, font) => {
      measured.push({ text, font });
      return text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / width)), 0) * (font === "Arabic" ? 10 : 6);
    },
    draw: (text, font, x, y) => { drawn.push({ text, font, x, y }); },
  };
  return { value, measured, drawn };
}

describe("independent ASCII invoice description blocks", () => {
  it("preserves raw code characters and field identity, preparing free text only once", () => {
    const source = { ...fields, itemCode: " ITM-a_0123 ", unitOfMeasureCode: " unit-98 " };
    const before = structuredClone(source);
    const transformed: string[] = [];
    const description = prepareInvoiceDescription(source, (text) => { transformed.push(text); return `${text}!`; })!;
    expect(transformed).toEqual([source.itemName, source.description]);
    expect(description.blocks.map((block) => [block.field, block.rawText, block.text, block.font])).toEqual([
      ["itemCode", source.itemCode, source.itemCode, "ArabicLatin"],
      ["itemName", source.itemName, `${source.itemName}!`, "Arabic"],
      ["unitOfMeasureCode", source.unitOfMeasureCode, `(${source.unitOfMeasureCode})`, "ArabicLatin"],
      ["description", source.description, `${source.description}!`, "Arabic"],
    ]);
    expect(description.text).toBe(" ITM-a_0123 \nاسم!\n( unit-98 )\nوصف!");
    expect(source).toEqual(before);
  });

  it.each([
    { itemName: undefined }, { itemName: null }, { itemName: "" },
    { itemCode: undefined, unitOfMeasureCode: null },
    { itemCode: "" }, { unitOfMeasureCode: "" },
    { itemCode: "ITM-صنف" }, { unitOfMeasureCode: "UNIT-وحدة" },
    { itemCode: "ITM-1\nX" }, { unitOfMeasureCode: "UNIT-1\tX" },
    { itemCode: "ITM-\u007f" }, { unitOfMeasureCode: "UNIT-\u00a0" },
    { itemCode: "ITM-12\n" }, { unitOfMeasureCode: "UNIT-12\r" },
    { itemCode: "ITM-12\u2028" },
  ])("leaves the whole legacy description untouched for ineligible fields %j", (override) => {
    let calls = 0;
    const result = prepareInvoiceDescription({ ...fields, ...override }, (text) => { calls++; return text; });
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it.each(["itemCode", "unitOfMeasureCode"] as const)("accepts only %s without inventing the absent code", (present) => {
    const description = prepareInvoiceDescription({ ...fields, itemCode: undefined, unitOfMeasureCode: null, [present]: fields[present] }, unchanged)!;
    expect(description.blocks.filter((block) => block.font === "ArabicLatin").map((block) => block.field)).toEqual([present]);
    expect(description.text.endsWith("\n")).toBe(false);
  });

  it("does not classify or repair mixed free text as part of the ASCII-code branch", () => {
    const description = prepareInvoiceDescription({ ...fields, itemName: "شركة ACME", description: "ACME شركة" }, unchanged)!;
    expect(description.blocks.filter((block) => block.font === "Arabic").map((block) => block.text)).toEqual(["شركة ACME", "ACME شركة"]);
  });

  it("uses the measured range plan unchanged for drawing after other prefix probes", () => {
    const description = prepareInvoiceDescription(fields, unchanged)!;
    const trace = metrics();
    const cell = createInvoiceDescriptionCell(description, trace.value);
    cell.measureHeight(cell.text.slice(0, 3));
    cell.measureHeight(cell.text);
    const prefix = cell.text.slice(0, description.blocks[2]!.contentEnd - 2);
    const height = cell.measureHeight(prefix);
    const plan = cell.fragment(prefix);
    const count = trace.measured.length;
    cell.draw(prefix, 100, 200);
    expect(trace.measured).toHaveLength(count);
    expect(height).toBe(plan.height);
    expect(trace.drawn).toEqual(plan.pieces.map((piece) => ({ text: piece.text, font: piece.font, x: 100, y: 200 + piece.y })));
    expect(cell.cursor).toBe(0);
    expect(cell.text).toBe(description.text);
  });

  it("consumes each separator and each field character once for cuts on either side of every boundary", () => {
    const description = prepareInvoiceDescription(fields, unchanged)!;
    const trace = metrics();
    const cell = createInvoiceDescriptionCell(description, trace.value);
    const complete = cell.fragment(cell.text);
    const content = complete.pieces.map((piece) => piece.text).join("");
    for (let cut = 0; cut <= description.text.length; cut++) {
      const left = cell.fragment(cell.text.slice(0, cut));
      const next = cell.advance(cut);
      const right = next.fragment(next.text);
      expect([...left.pieces, ...right.pieces].map((piece) => piece.text).join("")).toBe(content);
      const gaps = [left, right].reduce((sum, plan) => sum + plan.height - plan.pieces.reduce((height, piece) => height + piece.height, 0), 0);
      expect(gaps).toBe(6); // Three separator spans, each with one 2pt gap.
      expect(next.cursor).toBe(cut);
      expect(next.text).toBe(description.text.slice(cut));
    }
  });

  it("retains the field/font when identical substrings occur in different blocks", () => {
    const description = prepareInvoiceDescription({ itemCode: "A", itemName: "A", unitOfMeasureCode: "A", description: "A" }, unchanged)!;
    const trace = metrics();
    const cell = createInvoiceDescriptionCell(description, trace.value);
    for (const block of description.blocks) {
      const next = cell.advance(block.start);
      expect(next.fragment(block.text).pieces.map((piece) => [piece.field, piece.font, piece.text])).toEqual([[block.field, block.font, block.text]]);
    }
  });

  it("retains source blank lines without turning them into synthetic block separators", () => {
    const description = prepareInvoiceDescription({ ...fields, itemName: "اسم\n\n", description: "\nوصف\n" }, unchanged)!;
    const trace = metrics();
    const cell = createInvoiceDescriptionCell(description, trace.value);
    expect(cell.fragment(cell.text).pieces.filter((piece) => piece.font === "Arabic").map((piece) => piece.text)).toEqual(["اسم\n\n", "\nوصف\n"]);
    const gaps = cell.measureHeight(cell.text) - cell.fragment(cell.text).pieces.reduce((sum, piece) => sum + piece.height, 0);
    expect(gaps).toBe(6);
  });

  it("continues through a code, separator and Arabic using unmodified R3 fragmentation without repeating money", () => {
    const description = prepareInvoiceDescription(fields, unchanged)!;
    const trace = metrics();
    let cell = createInvoiceDescriptionCell(description, trace.value);
    let amount: PrintTableCell = { text: "9.99", splittable: false, measureHeight: () => 8 };
    const consumed: string[] = [], money: string[] = [];
    for (let page = 0; cell.text && page < description.text.length; page++) {
      const before = cell.text.length;
      const fragment = takePrintTableFragment([amount, cell], 28, 28)!;
      expect(fragment).not.toBeNull();
      expect(fragment.height).toBeLessThanOrEqual(28);
      const prefix = fragment.texts[1]!;
      if (page === 0) expect(prefix.length).toBeLessThan(fields.itemCode.length); // Cut inside code, not an atomic description.
      cell.draw(prefix, 0, 0);
      consumed.push(prefix);
      if (fragment.texts[0]) money.push(fragment.texts[0]);
      cell = cell.advance(prefix.length);
      amount = { ...amount, text: fragment.remainder[0]! };
      expect(cell.text).toBe(fragment.remainder[1]);
      expect(cell.text.length).toBeLessThan(before);
    }
    expect(cell.text).toBe("");
    expect(consumed.join("")).toBe(description.text);
    expect(trace.drawn.filter((piece) => piece.font === "ArabicLatin").map((piece) => piece.text).join("")).toBe(`${fields.itemCode}(${fields.unitOfMeasureCode})`);
    expect(trace.drawn.filter((piece) => piece.font === "Arabic").map((piece) => piece.text).join("")).toBe(fields.itemName + fields.description);
    expect(money).toEqual(["9.99"]);
  });
});
