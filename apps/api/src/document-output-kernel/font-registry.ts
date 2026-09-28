import { fileURLToPath } from "node:url";
const fullArabic = fileURLToPath(new URL("./fonts/NotoSansArabic.ttf", import.meta.url));

export function registerReportFonts(pdf: PDFKit.PDFDocument) {
  pdf.registerFont("Arabic", fullArabic).registerFont("ArabicBold", fullArabic);
}
