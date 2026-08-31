/** Draw the existing document heading faces/sizes and return its measured bottom. */
export function drawPrintDocumentHeading(pdf: PDFKit.PDFDocument, titleText: string, documentNumber: string): number {
  const left = 42, width = 511, top = 126;
  const badgeWidth = 64, badgeHeight = 25, columnGap = 12;
  const textX = left + badgeWidth + columnGap;
  const textWidth = width - badgeWidth - columnGap;
  const titleOptions: PDFKit.Mixins.TextOptions = { width: textWidth, align: "right", features: ["rtla"] };
  // right() previously selected Arabic regular; keep that effective face.
  pdf.font("Arabic").fontSize(23);
  const titleLineHeight = pdf.currentLineHeight(true);
  const titleHeight = pdf.heightOfString(titleText, titleOptions);
  pdf.fillColor("#18352d").text(titleText, textX, top, titleOptions);

  const numberY = top + titleHeight + 6;
  const numberOptions: PDFKit.Mixins.TextOptions = { width: textWidth, align: "right" };
  pdf.font("Helvetica-Bold").fontSize(12);
  const numberHeight = pdf.heightOfString(documentNumber, numberOptions);
  pdf.fillColor("#a27b25").text(documentNumber, textX, numberY, numberOptions);

  // Keep the badge beside the first title line, in a separate horizontal column.
  // A wrapped title or number never uses the badge's drawing area.
  const badgeY = top + Math.max(0, (titleLineHeight - badgeHeight) / 2);
  const badgeOptions: PDFKit.Mixins.TextOptions = { width: badgeWidth, align: "center", features: ["rtla"] };
  pdf.font("ArabicBold").fontSize(9);
  const badgeTextHeight = pdf.heightOfString("مرحّل", badgeOptions);
  pdf.roundedRect(left, badgeY, badgeWidth, badgeHeight, 7).fill("#e8f1ed");
  pdf.fillColor("#315b4e").text("مرحّل", left, badgeY + (badgeHeight - badgeTextHeight) / 2, badgeOptions);
  return Math.max(top + titleHeight, numberY + numberHeight, badgeY + badgeHeight);
}
