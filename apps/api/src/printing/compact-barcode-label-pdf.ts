import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import { defaultBarcodeLabelSettings, type BarcodeLabelSettings } from "./barcode-label-settings.js";

const require = createRequire(import.meta.url);
const arabicFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff");

export const COMPACT_LABEL_WIDTH_PT = 50 * 72 / 25.4;
export const COMPACT_LABEL_HEIGHT_PT = 25 * 72 / 25.4;
const LABEL_SIZE_PT = {
  "50x25": [COMPACT_LABEL_WIDTH_PT, COMPACT_LABEL_HEIGHT_PT],
  "75x50": [75 * 72 / 25.4, 50 * 72 / 25.4],
} as const;
const PIXELS_PER_INCH = 203;
const marginPt = 2 * 72 / 25.4;

export class CompactLabelTooWideError extends Error {
  constructor() { super("LABEL_TOO_WIDE"); }
}

/** Keeps every barcode module at its 203-DPI size; a long value needs a shorter label barcode. */
export function renderCompactBarcodeLabelPdf(input: {
  svg: string;
  value: string;
  itemName: string;
  issueNumber: string | null;
  periodicalYear: string | null;
  publicationYear: number | null;
  settings?: BarcodeLabelSettings;
}): Promise<Buffer> {
  const settings = input.settings ?? defaultBarcodeLabelSettings;
  const [pageWidth, pageHeight] = LABEL_SIZE_PT[settings.labelSize];
  const viewBox = input.svg.match(/^<svg viewBox="0 0 ([\d.]+) ([\d.]+)"/u);
  const pixelsWide = Number(viewBox?.[1]);
  const pixelsHigh = Number(viewBox?.[2]);
  if (!Number.isFinite(pixelsWide) || !Number.isFinite(pixelsHigh)
    || pixelsWide <= 0 || pixelsHigh <= 0 || input.svg.length > 2 * 1024 * 1024) {
    throw new Error("INVALID_BARCODE_VECTOR");
  }
  const widthPt = pixelsWide * 72 / PIXELS_PER_INCH;
  const heightPt = pixelsHigh * 72 / PIXELS_PER_INCH;
  const details = [
    settings.showPeriodicalYear && input.periodicalYear && (/^السنة\s/u.test(input.periodicalYear) ? input.periodicalYear : `السنة ${input.periodicalYear}`),
    settings.showIssueNumber && input.issueNumber && (/^العدد\s/u.test(input.issueNumber) ? input.issueNumber : `العدد ${input.issueNumber}`),
    settings.showPublicationYear && input.publicationYear && String(input.publicationYear),
  ].filter(Boolean).join(" ، ").replace(/[0-9]/gu, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!);
  const barcodeY = !settings.showItemName && !details
    ? (pageHeight - heightPt) / 2
    : (settings.showItemName ? 15 : 3) + (details ? 10 : 0);
  if (widthPt > pageWidth - 2 * marginPt || barcodeY + heightPt > pageHeight - marginPt) {
    throw new CompactLabelTooWideError();
  }
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: [pageWidth, pageHeight],
      margin: 0,
      info: { Title: `Inventory barcode label ${settings.labelSize} mm` },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.registerFont("Arabic", arabicFont);
    if (settings.showItemName) pdf.font("Arabic").fontSize(8.5).fillColor("#111111")
      .text(input.itemName, marginPt, 3, {
        width: pageWidth - 2 * marginPt,
        height: 11,
        align: "center",
        ellipsis: true,
        lineBreak: false,
        features: ["rtla"],
      });
    if (details) pdf.font("Arabic").fontSize(6).text(details, marginPt, settings.showItemName ? 15 : 3, {
      width: pageWidth - 2 * marginPt, height: 9,
      align: "center", lineBreak: false, ellipsis: true, features: ["rtla"],
    });
    // Keep bars and their human-readable text as PDF paths. Rasterizing a PNG
    // through a browser and the 203-DPI Zebra driver distorted narrow bars.
    pdf.save().translate((pageWidth - widthPt) / 2, barcodeY).scale(72 / PIXELS_PER_INCH);
    const paths = [...input.svg.matchAll(/<path\b([^>]*)\/>/gu)];
    if (!paths.length) throw new Error("INVALID_BARCODE_VECTOR");
    for (const [, rawAttributes] of paths) {
      const attributes = Object.fromEntries(
        [...(rawAttributes ?? "").matchAll(/([a-z-]+)="([^"]*)"/gu)].map((match) => [match[1], match[2]]),
      );
      if (!attributes.d) throw new Error("INVALID_BARCODE_VECTOR");
      if (attributes.stroke) {
        pdf.path(attributes.d).lineWidth(Number(attributes["stroke-width"] ?? 1))
          .strokeColor(attributes.stroke).stroke();
      } else {
        pdf.path(attributes.d).fillColor(attributes.fill ?? "#000000").fill();
      }
    }
    pdf.restore();
    pdf.end();
  });
}
