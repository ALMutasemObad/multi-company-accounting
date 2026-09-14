import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const arabicRegular = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff");
const arabicBold = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff");

export function registerReportFonts(pdf: PDFKit.PDFDocument) {
  pdf.registerFont("Arabic", arabicRegular).registerFont("ArabicBold", arabicBold);
}
