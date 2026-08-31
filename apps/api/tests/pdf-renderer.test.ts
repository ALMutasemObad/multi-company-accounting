import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { renderDocumentPdf } from "../src/printing/pdf-renderer.js";
import { printSnapshotFixture } from "./fixtures/print-snapshot.js";
import { longPdfDecimalSnapshot, multilineAccountCodeSnapshot, multilinePdfRowSnapshot, pdfDecimalSnapshot, pdfDocumentTypes } from "./fixtures/pdf-decimal-snapshots.js";

// Read actual PDFKit output text runs (Helvetica/WinAnsi money), not calls to text().
// Arabic uses an embedded CID font and is checked by the separate rendered-PDF QA.
function pdfLatinTextRuns(pdf: Buffer): string[] {
  const source = pdf.toString("latin1");
  const result: string[] = [];
  for (const stream of source.matchAll(/<<\s*\/Length (\d+)\s*\/Filter \/FlateDecode\s*>>\s*stream\r?\n/g)) {
    const start = stream.index! + stream[0].length;
    const content = inflateSync(pdf.subarray(start, start + parseInt(stream[1]!, 10))).toString("latin1");
    for (const run of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      result.push([...run[1]!.matchAll(/<([0-9a-f]+)>/gi)]
        .map((hex) => Buffer.from(hex[1]!, "hex").toString("latin1")).join(""));
    }
  }
  return result;
}

// PDFKit emits one content stream per page here. Read whole BT/ET packets: Arabic
// shaping can produce several Tm/TJ operations within one packet. Only Latin text
// is decoded; CID Arabic is used for font/position checks, not Unicode assertions.
function pdfTextPositions(pdf: Buffer): Array<{ text: string; y: number; stream: number; font: string; size: number }> {
  const result: Array<{ text: string; y: number; stream: number; font: string; size: number }> = [];
  let streamIndex = 0;
  for (const stream of pdf.toString("latin1").matchAll(/<<\s*\/Length (\d+)\s*\/Filter \/FlateDecode\s*>>\s*stream\r?\n/g)) {
    const start = stream.index! + stream[0].length;
    const content = inflateSync(pdf.subarray(start, start + parseInt(stream[1]!, 10))).toString("latin1");
    for (const packet of content.matchAll(/BT\s+([\s\S]*?)\s+ET/g)) {
      const position = /1 0 0 1 [-\d.]+ ([-\d.]+) Tm/.exec(packet[1]!);
      const font = /\/(\S+) ([\d.]+) Tf/.exec(packet[1]!);
      if (!position || !font) continue;
      const text = [...packet[1]!.matchAll(/\[([^\]]*)\]\s*TJ/g)].flatMap((run) => [...run[1]!.matchAll(/<([0-9a-f]+)>/gi)]).map((hex) => Buffer.from(hex[1]!, "hex").toString("latin1")).join("");
      result.push({ text, y: parseFloat(position[1]!), stream: streamIndex, font: font[1]!, size: parseFloat(font[2]!) });
    }
    streamIndex++;
  }
  return result;
}

describe("archived document PDF renderer", () => {
  it.each(pdfDocumentTypes)("retains exact decimal text in the actual %s PDF without changing the snapshot", async (type) => {
    const snapshot = pdfDecimalSnapshot(type);
    const before = structuredClone(snapshot);
    const result = await renderDocumentPdf(snapshot);
    const text = pdfLatinTextRuns(result);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("999,999,999,999,999.9999");
    expect(text).toContain("-123,456,789,012,345.6789");
    expect(text).toContain("-0.0001");
    expect(text).toContain("0.00");
    if (snapshot.settlement) expect(text).toContain("123,456,789,012,345.6789 SAR");
    if (snapshot.invoice) {
      for (const expected of ["999,999,999,999,999.9999 SAR", "123,456,789,012,345.6789 / 0.0001", "123,456,789,012,345.6789", "-999,999,999,999,999.9999", "2.6751", "1.2344", "9,999,999,999,999.9999", "10,000,000,000,000.00", "1,000.10", "1.23", "9.9999"]) {
        expect(text).toContain(expected);
      }
    }
    expect(snapshot).toEqual(before);
  });

  it("keeps whole amounts through page breaks with long Arabic invoice fields", async () => {
    const snapshot = longPdfDecimalSnapshot();
    const result = await renderDocumentPdf(snapshot);
    const text = pdfLatinTextRuns(result);
    expect([...result.toString("latin1").matchAll(/\/Type \/Page\b/g)].length).toBeGreaterThan(2);
    // Eight rows each have the schema-limit negative amount in total, tax and price.
    expect(text.filter((value) => value === "-999,999,999,999,999.9999")).toHaveLength(24);
  }, 30_000);

  it.each(["invoice", "journal"] as const)("continues a schema-valid multiline %s row without repeating its money", async (table) => {
    // Still within varchar limits, but too many explicit lines for a single A4 row.
    const snapshot = multilinePdfRowSnapshot(table);
    const before = structuredClone(snapshot);
    const result = await renderDocumentPdf(snapshot);
    const text = pdfLatinTextRuns(result);
    expect([...result.toString("latin1").matchAll(/\/Type \/Page\b/g)].length).toBeGreaterThan(1);
    expect(text.filter((value) => value === "12,345.6789")).toHaveLength(1);
    expect(text.filter((value) => value === "54,321.9876")).toHaveLength(1);
    expect(snapshot).toEqual(before);
  }, 30_000);

  it("places the next journal row below every account-code line in the actual PDF", async () => {
    const result = await renderDocumentPdf(multilineAccountCodeSnapshot());
    const positions = pdfTextPositions(result);
    const code = positions.filter((run) => ["A", "B", "C", "D", "E"].includes(run.text));
    const next = positions.find((run) => run.text === "NEXT");
    expect(code.map((run) => run.text)).toEqual(["A", "B", "C", "D", "E"]);
    expect(next).toBeDefined();
    expect(code.every((run) => run.stream === next!.stream)).toBe(true);
    // PDF text matrices use bottom-up y; a larger y is above the next row.
    expect(code[4]!.y).toBeGreaterThan(next!.y + 8);
  }, 30_000);

  it("keeps the entry identity with the first fragment and on every journal continuation page", async () => {
    const snapshot = multilinePdfRowSnapshot("journal");
    const result = await renderDocumentPdf(snapshot);
    const positions = pdfTextPositions(result);
    // This fixture has no invoice/settlement: Arabic 10 is exclusively entry
    // identity, Arabic 14 is the section title, and regular Arabic 8 is row text.
    const identities = positions.filter((run) => run.size === 10);
    const firstMoney = positions.find((run) => run.text === "12,345.6789");
    const section = positions.find((run) => run.size === 14);
    expect(identities.length).toBeGreaterThan(1);
    expect(firstMoney).toBeDefined();
    expect(section).toBeDefined();
    expect(identities[0]!.stream).toBe(firstMoney!.stream);
    expect(section!.stream).toBe(firstMoney!.stream);
    expect(section!.y).toBeGreaterThan(identities[0]!.y);
    expect(identities[0]!.y).toBeGreaterThan(firstMoney!.y + 8);
    const body = positions.filter((run) => run.size === 8 && run.font === identities[0]!.font);
    const bodyStreams = [...new Set(body.map((run) => run.stream))];
    expect(bodyStreams.length).toBeGreaterThan(1);
    expect([...new Set(identities.map((run) => run.stream))]).toEqual(bodyStreams);
    for (const stream of bodyStreams) {
      const identity = identities.find((run) => run.stream === stream)!;
      expect(identity.y).toBeGreaterThan(Math.max(...body.filter((run) => run.stream === stream).map((run) => run.y)));
    }
    expect(positions.filter((run) => run.text === "12,345.6789")).toHaveLength(1);
    expect(positions.filter((run) => run.text === "54,321.9876")).toHaveLength(1);
  }, 30_000);

  it("renders a non-empty PDF from an immutable Arabic snapshot", async () => {
    const result = await renderDocumentPdf(printSnapshotFixture);

    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.byteLength).toBeGreaterThan(8_000);
    expect(result.toString("latin1")).toContain("/Type /Page");
  });

  it("renders supplier invoice lines and input tax data", async () => {
    const result = await renderDocumentPdf({
      ...printSnapshotFixture,
      document: { ...printSnapshotFixture.document, type: "PURCHASE_INVOICE", number: "PI-2026-00100", description: "فاتورة خدمات تشغيلية" },
      settlement: null,
      invoice: { supplierName: "مؤسسة سحابة للحلول", supplierTaxMasked: "****6401", supplierAddress: "الرياض", supplierInvoiceNumber: "CLOUD-100", sourceInvoiceNumber: null, dueDate: "2026-09-10", currencyCode: "SAR", exchangeRate: "1.00000000", subtotal: "1000.0000", discountTotal: "50.0000", taxTotal: "142.5000", total: "1092.5000", baseTotal: "1092.5000", notes: null, lines: [{ number: 1, description: "خدمات سحابية", accountCode: "5130", accountName: "مصروفات تشغيلية", quantity: "1.0000", unitPrice: "1000.0000", discount: "50.0000", taxRate: "15.0000", tax: "142.5000", total: "1092.5000" }] },
    });
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.byteLength).toBeGreaterThan(8_000);
  });
});
