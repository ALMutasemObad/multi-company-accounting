import PDFDocument from "pdfkit";
import { containsArabic, prepareBidiText } from "./bidi.js";
import { formatDecimal } from "./decimal.js";
import { registerReportFonts } from "./font-registry.js";
import type { PdfTableProfile, TabularCell } from "./model.js";
import { paginateTableWithRepeatedHeader } from "./table-pagination.js";

const PAGE_WIDTH = 842;
const LEFT = 36;
const CONTENT_WIDTH = 770;
const CONTENT_TOP = 92;
const CONTENT_BOTTOM = 514;
const MIN_ROW_HEIGHT = 24;

export function renderTabularReportPdf(profile: PdfTableProfile): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const resolvedProfile = { ...profile, direction: profile.direction ?? "RTL" };
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: LEFT, bufferPages: true, info: { Title: profile.title, Author: profile.companyName } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    registerReportFonts(pdf);

    const allRows = [...(resolvedProfile.metadataRows ?? []), ...(resolvedProfile.headerRows ?? []), ...resolvedProfile.bodyRows];
    const widths = reportColumnWidths(Math.max(1, ...allRows.map((row) => row.length)));
    const metadataHeights = (resolvedProfile.metadataRows ?? []).map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const headerHeights = (resolvedProfile.headerRows ?? []).map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const bodyRowHeights = resolvedProfile.bodyRows.map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const pages = paginateTableWithRepeatedHeader({
      metadataHeight: sum(metadataHeights),
      headerHeight: sum(headerHeights),
      bodyRowHeights,
      availableHeight: CONTENT_BOTTOM - CONTENT_TOP,
    });

    for (const [pageIndex, page] of pages.entries()) {
      if (pageIndex > 0) pdf.addPage();
      drawPageHeader(pdf, resolvedProfile);
      if (page.includesMetadata) {
        for (const [index, row] of (resolvedProfile.metadataRows ?? []).entries()) drawRow(pdf, row, widths, metadataHeights[index]!, resolvedProfile.direction);
      }
      for (const [index, row] of (resolvedProfile.headerRows ?? []).entries()) drawRow(pdf, row, widths, headerHeights[index]!, resolvedProfile.direction);
      for (const rowIndex of page.bodyRowIndexes) {
        drawRow(pdf, resolvedProfile.bodyRows[rowIndex]!, widths, bodyRowHeights[rowIndex]!, resolvedProfile.direction);
      }
    }

    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      pdf.switchToPage(index);
      pdf.font("Arabic").fontSize(7).fillColor("#71827b").text(
        prepareBidiText(`صفحة ${index + 1} من ${range.count}`),
        LEFT,
        525,
        { width: CONTENT_WIDTH, align: resolvedProfile.direction === "LTR" ? "left" : "right", features: resolvedProfile.direction === "RTL" ? ["rtla"] : [], lineBreak: false },
      );
    }
    pdf.end();
  });
}

function drawPageHeader(pdf: PDFKit.PDFDocument, profile: PdfTableProfile) {
  const rtl = profile.direction !== "LTR";
  pdf.rect(0, 0, PAGE_WIDTH, 75).fill("#173f34");
  pdf.font(containsArabic(profile.companyName) ? "ArabicBold" : "Helvetica-Bold").fontSize(17).fillColor("#ffffff").text(prepareBidiText(profile.companyName, profile.direction), LEFT, 18, { width: CONTENT_WIDTH, align: rtl ? "right" : "left", features: rtl ? ["rtla"] : [] });
  pdf.font(containsArabic(profile.title) ? "Arabic" : "Helvetica").fontSize(10).fillColor("#d6e7df").text(prepareBidiText(profile.title, profile.direction), LEFT, 47, { width: CONTENT_WIDTH, align: rtl ? "right" : "left", features: rtl ? ["rtla"] : [] });
  pdf.y = CONTENT_TOP;
}

function measureRow(pdf: PDFKit.PDFDocument, row: TabularCell[], widths: number[], direction: PdfTableProfile["direction"]) {
  const isHeader = row.length > 0 && row.every((cell) => cell.style === 2);
  const isSection = row[0]?.style === 3;
  let greatestHeight = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const cell = row[index];
    const display = displayValue(cell, direction);
    const arabic = containsArabic(display);
    pdf.font(selectFont(arabic, isHeader || isSection)).fontSize(8);
    greatestHeight = Math.max(greatestHeight, pdf.heightOfString(display, textOptions(widths[index]!, index, arabic, direction)));
  }
  return Math.max(MIN_ROW_HEIGHT, Math.ceil(greatestHeight) + 12);
}

function drawRow(pdf: PDFKit.PDFDocument, row: TabularCell[], widths: number[], height: number, direction: PdfTableProfile["direction"]) {
  const y = pdf.y;
  const isHeader = row.length > 0 && row.every((cell) => cell.style === 2);
  const isSection = row[0]?.style === 3;
  if (isHeader) pdf.rect(LEFT, y, CONTENT_WIDTH, height).fill("#173f34");
  else if (isSection) pdf.rect(LEFT, y, CONTENT_WIDTH, height).fill("#e8f1ed");
  let x = LEFT;
  for (let index = 0; index < widths.length; index += 1) {
    const cell = row[index];
    const display = displayValue(cell, direction);
    const arabic = containsArabic(display);
    pdf.font(selectFont(arabic, isHeader || isSection)).fontSize(8).fillColor(isHeader ? "#ffffff" : "#263f37").text(
      display,
      x + 4,
      y + 6,
      { ...textOptions(widths[index]!, index, arabic, direction), height: height - 12 },
    );
    if (!isHeader) pdf.rect(x, y, widths[index]!, height).stroke("#dce6e1");
    x += widths[index]!;
  }
  pdf.y = y + height;
}

function displayValue(cell: TabularCell | undefined, direction: PdfTableProfile["direction"]) {
  if (!cell) return "";
  if (cell.numeric && cell.value !== "") return formatDecimal(cell.value);
  return prepareBidiText(cell.value, direction);
}

function selectFont(arabic: boolean, emphasized: boolean) {
  if (arabic) return emphasized ? "ArabicBold" : "Arabic";
  return emphasized ? "Helvetica-Bold" : "Helvetica";
}

function textOptions(width: number, column: number, arabic: boolean, direction: PdfTableProfile["direction"]): PDFKit.Mixins.TextOptions {
  const rtl = direction !== "LTR";
  return { width: width - 8, align: column === 0 ? (rtl ? "right" as const : "left" as const) : "center" as const, features: rtl && arabic ? ["rtla"] : [] };
}

export function reportColumnWidths(columnCount: number) {
  if (columnCount === 8) return [70, 115, 65, 140, 65, 65, 125, 125];
  if (columnCount === 7) return [80, 100, 250, 80, 80, 90, 90];
  if (columnCount === 2) return [600, 170];
  const base = Math.floor(CONTENT_WIDTH / columnCount);
  return Array.from({ length: columnCount }, (_, index) => index === columnCount - 1 ? CONTENT_WIDTH - base * (columnCount - 1) : base);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
