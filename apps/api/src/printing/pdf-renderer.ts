import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import type { PrintSnapshot } from "./print-types.js";
import { formatPrintDecimal as money } from "./print-decimal.js";
import { printTableRowHeight, takePrintTableFragment, type PrintTableCell } from "./print-table-row.js";
import { drawPrintDocumentHeading } from "./pdf-document-heading.js";
import { createInvoiceDescriptionCell, prepareInvoiceDescription, type InvoiceDescription, type InvoiceDescriptionCell, type InvoiceDescriptionFont } from "./print-invoice-description.js";

const require = createRequire(import.meta.url);
const arabicFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff");
const arabicBoldFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff");
const arabicLatinFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-latin-400-normal.woff");
const productName = process.env.APP_NAME?.trim() || "النظام المحاسبي متعدد الشركات";
const maxTableRowHeight = 755 - 52 - 24; // Content bottom - new-page top - repeated table header.
const titles = { RECEIPT: "سند قبض", PAYMENT: "سند صرف", MANUAL_JOURNAL: "قيد يومية", PURCHASE_INVOICE: "فاتورة مشتريات", PURCHASE_DEBIT_NOTE: "إشعار مدين للمشتريات", SALES_INVOICE: "فاتورة مبيعات", SALES_CREDIT_NOTE: "إشعار دائن للمبيعات" } as const;
const arabicSafe = (value: string) => value
  .replace(/[0-9]+/g, (digits) => [...digits].reverse().map((digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!).join(""))
  .replace(/[—:-]/g, "،");

export function renderDocumentPdf(snapshot: PrintSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: { Title: `${titles[snapshot.document.type]} ${snapshot.document.number}`, Author: snapshot.company.name, Subject: "نسخة تاريخية مؤرشفة" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.registerFont("Arabic", arabicFont).registerFont("ArabicBold", arabicBoldFont).registerFont("ArabicLatin", arabicLatinFont);
    const right = (text: string, y?: number, options: PDFKit.Mixins.TextOptions = {}) => pdf.font("Arabic").text(arabicSafe(text), 42, y, { width: 511, align: "right", features: ["rtla"], ...options });
    const labelValue = (label: string, value: string, y: number) => {
      const isArabic = /[\u0600-\u06ff]/.test(value);
      pdf.font("Arabic").fontSize(9).fillColor("#66756f").text(label, 310, y, { width: 243, align: "right", features: ["rtla"] });
      pdf.font(isArabic ? "ArabicBold" : "Helvetica-Bold").fontSize(11).fillColor("#18352d").text(isArabic ? arabicSafe(value) : value, 42, y + 15, { width: 511, align: "right", features: isArabic ? ["rtla"] : [] });
    };
    const ensure = (height: number) => { if (pdf.y + height > 755) { pdf.addPage(); pdf.y = 52; return true; } return false; };
    const drawTableRows = (
      rows: string[][], widths: number[], numericColumns: number,
      isArabic: (column: number) => boolean, fontSize: number, paddingX: number,
      minHeight: number, drawHeader: () => void,
      pageContext?: (draw: boolean, continuation: boolean) => number,
      invoiceDescriptions?: readonly (InvoiceDescription | null)[],
    ) => {
      const options = (column: number): PDFKit.Mixins.TextOptions => ({
        width: widths[column]! - paddingX * 2, align: isArabic(column) ? "right" : "center",
        features: isArabic(column) ? ["rtla"] : [], lineBreak: false,
      });
      const selectFont = (column: number) => pdf.font(isArabic(column) ? "Arabic" : "Helvetica").fontSize(fontSize);
      type RenderedCell = PrintTableCell & Partial<Pick<InvoiceDescriptionCell, "draw" | "advance">>;
      const prepared = rows.map((values, rowIndex) => values.map((value, column): RenderedCell => {
        const description = column === 4 ? invoiceDescriptions?.[rowIndex] : null;
        if (description) {
          const blockOptions = (font: InvoiceDescriptionFont): PDFKit.Mixins.TextOptions => ({
            width: widths[column]! - paddingX * 2, align: font === "Arabic" ? "right" : "left",
            features: font === "Arabic" ? ["rtla"] : [], lineBreak: false,
          });
          return createInvoiceDescriptionCell(description, {
            heightOfString: (text, font) => pdf.font(font).fontSize(fontSize).heightOfString(text, blockOptions(font)),
            draw: (text, font, x, y) => { pdf.font(font).fontSize(fontSize).text(text, x, y, blockOptions(font)); },
          });
        }
        return {
          // Transform once, before slicing: reapplying arabicSafe would reverse digit
          // groups independently in each fragment instead of preserving the whole cell.
          text: isArabic(column) ? arabicSafe(value) : value,
          splittable: column >= numericColumns,
          measureHeight: (text) => selectFont(column).heightOfString(text, options(column)),
        };
      }));
      let bodyStart = 0;
      const drawPageHeader = (continuation: boolean, firstRow: readonly PrintTableCell[] | undefined) => {
        const canFitFirstFragment = (contextHeight = 0) => firstRow
          ? takePrintTableFragment(firstRow, 755 - pdf.y - contextHeight - 24, minHeight) !== null
          : pdf.y + contextHeight + 24 + minHeight <= 755;
        const contextPage = pdf.page;
        pageContext?.(true, continuation);
        // A schema-valid entry description can itself span pages. Keep its full
        // native text flow, then repeat the reference beside the actual table.
        if (!continuation && pageContext && pdf.page !== contextPage) {
          if (!canFitFirstFragment(pageContext(false, true))) { pdf.addPage(); pdf.y = 52; }
          pageContext(true, true);
        }
        if (!canFitFirstFragment()) {
          pdf.addPage(); pdf.y = 52; pageContext?.(true, true);
        }
        drawHeader();
        bodyStart = pdf.y;
      };
      const newTablePage = (firstRow: readonly PrintTableCell[]) => { pdf.addPage(); pdf.y = 52; drawPageHeader(true, firstRow); };
      const contextHeight = pageContext?.(false, false) ?? 0;
      const firstBudget = 755 - pdf.y - contextHeight - 24;
      const canStart = prepared[0] ? takePrintTableFragment(prepared[0], firstBudget, minHeight) !== null : firstBudget >= minHeight;
      // Reserve an actual first fragment, not the full height of an oversized row.
      // An oversized description retains native flow rather than a negative budget.
      if (!canStart && contextHeight + minHeight <= maxTableRowHeight) { pdf.addPage(); pdf.y = 52; }
      drawPageHeader(false, prepared[0]);
      for (const row of prepared) {
        let pending = row;
        let remainingLength = pending.reduce((sum, cell) => sum + cell.text.length, 0);
        // Keep a row together when it can fit one page; oversized rows start at the
        // top and continue in bounded fragments, without clipping or font changes.
        if (printTableRowHeight(row, minHeight) > 755 - pdf.y && pdf.y > bodyStart) newTablePage(row);
        do {
          let fragment = takePrintTableFragment(pending, 755 - pdf.y, minHeight);
          if (!fragment && pdf.y > bodyStart) {
            newTablePage(pending);
            fragment = takePrintTableFragment(pending, 755 - pdf.y, minHeight);
          }
          // No retries at the same page/position. This is an impossible geometry or
          // single-grapheme/font failure, not a blanket rejection of long schema text.
          if (!fragment) throw new Error("Print table fragment cannot make progress");
          const fitted = fragment;
          const rowY = pdf.y;
          let left = 42;
          fitted.texts.forEach((text, column) => {
            pdf.rect(left, rowY, widths[column]!, fitted.height).stroke("#dce6e1");
            selectFont(column).fillColor("#263f37");
            if (text) {
              const cell = pending[column]!;
              if (cell.draw) cell.draw(text, left + paddingX, rowY + 8);
              else pdf.text(text, left + paddingX, rowY + 8, options(column));
            }
            left += widths[column]!;
          });
          pdf.y = rowY + fitted.height;
          const nextLength = fitted.remainder.reduce((sum, text) => sum + text.length, 0);
          if (!nextLength) break;
          if (nextLength >= remainingLength) throw new Error("Print table fragment did not consume text");
          // A block cell needs a new fixed-cursor measurement closure for its remainder.
          pending = pending.map((cell, index) => cell.advance
            ? cell.advance(fitted.texts[index]!.length)
            : { ...cell, text: fitted.remainder[index]! });
          remainingLength = nextLength;
          newTablePage(pending);
        } while (remainingLength > 0);
      }
    };
    pdf.rect(0, 0, 595, 105).fill("#173f34");
    pdf.font("ArabicBold").fontSize(18).fillColor("#ffffff").text(snapshot.company.name, 42, 30, { width: 511, align: "right", features: ["rtla"] });
    pdf.font("Arabic").fontSize(9).fillColor("#d6e7df").text(`${productName}، نسخة تاريخية مؤرشفة`, 42, 65, { width: 511, align: "right", features: ["rtla"] });
    const headingBottom = drawPrintDocumentHeading(pdf, arabicSafe(titles[snapshot.document.type]), snapshot.document.number);
    const detailsY = Math.max(190, headingBottom + 14), detailsHeight = 105;
    pdf.roundedRect(42, detailsY, 511, detailsHeight, 10).fillAndStroke("#f7faf8", "#dce6e1");
    labelValue("تاريخ المستند", snapshot.document.date, detailsY + 18); labelValue("الوصف", snapshot.document.description, detailsY + 62);
    pdf.y = detailsY + detailsHeight + 20;
    if (snapshot.settlement) {
      pdf.font("ArabicBold").fontSize(14).fillColor("#18352d"); right("بيانات العملية");
      const rows = [["الطرف", snapshot.settlement.counterpartyName], ["المبلغ", `${money(snapshot.settlement.amount)} ${snapshot.settlement.currencyCode}`], ["طريقة الدفع", snapshot.settlement.paymentMethod], ["الحساب النقدي أو البنكي", snapshot.settlement.cashBankAccount], ["المرجع", snapshot.settlement.referenceNumber ?? "-"]];
      for (const [label, value] of rows) {
        ensure(32);
        const rowY = pdf.y;
        const isArabic = /[\u0600-\u06ff]/.test(value!);
        pdf.font("Arabic").fontSize(9).fillColor("#66756f").text(label!, 390, rowY, { width: 163, align: "right", features: ["rtla"], lineBreak: false });
        pdf.font(isArabic ? "Arabic" : "Helvetica").fontSize(10).fillColor("#263f37").text(isArabic ? arabicSafe(value!) : value!, 42, rowY, { width: 330, align: "right", features: isArabic ? ["rtla"] : [], lineBreak: false });
        pdf.y = rowY + 28;
      }
      pdf.moveDown(.5);
    }
    if (snapshot.invoice) {
      const partyKind = snapshot.invoice.partyKind ?? "SUPPLIER";
      const partyName = snapshot.invoice.partyName ?? snapshot.invoice.supplierName ?? "-";
      const externalInvoiceNumber = snapshot.invoice.externalInvoiceNumber ?? snapshot.invoice.supplierInvoiceNumber ?? null;
      pdf.font("ArabicBold").fontSize(14).fillColor("#18352d"); right(partyKind === "CUSTOMER" ? "بيانات فاتورة العميل" : "بيانات فاتورة المورد");
      const invoiceRows = [
        [partyKind === "CUSTOMER" ? "العميل" : "المورد", partyName],
        [partyKind === "CUSTOMER" ? "مرجع العميل" : "رقم فاتورة المورد", externalInvoiceNumber ?? "-"],
        ["تاريخ الاستحقاق", snapshot.invoice.dueDate],
        ["الفاتورة الأصلية", snapshot.invoice.sourceInvoiceNumber ?? "-"],
        ["المستودع", snapshot.invoice.warehouseName ? `${snapshot.invoice.warehouseCode ?? ""} ${snapshot.invoice.warehouseName}`.trim() : "-"],
        ["الإجمالي", `${money(snapshot.invoice.total)} ${snapshot.invoice.currencyCode}`],
        ["الخصم والضريبة", `${money(snapshot.invoice.discountTotal)} / ${money(snapshot.invoice.taxTotal)}`],
      ];
      for (const [label, value] of invoiceRows) {
        ensure(29); const rowY = pdf.y; const isArabic = /[\u0600-\u06ff]/.test(value!);
        pdf.font("Arabic").fontSize(9).fillColor("#66756f").text(label!, 390, rowY, { width: 163, align: "right", features: ["rtla"], lineBreak: false });
        pdf.font(isArabic ? "Arabic" : "Helvetica").fontSize(10).fillColor("#263f37").text(isArabic ? arabicSafe(value!) : value!, 42, rowY, { width: 330, align: "right", features: isArabic ? ["rtla"] : [], lineBreak: false });
        pdf.y = rowY + 25;
      }
      pdf.moveDown(.4); pdf.font("ArabicBold").fontSize(12).fillColor("#18352d"); right("بنود الفاتورة"); pdf.moveDown(.3);
      const x = 42, widths = [75, 60, 65, 50, 151, 110];
      const invoiceDescriptions = snapshot.invoice.lines.map((line) => prepareInvoiceDescription(line, arabicSafe));
      const rows = snapshot.invoice.lines.map((line) => {
        const itemDescription = line.itemName ? `${line.itemCode ?? ""} ${line.itemName} (${line.unitOfMeasureCode ?? ""})، ${line.description}`.trim() : line.description;
        return [money(line.total), money(line.tax), money(line.unitPrice), money(line.quantity), itemDescription, `${line.accountCode} ${line.accountName}`];
      });
      // Keep each complete amount on one line, including DECIMAL(19,4)'s limits.
      // Only PDF geometry uses numbers; money remains a formatted decimal string.
      pdf.font("Helvetica").fontSize(7);
      for (const values of rows) for (let i = 0; i < 4; i++) widths[i] = Math.max(widths[i]!, Math.ceil(pdf.widthOfString(values[i]!)) + 6);
      const descriptionSpace = 511 - widths.slice(0, 4).reduce((sum, width) => sum + width, 0);
      if (descriptionSpace < 60) throw new Error("Print table amounts exceed A4 width");
      widths[4] = descriptionSpace * 151 / 261;
      widths[5] = descriptionSpace - widths[4];
      const drawHeader = () => {
        const headerY = pdf.y; pdf.rect(x, headerY, 511, 24).fill("#e8f1ed");
        const heads = ["الإجمالي", "الضريبة", "سعر الوحدة", "الكمية", "الوصف", "الحساب"];
        let hx = x; heads.forEach((head, i) => { pdf.font("ArabicBold").fontSize(7).fillColor("#294b41").text(head, hx + 3, headerY + 7, { width: widths[i]! - 6, align: "center", features: ["rtla"], lineBreak: false }); hx += widths[i]!; }); pdf.y = headerY + 24;
      };
      drawTableRows(rows, widths, 4, (column) => column >= 4, 7, 3, 28, drawHeader, undefined, invoiceDescriptions);
      pdf.moveDown(.8);
    }
    if (!snapshot.entries.length) {
      ensure(122); pdf.font("ArabicBold").fontSize(14).fillColor("#18352d"); right("تفاصيل القيود"); pdf.moveDown(.5);
    }
    for (const [entryIndex, entry] of snapshot.entries.entries()) {
      const pageContext = (draw: boolean, continuation: boolean) => {
        let height = 0;
        const block = (text: string, size: number, color: string, gap: number) => {
          const prepared = arabicSafe(text);
          const options: PDFKit.Mixins.TextOptions = { width: 511, align: "right", features: ["rtla"] };
          // right() used Arabic regular here; preserve its effective font and sizes.
          pdf.font("Arabic").fontSize(size);
          const spacing = pdf.currentLineHeight(true) * gap;
          height += pdf.heightOfString(prepared, options) + spacing;
          if (draw) { pdf.fillColor(color).text(prepared, 42, pdf.y, options); pdf.y += spacing; }
        };
        if (!continuation && entryIndex === 0) block("تفاصيل القيود", 14, "#18352d", .5);
        const reference = `القيد ${entry.number}، ${entry.date}`;
        block(continuation ? reference : `${reference}: ${entry.description}`, 10, "#315b4e", .4);
        return height;
      };
      const x = 42, widths = [80, 80, 231, 120];
      const rows = entry.lines.map((line) => [money(line.credit), money(line.debit), line.accountName, line.accountCode]);
      pdf.font("Helvetica").fontSize(8);
      for (const values of rows) for (let i = 0; i < 2; i++) widths[i] = Math.max(widths[i]!, Math.ceil(pdf.widthOfString(values[i]!)) + 8);
      widths[2] = 511 - widths[0]! - widths[1]! - widths[3]!;
      if (widths[2] < 30) throw new Error("Print table amounts exceed A4 width");
      const drawHeader = () => {
        const headerY = pdf.y;
        pdf.rect(x, headerY, 511, 24).fill("#e8f1ed");
        const heads = ["دائن", "مدين", "الحساب", "الرمز"];
        let hx = x; heads.forEach((head, i) => { pdf.font("ArabicBold").fontSize(8).fillColor("#294b41").text(head, hx + 4, headerY + 7, { width: widths[i]! - 8, align: "center", features: ["rtla"], lineBreak: false }); hx += widths[i]!; }); pdf.y = headerY + 24;
      };
      drawTableRows(rows, widths, 2, (column) => column === 2, 8, 4, 27, drawHeader, pageContext);
      pdf.moveDown(.8);
    }
    ensure(105); pdf.moveDown(); pdf.font("ArabicBold").fontSize(12).fillColor("#18352d"); right("الاعتمادات والتوقيعات"); const sy = pdf.y + 18;
    [{ label: "أُعد بواسطة", name: snapshot.document.creatorName }, { label: "رُوجع بواسطة", name: "" }, { label: "اعتمد بواسطة", name: snapshot.document.posterName }].forEach(({ label, name }, i) => {
      const bx = 42 + i * 170;
      pdf.font("Arabic").fontSize(9).fillColor("#66756f").text(label, bx, sy, { width: 151, align: "center", features: ["rtla"], lineBreak: false });
      if (name) pdf.font(/[\u0600-\u06ff]/.test(name) ? "ArabicBold" : "Helvetica-Bold").fontSize(8).fillColor("#315b4e").text(name, bx, sy + 16, { width: 151, align: "center", features: /[\u0600-\u06ff]/.test(name) ? ["rtla"] : [], lineBreak: false });
      pdf.moveTo(bx + 8, sy + 46).lineTo(bx + 143, sy + 46).stroke("#9fb1aa");
    });
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(i);
      pdf.font("Helvetica").fontSize(7).fillColor("#71827b").text(`Archive ${snapshot.document.id} | Page ${i + 1} of ${range.count}`, 42, 755, { width: 511, align: "center", lineBreak: false });
    }
    pdf.end();
  });
}
