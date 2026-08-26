import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import type { PrintSnapshot } from "./print-types.js";

const require = createRequire(import.meta.url);
const arabicFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff");
const arabicBoldFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff");
const productName = process.env.APP_NAME?.trim() || "النظام المحاسبي متعدد الشركات";
const titles = { RECEIPT: "سند قبض", PAYMENT: "سند صرف", MANUAL_JOURNAL: "قيد يومية", PURCHASE_INVOICE: "فاتورة مشتريات", PURCHASE_DEBIT_NOTE: "إشعار مدين للمشتريات", SALES_INVOICE: "فاتورة مبيعات", SALES_CREDIT_NOTE: "إشعار دائن للمبيعات" } as const;
const money = (value: string) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
    pdf.registerFont("Arabic", arabicFont).registerFont("ArabicBold", arabicBoldFont);
    const right = (text: string, y?: number, options: PDFKit.Mixins.TextOptions = {}) => pdf.font("Arabic").text(arabicSafe(text), 42, y, { width: 511, align: "right", features: ["rtla"], ...options });
    const labelValue = (label: string, value: string, y: number) => {
      const isArabic = /[\u0600-\u06ff]/.test(value);
      pdf.font("Arabic").fontSize(9).fillColor("#66756f").text(label, 310, y, { width: 243, align: "right", features: ["rtla"] });
      pdf.font(isArabic ? "ArabicBold" : "Helvetica-Bold").fontSize(11).fillColor("#18352d").text(isArabic ? arabicSafe(value) : value, 42, y + 15, { width: 511, align: "right", features: isArabic ? ["rtla"] : [] });
    };
    const ensure = (height: number) => { if (pdf.y + height > 755) { pdf.addPage(); pdf.y = 52; } };
    pdf.rect(0, 0, 595, 105).fill("#173f34");
    pdf.font("ArabicBold").fontSize(18).fillColor("#ffffff").text(snapshot.company.name, 42, 30, { width: 511, align: "right", features: ["rtla"] });
    pdf.font("Arabic").fontSize(9).fillColor("#d6e7df").text(`${productName}، نسخة تاريخية مؤرشفة`, 42, 65, { width: 511, align: "right", features: ["rtla"] });
    pdf.y = 126; pdf.font("ArabicBold").fontSize(23).fillColor("#18352d"); right(titles[snapshot.document.type]);
    pdf.font("Helvetica-Bold").fontSize(12).fillColor("#a27b25").text(snapshot.document.number, 42, 160, { width: 511, align: "right" });
    pdf.roundedRect(42, 151, 64, 25, 7).fill("#e8f1ed");
    pdf.font("ArabicBold").fontSize(9).fillColor("#315b4e").text("مرحّل", 42, 158, { width: 64, align: "center", features: ["rtla"] });
    pdf.roundedRect(42, 190, 511, 105, 10).fillAndStroke("#f7faf8", "#dce6e1");
    labelValue("تاريخ المستند", snapshot.document.date, 208); labelValue("الوصف", snapshot.document.description, 252);
    pdf.y = 315;
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
      const headerY = pdf.y; pdf.rect(x, headerY, 511, 24).fill("#e8f1ed");
      const heads = ["الإجمالي", "الضريبة", "سعر الوحدة", "الكمية", "الوصف", "الحساب"];
      let hx = x; heads.forEach((head, i) => { pdf.font("ArabicBold").fontSize(7).fillColor("#294b41").text(head, hx + 3, headerY + 7, { width: widths[i]! - 6, align: "center", features: ["rtla"], lineBreak: false }); hx += widths[i]!; }); pdf.y = headerY + 24;
      for (const line of snapshot.invoice.lines) {
        ensure(28); const rowY = pdf.y; let lx = x;
        const itemDescription = line.itemName ? `${line.itemCode ?? ""} ${line.itemName} (${line.unitOfMeasureCode ?? ""})، ${line.description}`.trim() : line.description;
        const values = [money(line.total), money(line.tax), money(line.unitPrice), money(line.quantity), itemDescription, `${line.accountCode} ${line.accountName}`];
        values.forEach((value, i) => { pdf.rect(lx, rowY, widths[i]!, 28).stroke("#dce6e1"); const isArabic = i >= 4; pdf.font(isArabic ? "Arabic" : "Helvetica").fontSize(7).fillColor("#263f37").text(isArabic ? arabicSafe(value) : value, lx + 3, rowY + 8, { width: widths[i]! - 6, align: isArabic ? "right" : "center", features: isArabic ? ["rtla"] : [], lineBreak: false }); lx += widths[i]!; });
        pdf.y = rowY + 28;
      }
      pdf.moveDown(.8);
    }
    const firstEntryHeight = snapshot.entries[0] ? 80 + snapshot.entries[0].lines.length * 27 : 80;
    ensure(42 + firstEntryHeight);
    pdf.font("ArabicBold").fontSize(14).fillColor("#18352d"); right("تفاصيل القيود"); pdf.moveDown(.5);
    for (const entry of snapshot.entries) {
      ensure(80); pdf.font("ArabicBold").fontSize(10).fillColor("#315b4e"); right(`القيد ${entry.number}، ${entry.date}: ${entry.description}`); pdf.moveDown(.4);
      const x = 42, widths = [80, 80, 231, 120];
      const headerY = pdf.y;
      pdf.rect(x, headerY, 511, 24).fill("#e8f1ed");
      const heads = ["دائن", "مدين", "الحساب", "الرمز"];
      let hx = x; heads.forEach((head, i) => { pdf.font("ArabicBold").fontSize(8).fillColor("#294b41").text(head, hx + 4, headerY + 7, { width: widths[i]! - 8, align: "center", features: ["rtla"], lineBreak: false }); hx += widths[i]!; }); pdf.y = headerY + 24;
      for (const line of entry.lines) {
        ensure(27);
        const rowY = pdf.y;
        let lx = x;
        const values = [money(line.credit), money(line.debit), line.accountName, line.accountCode];
        values.forEach((value, i) => {
          pdf.rect(lx, rowY, widths[i]!, 27).stroke("#dce6e1");
          pdf.font(i === 2 ? "Arabic" : "Helvetica").fontSize(8).fillColor("#263f37").text(i === 2 ? arabicSafe(value) : value, lx + 4, rowY + 8, { width: widths[i]! - 8, align: i === 2 ? "right" : "center", features: i === 2 ? ["rtla"] : [], lineBreak: false });
          lx += widths[i]!;
        });
        pdf.y = rowY + 27;
      }
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
