import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "../src/printing/pdf-renderer.js";
import {
  pdfInvoiceCodeMoney, pdfInvoiceCodesContinuationSnapshot, pdfInvoiceCodesLimitsSnapshot,
  pdfInvoiceEmptyCodeSnapshot, pdfInvoiceItemCode, pdfInvoiceMissingItemNameSnapshot,
  pdfInvoiceNonAsciiCodeSnapshot, pdfInvoiceSingleCodeSnapshot, pdfInvoiceUnitCode,
} from "./fixtures/pdf-invoice-item-codes.js";

type Font = {
  id: number; name: string; cid: boolean; itemCodes: boolean;
  unicode: Map<number, string>; cmapErrors: Map<number, string>;
  widths: number[]; ascent: number; descent: number;
};
type TextRun = { text: string | null; page: number; packet: number; x: number; y: number; width: number; size: number; font: Font };
type Rectangle = { x: number; y: number; width: number; height: number };
type Page = { height: number; rectangles: Rectangle[]; text: TextRun[] };

function required<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

// Deliberately limited to PDFKit's unencrypted classic-xref output. Object offsets
// and stream lengths prevent compressed bytes from being mistaken for PDF syntax.
function readObjects(pdf: Buffer): Map<number, string> {
  const source = pdf.toString("latin1");
  const offset = Number(required(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(source)?.[1], "Missing classic xref"));
  const xref = source.slice(offset);
  const header = required(/^xref\r?\n0 (\d+)\r?\n/.exec(xref), "Unsupported xref format");
  const lines = xref.slice(header[0].length).split(/\r?\n/);
  const entries: Array<{ id: number; offset: number }> = [];
  for (let id = 0; id < Number(header[1]); id++) {
    const entry = required(/^(\d{10}) (\d{5}) ([nf])/.exec(lines[id] ?? ""), "Invalid xref entry");
    if (entry[3] === "n") {
      if (entry[2] !== "00000") throw new Error("Unsupported object generation");
      entries.push({ id, offset: Number(entry[1]) });
    }
  }
  entries.sort((a, b) => a.offset - b.offset);
  return new Map(entries.map((entry, index) => {
    const object = source.slice(entry.offset, entries[index + 1]?.offset ?? offset);
    const prefix = required(new RegExp(`^${entry.id} 0 obj\\r?\\n`).exec(object), "Invalid object offset");
    if (!/\r?\nendobj\s*$/.test(object)) throw new Error("Unterminated PDF object");
    return [entry.id, object.slice(prefix[0].length).replace(/\r?\nendobj\s*$/, "")] as const;
  }));
}

function readStream(body: string): string {
  const stream = required(/\bstream\r?\n/.exec(body), "Missing PDF stream");
  const dictionary = body.slice(0, stream.index);
  const length = required(/\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dictionary), "Missing stream length");
  if (length[2]) throw new Error("Unsupported indirect stream length");
  const start = stream.index + stream[0].length;
  const bytes = Buffer.from(body.slice(start, start + Number(length[1])), "latin1");
  if (/\/Filter\s*\/FlateDecode\b/.test(dictionary)) return inflateSync(bytes).toString("latin1");
  if (/\/Filter\b/.test(dictionary)) throw new Error("Unsupported stream filter");
  return bytes.toString("latin1");
}

function unicodeString(hex: string): string {
  const compact = hex.replace(/\s/g, "");
  if (!/^(?:[\da-f]{4})*$/i.test(compact)) throw new Error("Invalid UTF-16BE ToUnicode value");
  // Preserve UTF-16 surrogate pairs; source character codes are not Unicode.
  return (compact.match(/.{4}/g) ?? []).map((unit) => String.fromCharCode(parseInt(unit, 16))).join("");
}

function readCmap(body: string): { unicode: Map<number, string>; errors: Map<number, string> } {
  const source = readStream(body);
  if (!/begincodespacerange\s*<0000>\s*<ffff>/i.test(source)) throw new Error("Expected Identity-H code space");
  const result = new Map<number, string>();
  const errors = new Map<number, string>();
  const record = (cid: number, raw: string) => {
    try { result.set(cid, unicodeString(raw)); }
    catch { errors.set(cid, raw); }
  };
  // PDFKit emits bfrange arrays, including mappings with several UTF-16 units.
  for (const block of source.matchAll(/beginbfrange\s*([\s\S]*?)\s*endbfrange/g)) {
    for (const range of block[1]!.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*\[([^\]]*)\]/gi)) {
      const first = parseInt(range[1]!, 16), last = parseInt(range[2]!, 16);
      // Capture every destination, even malformed inherited Arabic values. A
      // hex-only matcher would skip one and silently shift all following CIDs.
      const values = [...range[3]!.matchAll(/<([^>]*)>/g)];
      if (values.length !== last - first + 1) {
        for (let cid = first; cid <= last; cid++) errors.set(cid, "Incomplete ToUnicode range");
      } else values.forEach((value, index) => record(first + index, value[1]!));
    }
  }
  for (const block of source.matchAll(/beginbfchar\s*([\s\S]*?)\s*endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([\da-f]+)>\s*<([^>]*)>/gi)) {
      record(parseInt(pair[1]!, 16), pair[2]!);
    }
  }
  if (!result.size && !errors.size) throw new Error("Unsupported or empty ToUnicode map");
  return { unicode: result, errors };
}

function inspectPdf(pdf: Buffer): Page[] {
  const objects = readObjects(pdf);
  const get = (id: number) => required(objects.get(id), `Missing PDF object ${id}`);
  const ref = (body: string, name: string) => Number(required(new RegExp(`/${name}\\s+(\\d+) 0 R`).exec(body)?.[1], `Missing ${name} reference`));
  const references = (body: string) => [...body.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  const fonts = new Map<number, Font>();
  for (const [id, body] of objects) {
    if (!/\/Type\s*\/Font\b/.test(body) || !/\/Subtype\s*\/(Type0|Type1)\b/.test(body)) continue;
    const name = required(/\/BaseFont\s*\/([^\s/]+)/.exec(body)?.[1], "Missing BaseFont");
    const cid = /\/Subtype\s*\/Type0\b/.test(body);
    if (!cid) {
      fonts.set(id, { id, name, cid, itemCodes: false, unicode: new Map(), cmapErrors: new Map(), widths: [], ascent: 718, descent: -207 });
      continue;
    }
    if (!/\/Encoding\s*\/Identity-H\b/.test(body)) throw new Error("Unsupported CID encoding");
    const { unicode, errors } = readCmap(get(ref(body, "ToUnicode")));
    const descendant = get(Number(required(/\/DescendantFonts\s*\[\s*(\d+) 0 R/.exec(body)?.[1], "Missing descendant font")));
    const descriptor = get(ref(descendant, "FontDescriptor"));
    const widths = required(/\/W\s*\[\s*0\s*\[([^\]]*)\]\s*\]/.exec(descendant)?.[1], "Unsupported CID widths")
      .trim().split(/\s+/).map(Number);
    const values = [...unicode.values()].join("");
    // Both subsets may have the same PostScript name. Identify actual Latin
    // coverage as well; never assume a fixed F-number, CID, or subset prefix.
    const hasAsciiLetter = [...unicode].some(([code, value]) => code > 0 && !/[^\x20-\x7e]/.test(value) && /[A-Za-z]/.test(value));
    const itemCodes = /NotoSansArabic/i.test(name) && hasAsciiLetter
      && !/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(values);
    if (itemCodes && errors.size) throw new Error("Malformed ToUnicode mapping in structured-code font");
    // Inherited Arabic mapping errors are retained for diagnosis, not asserted or
    // interpreted as Arabic text. Only the selected Latin face is decoded strictly.
    fonts.set(id, {
      id, name, cid, itemCodes, unicode, cmapErrors: errors, widths,
      ascent: Number(required(/\/Ascent\s+([-\d.]+)/.exec(descriptor)?.[1], "Missing ascent")),
      descent: Number(required(/\/Descent\s+([-\d.]+)/.exec(descriptor)?.[1], "Missing descent")),
    });
  }
  const catalog = required([...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body)), "Missing catalog");
  const pageIds: number[] = [];
  const walk = (id: number): void => {
    const body = get(id);
    if (/\/Type\s*\/Page\b/.test(body)) pageIds.push(id);
    else references(required(/\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1], "Missing page tree kids")).forEach(walk);
  };
  walk(ref(catalog, "Pages"));
  return pageIds.map((id, pageIndex) => {
    const body = get(id), resources = get(ref(body, "Resources"));
    const fontReferences = required(/\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1], "Missing page font resources");
    const pageFonts = new Map([...fontReferences.matchAll(/\/(\S+)\s+(\d+) 0 R/g)]
      .map((match) => [match[1]!, required(fonts.get(Number(match[2])), "Unknown page font")]));
    const height = Number(required(/\/MediaBox\s*\[\s*0\s+0\s+[\d.]+\s+([\d.]+)\s*\]/.exec(body)?.[1], "Missing page MediaBox"));
    const contents = required(/\/Contents\s*((?:\d+ 0 R)|(?:\[[^\]]*\]))/.exec(body)?.[1], "Missing page contents");
    const content = references(contents).map((contentId) => readStream(get(contentId))).join("\n");
    const rectangles = [...content.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\b/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }));
    const page: Page = { height, rectangles, text: [] };
    let packetOrdinal = 0;
    for (const packet of content.matchAll(/BT\s+([\s\S]*?)\s+ET/g)) {
      const packetId = packetOrdinal++;
      let x = 0, y = 0, size = 0;
      let font: Font | undefined;
      const operations = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm|\/(\S+) ([\d.]+) Tf|\[([^\]]*)\]\s*TJ/g;
      for (const operation of packet[1]!.matchAll(operations)) {
        if (operation[1] !== undefined) { x = Number(operation[1]); y = Number(operation[2]); continue; }
        if (operation[3] !== undefined) { font = required(pageFonts.get(operation[3]), "Unbound font resource"); size = Number(operation[4]); continue; }
        const active = required(font, "Text shown before font selection");
        let text = "", advance = 0;
        const canDecode = active.itemCodes || (!active.cid && /^Helvetica(?:-Bold)?$/.test(active.name));
        for (const value of operation[5]!.matchAll(/<([\da-f\s]*)>|(-?(?:\d+(?:\.\d*)?|\.\d+))/gi)) {
          if (value[1] === undefined) { advance -= Number(value[2]); continue; }
          const hex = value[1].replace(/\s/g, "");
          if (active.cid) {
            if (hex.length % 4) throw new Error("Unaligned Identity-H text");
            for (const unit of hex.match(/.{4}/g) ?? []) {
              const code = parseInt(unit, 16);
              if (active.itemCodes && code === 0) throw new Error("Structured code used .notdef CID 0");
              advance += required(active.widths[code], "Missing CID advance");
              if (canDecode) {
                const value = required(active.unicode.get(code), "Unmapped CID in actual output");
                if (!value || /[^\x20-\x7e]/.test(value)) throw new Error("Non-ASCII mapping in structured code output");
                text += value;
              }
            }
          } else if (canDecode) text += Buffer.from(hex, "hex").toString("latin1");
        }
        const width = advance * size / 1000;
        page.text.push({ text: canDecode ? text : null, x, y, width, size, font: active, page: pageIndex, packet: packetId });
        x += width;
      }
    }
    return page;
  });
}

const codeRuns = (pages: Page[]) => pages.flatMap((page) => page.text).filter((run) => run.font.itemCodes);

function expectMoneyOnce(pages: Page[]): void {
  const text = pages.flatMap((page) => page.text).filter((run) => !run.font.cid).map((run) => run.text);
  for (const amount of pdfInvoiceCodeMoney) expect(text.filter((value) => value === amount)).toHaveLength(1);
}

function containingCell(pages: Page[], run: TextRun): Rectangle | undefined {
  const page = pages[run.page]!;
  const top = page.height - run.y - run.font.ascent * run.size / 1000;
  const bottom = page.height - run.y - run.font.descent * run.size / 1000;
  return page.rectangles.find((rectangle) => rectangle.y >= 52 && rectangle.width < 511
    && run.x >= rectangle.x + 2.9 && run.x + run.width <= rectangle.x + rectangle.width - 2.9
    && top >= rectangle.y - 0.1 && bottom <= rectangle.y + rectangle.height + 0.1);
}

function expectCodesInsideCells(pages: Page[], runs: TextRun[]): void {
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) {
    expect(run.font.cid).toBe(true);
    expect(run.font.name).toMatch(/NotoSansArabic/i);
    expect(run.size).toBe(7);
    const page = pages[run.page]!;
    const bottom = page.height - run.y - run.font.descent * run.size / 1000;
    expect(containingCell(pages, run), `Code fragment escaped its cell on page ${run.page + 1}: ${run.text}`).toBeDefined();
    expect(bottom).toBeLessThanOrEqual(755.1);
  }
}

describe("archived invoice structured ASCII item codes in actual PDF", () => {
  it("decodes both schema-limit codes from their embedded font, preserving order, digits and wrapping", async () => {
    const snapshot = pdfInvoiceCodesLimitsSnapshot(), before = structuredClone(snapshot);
    expect(pdfInvoiceItemCode).toHaveLength(40);
    expect(pdfInvoiceUnitCode).toHaveLength(20);
    const pages = inspectPdf(await renderDocumentPdf(snapshot)), runs = codeRuns(pages);
    expect(runs.map((run) => run.text).join("")).toBe(`${pdfInvoiceItemCode}(${pdfInvoiceUnitCode})`);
    // Each code has wide characters and must actually wrap in the column narrowed
    // by DECIMAL limits. Count page/baseline positions, not PDFKit TJ subdivisions.
    let consumed = 0;
    const itemLines = new Set<string>(), unitLines = new Set<string>();
    for (const run of runs) {
      const start = consumed;
      consumed += run.text!.length;
      if (start < pdfInvoiceItemCode.length) itemLines.add(`${run.page}:${run.y}`);
      if (consumed > pdfInvoiceItemCode.length) unitLines.add(`${run.page}:${run.y}`);
    }
    expect(itemLines.size).toBeGreaterThan(1);
    expect(unitLines.size).toBeGreaterThan(1);
    expectCodesInsideCells(pages, runs);
    expectMoneyOnce(pages);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it("preserves code cursors, table bounds and single money output through name and description continuation", async () => {
    const snapshot = pdfInvoiceCodesContinuationSnapshot(), before = structuredClone(snapshot);
    expect(snapshot.invoice!.lines[0]!.itemName).toHaveLength(200);
    expect(snapshot.invoice!.lines[0]!.description).toHaveLength(499);
    const pages = inspectPdf(await renderDocumentPdf(snapshot)), runs = codeRuns(pages);
    expect(pages.length).toBeGreaterThan(2);
    expect(runs.map((run) => run.text).join("")).toBe(`${pdfInvoiceItemCode}(${pdfInvoiceUnitCode})`);
    const unitIndex = runs.findIndex((run) => run.text!.includes("("));
    expect(unitIndex).toBeGreaterThan(0);
    const itemEnd = runs[unitIndex - 1]!, unitStart = runs[unitIndex]!, unitEnd = runs[runs.length - 1]!;
    expect(unitStart.page).toBeGreaterThan(runs[0]!.page);
    const nextRow = pages.flatMap((page) => page.text).find((run) => !run.font.cid && run.text === "6.6666")!;
    expect(nextRow).toBeDefined();
    expect(nextRow.page).toBeGreaterThan(unitStart.page);
    const descriptionCell = required(containingCell(pages, runs[0]!), "Missing description cell");
    const precedes = (a: TextRun, b: TextRun) => a.page < b.page || (a.page === b.page && a.y > b.y + 0.01);
    const body = pages.flatMap((page) => page.text).filter((run) => run.size === 7 && run.font.cid
      && !run.font.itemCodes && !/Bold/i.test(run.font.name)
      && run.x >= descriptionCell.x && run.x < descriptionCell.x + descriptionCell.width);
    const nameLines = body.filter((run) => precedes(itemEnd, run) && precedes(run, unitStart));
    const descriptionLines = body.filter((run) => precedes(unitEnd, run) && precedes(run, nextRow));
    // PDFKit opens one BT packet per rendered line. Glyph positioning can emit
    // multiple Tm/Y values inside that packet, even without source diacritics.
    // Keep actual glyph Y for bounds; count packets without decoding Arabic.
    const lineCount = (runs: TextRun[]) => new Set(runs.map((run) => `${run.page}:${run.packet}`)).size;
    expect(lineCount(nameLines)).toBe(50);
    expect(lineCount(descriptionLines)).toBe(125);
    expect(descriptionLines.some((run) => run.page > unitStart.page)).toBe(true);
    for (const run of [...nameLines, ...descriptionLines]) {
      expect(containingCell(pages, run), `Arabic baseline escaped its cell on page ${run.page + 1}`).toBeDefined();
      expect(pages[run.page]!.height - run.y - run.font.descent * run.size / 1000).toBeLessThanOrEqual(755.1);
    }
    for (const page of pages.slice(runs[0]!.page, nextRow.page + 1)) {
      expect(page.rectangles.some((rectangle) => rectangle.x === 42 && rectangle.width === 511 && rectangle.height === 24)).toBe(true);
    }
    expectCodesInsideCells(pages, runs);
    expectMoneyOnce(pages);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it("renders one present printable code without inventing the missing item code", async () => {
    const snapshot = pdfInvoiceSingleCodeSnapshot(), before = structuredClone(snapshot);
    const pages = inspectPdf(await renderDocumentPdf(snapshot)), runs = codeRuns(pages);
    expect(runs.map((run) => run.text).join("")).toBe("(U_9073-26)");
    expectCodesInsideCells(pages, runs);
    expectMoneyOnce(pages);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it.each([
    ["a non-ASCII code", pdfInvoiceNonAsciiCodeSnapshot],
    ["an empty present code", pdfInvoiceEmptyCodeSnapshot],
    ["an absent item name", pdfInvoiceMissingItemNameSnapshot],
  ] as const)("keeps the whole description on the legacy path for %s", async (_name, create) => {
    const snapshot = create(), before = structuredClone(snapshot);
    const pages = inspectPdf(await renderDocumentPdf(snapshot));
    expect(codeRuns(pages)).toHaveLength(0);
    expectMoneyOnce(pages);
    expect(snapshot).toEqual(before);
  }, 30_000);
});
