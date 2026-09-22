import PDFDocument from "pdfkit";
import { containsArabic, prepareBidiText } from "./bidi.js";
import { formatDecimal } from "./decimal.js";
import { registerReportFonts } from "./font-registry.js";
import type { DocumentMetadataField, PdfTableProfile, TabularCell } from "./model.js";
import { paginateTableWithRepeatedHeader, TablePaginationError } from "./table-pagination.js";

const PAGE_WIDTH = 842;
const LEFT = 36;
const CONTENT_WIDTH = 770;
const CONTENT_TOP = 92;
const CONTENT_BOTTOM = 514;
const MIN_ROW_HEIGHT = 24;
const CLOSING_TOP = 476;

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
    const columnCount = Math.max(1, ...allRows.map((row) => row.length));
    const widths = resolvedProfile.columnWidths ?? reportColumnWidths(columnCount);
    if (widths.length !== columnCount || widths.some((width) => !Number.isFinite(width) || width <= 0) || Math.abs(sum(widths) - CONTENT_WIDTH) > 0.01) {
      throw new TablePaginationError("TABLE_COLUMN_WIDTHS_INVALID");
    }
    const metadataLineHeights = (resolvedProfile.metadataLines ?? []).map((line) => measureFullLine(pdf, line, resolvedProfile.direction));
    const metadataGroupHeights = (resolvedProfile.metadataGroups ?? []).map((fields) => measureMetadataGroup(pdf, fields));
    const metadataHeights = (resolvedProfile.metadataRows ?? []).map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const headerHeights = (resolvedProfile.headerRows ?? []).map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const bodyRowHeights = resolvedProfile.bodyRows.map((row) => measureRow(pdf, row, widths, resolvedProfile.direction));
    const closingLines = resolvedProfile.closingLines ?? [];
    const signatureLabels = resolvedProfile.signatureLabels ?? [];
    if (closingLines.length > 2) throw new TablePaginationError("TABLE_CLOSING_LINES_EXCEED_PAGE");
    if (signatureLabels.length > 3 || (signatureLabels.length > 0 && closingLines.length > 1)) throw new TablePaginationError("TABLE_SIGNATURE_LAYOUT_INVALID");
    const pages = paginateTableWithRepeatedHeader({
      metadataHeight: sum(metadataLineHeights) + sum(metadataGroupHeights) + sum(metadataHeights),
      headerHeight: sum(headerHeights),
      bodyRowHeights,
      availableHeight: (closingLines.length || signatureLabels.length ? CLOSING_TOP - 8 : CONTENT_BOTTOM) - CONTENT_TOP,
    });

    for (const [pageIndex, page] of pages.entries()) {
      if (pageIndex > 0) pdf.addPage();
      drawPageHeader(pdf, resolvedProfile);
      if (page.includesMetadata) {
        for (const [index, line] of (resolvedProfile.metadataLines ?? []).entries()) drawFullLine(pdf, line, metadataLineHeights[index]!, resolvedProfile.direction);
        for (const [index, fields] of (resolvedProfile.metadataGroups ?? []).entries()) drawMetadataGroup(pdf, fields, metadataGroupHeights[index]!, resolvedProfile.direction);
        for (const [index, row] of (resolvedProfile.metadataRows ?? []).entries()) drawRow(pdf, row, widths, metadataHeights[index]!, resolvedProfile.direction);
      }
      for (const [index, row] of (resolvedProfile.headerRows ?? []).entries()) drawRow(pdf, row, widths, headerHeights[index]!, resolvedProfile.direction);
      for (const rowIndex of page.bodyRowIndexes) {
        drawRow(pdf, resolvedProfile.bodyRows[rowIndex]!, widths, bodyRowHeights[rowIndex]!, resolvedProfile.direction);
      }
      if (pageIndex === pages.length - 1) {
        for (const [index, line] of closingLines.entries()) drawFullLine(pdf, line, 18, resolvedProfile.direction, CLOSING_TOP + index * 19);
        if (signatureLabels.length) drawSignatures(pdf, signatureLabels, resolvedProfile.direction, CLOSING_TOP + closingLines.length * 19 + 2);
      }
    }

    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      pdf.switchToPage(index);
      pdf.font("Arabic").fontSize(7).fillColor("#71827b").text(
        prepareBidiText(resolvedProfile.direction === "LTR" ? `Page ${index + 1} of ${range.count}` : `صفحة ${arabicDigits(index + 1)} من ${arabicDigits(range.count)}`),
        LEFT,
        closingLines.length || signatureLabels.length ? 536 : 525,
        { width: CONTENT_WIDTH, align: resolvedProfile.direction === "LTR" ? "left" : "right", features: resolvedProfile.direction === "RTL" ? ["rtla"] : [], lineBreak: false },
      );
    }
    pdf.end();
  });
}

function arabicDigits(value: number) {
  return String(value).replace(/\d/gu, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!);
}

function measureMetadataGroup(pdf: PDFKit.PDFDocument, fields: DocumentMetadataField[]) {
  if (fields.length < 1 || fields.length > 4) throw new TablePaginationError("TABLE_METADATA_GROUP_INVALID");
  const width = CONTENT_WIDTH / fields.length - 12;
  const valueHeight = Math.max(...fields.map((field) => {
    const arabic = containsArabic(field.value);
    pdf.font(arabic ? "ArabicBold" : "Helvetica-Bold").fontSize(10);
    return pdf.heightOfString(field.value, { width, align: "right" });
  }));
  return Math.max(40, Math.ceil(valueHeight) + 21);
}

function drawMetadataGroup(pdf: PDFKit.PDFDocument, fields: DocumentMetadataField[], height: number, direction: PdfTableProfile["direction"]) {
  const y = pdf.y;
  const cellWidth = CONTENT_WIDTH / fields.length;
  for (const [index, field] of fields.entries()) {
    const x = direction === "LTR" ? LEFT + index * cellWidth : LEFT + CONTENT_WIDTH - (index + 1) * cellWidth;
    const align = direction === "LTR" ? "left" : "right";
    pdf.font("Arabic").fontSize(9).fillColor("#627b73").text(field.label, x + 6, y + 2, { width: cellWidth - 12, height: 13, align, features: direction === "LTR" ? [] : ["rtla"] });
    const arabic = containsArabic(field.value);
    pdf.font(arabic ? "ArabicBold" : "Helvetica-Bold").fontSize(10).fillColor("#173f34").text(field.value, x + 6, y + 18, { width: cellWidth - 12, height: height - 20, align, features: arabic && direction !== "LTR" ? ["rtla"] : [] });
  }
  pdf.moveTo(LEFT, y + height).lineTo(LEFT + CONTENT_WIDTH, y + height).strokeColor("#dce6e1").stroke();
  pdf.y = y + height;
}

function drawSignatures(pdf: PDFKit.PDFDocument, labels: string[], direction: PdfTableProfile["direction"], y: number) {
  const cellWidth = CONTENT_WIDTH / labels.length;
  for (const [index, label] of labels.entries()) {
    const x = direction === "LTR" ? LEFT + index * cellWidth : LEFT + CONTENT_WIDTH - (index + 1) * cellWidth;
    pdf.font("Arabic").fontSize(8).fillColor("#263f37").text(label, x + 6, y, { width: cellWidth - 12, height: 14, align: direction === "LTR" ? "left" : "right", features: direction === "LTR" ? [] : ["rtla"] });
    pdf.moveTo(x + 18, y + 22).lineTo(x + cellWidth - 18, y + 22).strokeColor("#9bb0a6").stroke();
  }
}

function measureFullLine(pdf: PDFKit.PDFDocument, line: string, direction: PdfTableProfile["direction"]) {
  const arabic = containsArabic(line);
  pdf.font(arabic ? "Arabic" : "Helvetica").fontSize(8);
  return Math.max(18, Math.ceil(pdf.heightOfString(prepareBidiText(line, direction), { width: CONTENT_WIDTH, align: direction === "LTR" ? "left" : "right", features: arabic && direction !== "LTR" ? ["rtla"] : [] })) + 5);
}

function drawFullLine(pdf: PDFKit.PDFDocument, line: string, height: number, direction: PdfTableProfile["direction"], y = pdf.y) {
  const arabic = containsArabic(line);
  pdf.font(arabic ? "Arabic" : "Helvetica").fontSize(8).fillColor("#263f37").text(
    prepareBidiText(line, direction), LEFT, y,
    { width: CONTENT_WIDTH, height, align: direction === "LTR" ? "left" : "right", features: arabic && direction !== "LTR" ? ["rtla"] : [] },
  );
  pdf.y = y + height;
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
    pdf.font(selectFont(arabic, isHeader || isSection)).fontSize(9);
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
  let x = direction === "LTR" ? LEFT : LEFT + CONTENT_WIDTH;
  for (let index = 0; index < widths.length; index += 1) {
    const cell = row[index];
    if (direction !== "LTR") x -= widths[index]!;
    const display = displayValue(cell, direction);
    const arabic = containsArabic(display);
    pdf.font(selectFont(arabic, isHeader || isSection)).fontSize(9).fillColor(isHeader ? "#ffffff" : "#263f37").text(
      display,
      x + 4,
      y + 6,
      { ...textOptions(widths[index]!, index, arabic, direction), height: height - 12 },
    );
    if (!isHeader) pdf.rect(x, y, widths[index]!, height).stroke("#dce6e1");
    if (direction === "LTR") x += widths[index]!;
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
