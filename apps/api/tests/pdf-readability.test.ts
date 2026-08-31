import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { renderDocumentPdf } from "../src/printing/pdf-renderer.js";
import { drawPrintDocumentHeading } from "../src/printing/pdf-document-heading.js";
import { pdfDecimalSnapshot, pdfDocumentTypes } from "./fixtures/pdf-decimal-snapshots.js";

const require = createRequire(import.meta.url);
type TextPosition = { text: string; x: number; y: number; font: string; size: number; stream: number };

// Inspect emitted PDF text matrices. CID Arabic is not treated as decoded Unicode.
function textPositions(pdf: Buffer): TextPosition[] {
  const result: TextPosition[] = [];
  let streamIndex = 0;
  for (const stream of pdf.toString("latin1").matchAll(/<<\s*\/Length (\d+)\s*\/Filter \/FlateDecode\s*>>\s*stream\r?\n/g)) {
    const start = stream.index! + stream[0].length;
    const content = inflateSync(pdf.subarray(start, start + parseInt(stream[1]!, 10))).toString("latin1");
    for (const packet of content.matchAll(/BT\s+([\s\S]*?)\s+ET/g)) {
      const matrix = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/.exec(packet[1]!);
      const font = /\/(\S+) ([\d.]+) Tf/.exec(packet[1]!);
      if (!matrix || !font) continue;
      const text = [...packet[1]!.matchAll(/\[([^\]]*)\]\s*TJ/g)].flatMap((run) => [...run[1]!.matchAll(/<([0-9a-f]+)>/gi)]).map((hex) => Buffer.from(hex[1]!, "hex").toString("latin1")).join("");
      result.push({ text, x: parseFloat(matrix[1]!), y: parseFloat(matrix[2]!), font: font[1]!, size: parseFloat(font[2]!), stream: streamIndex });
    }
    streamIndex++;
  }
  return result;
}

// Read the embedded face's descent from the PDF, independently of layout helpers.
function embeddedDescent(pdf: Buffer, resource: string): number {
  const source = pdf.toString("latin1");
  const objects = new Map([...source.matchAll(/(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)].map((match) => [match[1]!, match[2]!]));
  const reference = new RegExp(`/${resource} (\\d+) 0 R`).exec(source)?.[1];
  const font = objects.get(reference ?? "") ?? "";
  const descendant = /\/DescendantFonts\s*\[\s*(\d+) 0 R/.exec(font)?.[1];
  const descriptor = /\/FontDescriptor (\d+) 0 R/.exec(objects.get(descendant ?? "") ?? font)?.[1];
  const descent = /\/Descent ([-\d.]+)/.exec(objects.get(descriptor ?? "") ?? "")?.[1];
  if (!descent) throw new Error(`Missing PDF font descent for ${resource}`);
  return parseFloat(descent);
}

function expectHeadingSeparation(pdf: Buffer, positions: TextPosition[]): void {
  const titles = positions.filter((run) => run.size === 23);
  const numbers = positions.filter((run) => /^W+$/.test(run.text));
  expect(titles.length).toBeGreaterThan(0);
  expect(numbers.length).toBeGreaterThan(1); // 60 wide ASCII characters, valid VARCHAR(60).
  expect(numbers.map((run) => run.text).join("")).toBe("W".repeat(60));
  expect([...new Set([...titles, ...numbers].map((run) => run.stream))]).toHaveLength(1);
  const titleBottom = Math.min(...titles.map((run) => run.y + embeddedDescent(pdf, run.font) * run.size / 1000));
  // Helvetica-Bold AFM cap height is 718; all number-fixture glyphs are uppercase W.
  const numberTop = Math.max(...numbers.map((run) => run.y + 718 * run.size / 1000));
  expect(titleBottom - numberTop).toBeGreaterThanOrEqual(5.9);
}

describe("PDF readability heading geometry", () => {
  it.each(pdfDocumentTypes)("keeps the %s title, wrapped document number and details apart in the actual PDF", async (type) => {
    const snapshot = pdfDecimalSnapshot(type);
    snapshot.document.number = "W".repeat(60);
    const pdf = await renderDocumentPdf(snapshot);
    const positions = textPositions(pdf);
    expectHeadingSeparation(pdf, positions);
    const numbers = positions.filter((run) => /^W+$/.test(run.text));
    const date = positions.find((run) => run.text === snapshot.document.date)!;
    expect(date).toBeDefined();
    expect(date.stream).toBe(numbers[0]!.stream);
    const numberBottom = Math.min(...numbers.map((run) => run.y - 207 * run.size / 1000));
    expect(numberBottom).toBeGreaterThan(date.y + date.size);
  }, 30_000);

  it("keeps a wrapped title and its badge in separate columns without losing title/number space", async () => {
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({ size: "A4", margin: 42 });
      const chunks: Buffer[] = [];
      document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      document.on("error", reject);
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.registerFont("Arabic", require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff"));
      document.registerFont("ArabicBold", require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff"));
      drawPrintDocumentHeading(document, "إشعار دائن للمبيعات ببيانات أرشيفية ".repeat(4), "W".repeat(60));
      document.end();
    });
    const positions = textPositions(pdf);
    expectHeadingSeparation(pdf, positions);
    const titles = positions.filter((run) => run.size === 23);
    const badge = positions.filter((run) => run.size === 9);
    expect(titles.length).toBeGreaterThan(1);
    expect(badge).toHaveLength(1);
    expect(titles.every((run) => run.x >= 118)).toBe(true);
    expect(badge[0]!.x).toBeLessThan(106);
    expect(titles.every((run) => run.stream === badge[0]!.stream)).toBe(true);
  }, 30_000);
});
