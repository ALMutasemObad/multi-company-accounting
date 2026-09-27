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
  png: Buffer;
  value: string;
  itemName: string;
  issueNumber: string | null;
  publicationYear: number | null;
  settings?: BarcodeLabelSettings;
}): Promise<Buffer> {
  const settings = input.settings ?? defaultBarcodeLabelSettings;
  const [pageWidth, pageHeight] = LABEL_SIZE_PT[settings.labelSize];
  const pixelsWide = input.png.readUInt32BE(16);
  const pixelsHigh = input.png.readUInt32BE(20);
  const widthPt = pixelsWide * 72 / PIXELS_PER_INCH;
  const heightPt = pixelsHigh * 72 / PIXELS_PER_INCH;
  const details = [settings.showIssueNumber && input.issueNumber && `#${input.issueNumber}`,
    settings.showPublicationYear && input.publicationYear].filter(Boolean).join("  /  ");
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
    if (settings.showItemName) pdf.font("Arabic").fontSize(7).fillColor("#111111")
      .text(input.itemName, marginPt, 3, {
        width: pageWidth - 2 * marginPt,
        height: 11,
        align: "center",
        ellipsis: true,
        lineBreak: false,
        features: ["rtla"],
      });
    if (details) pdf.font("Helvetica").fontSize(6).text(details, marginPt, settings.showItemName ? 15 : 3, {
      width: pageWidth - 2 * marginPt,
      align: "center", lineBreak: false,
    });
    pdf.image(input.png, (pageWidth - widthPt) / 2, barcodeY, {
      width: widthPt, height: heightPt,
    });
    pdf.end();
  });
}
