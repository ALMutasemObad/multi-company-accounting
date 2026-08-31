import type { PrintSnapshot } from "../../src/printing/print-types.js";
import { printSnapshotFixture } from "./print-snapshot.js";

export const pdfDocumentTypes = ["RECEIPT", "PAYMENT", "MANUAL_JOURNAL", "PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE", "SALES_INVOICE", "SALES_CREDIT_NOTE"] as const;

/** Synthetic output cases within DECIMAL(19,4)/(19,6), not posting/accounting fixtures. */
export function pdfDecimalSnapshot(type: PrintSnapshot["document"]["type"]): PrintSnapshot {
  const snapshot = structuredClone(printSnapshotFixture);
  snapshot.document.type = type;
  snapshot.document.description = "اختبار عرض الأرقام من اللقطة التاريخية";
  snapshot.settlement = type === "RECEIPT" || type === "PAYMENT"
    ? { ...printSnapshotFixture.settlement!, amount: "123456789012345.6789" }
    : null;
  snapshot.entries[0]!.lines = [
    { ...snapshot.entries[0]!.lines[0]!, debit: "999999999999999.9999", credit: "0" },
    { ...snapshot.entries[0]!.lines[1]!, debit: "0", credit: "999999999999999.9999" },
    { ...snapshot.entries[0]!.lines[0]!, debit: "-123456789012345.6789", credit: "-0.0001" },
  ];
  if (type.includes("INVOICE") || type.endsWith("NOTE")) {
    snapshot.invoice = {
      partyKind: type.startsWith("SALES") ? "CUSTOMER" : "SUPPLIER",
      partyName: "مؤسسة المثال للتجارة", supplierName: "مؤسسة المثال للتجارة",
      sourceInvoiceNumber: null, dueDate: "2026-09-10", currencyCode: "SAR",
      exchangeRate: "1.00000000", subtotal: "999999999999999.9999",
      discountTotal: "123456789012345.6789", taxTotal: "0.0001",
      total: "999999999999999.9999", baseTotal: "999999999999999.9999", notes: null,
      lines: [
        { quantity: "2.675050", unitPrice: "123456789012345.6789", tax: "0.0001", total: "999999999999999.9999" },
        { quantity: "9999999999999.999949", unitPrice: "-999999999999999.9999", tax: "-999999999999999.9999", total: "-999999999999999.9999" },
        { quantity: "1.234449", unitPrice: "0", tax: "0", total: "0" },
        { quantity: "9999999999999.999950", unitPrice: "9.9999", tax: "1.2300", total: "1000.1000" },
      ].map((values, index) => ({
        number: index + 1, description: "خدمات تشغيلية", accountCode: "5130",
        accountName: "مصروفات تشغيلية", discount: "0", taxRate: "0", ...values,
      })),
    };
  }
  return snapshot;
}

export function longPdfDecimalSnapshot(): PrintSnapshot {
  const snapshot = pdfDecimalSnapshot("SALES_INVOICE");
  const line = snapshot.invoice!.lines[1]!;
  snapshot.invoice!.lines.push({
    ...line, number: 5,
    itemCode: "ITM-" + "1".repeat(36),
    itemName: "صنف من المخزون للاختبار ".repeat(12).slice(0, 200),
    unitOfMeasureCode: "UNIT-" + "1".repeat(15),
    description: "وصف عربي طويل محفوظ في الأرشيف لاختبار التفاف النص داخل جدول الفاتورة ".repeat(10).slice(0, 500),
    accountCode: "1".repeat(40),
    accountName: "حساب المصروفات التشغيلية ".repeat(9).slice(0, 180),
  }, ...Array.from({ length: 6 }, (_, index) => ({ ...line, number: index + 6 })));
  return snapshot;
}

export function multilineAccountCodeSnapshot(): PrintSnapshot {
  const snapshot = pdfDecimalSnapshot("MANUAL_JOURNAL");
  snapshot.entries[0]!.lines = [
    { ...snapshot.entries[0]!.lines[0]!, accountCode: "A\nB\nC\nD\nE", accountName: "حساب" },
    { ...snapshot.entries[0]!.lines[1]!, accountCode: "NEXT", accountName: "التالي" },
  ];
  return snapshot;
}

export function multilinePdfRowSnapshot(table: "invoice" | "journal"): PrintSnapshot {
  const snapshot = pdfDecimalSnapshot(table === "invoice" ? "SALES_INVOICE" : "MANUAL_JOURNAL");
  if (table === "invoice") {
    snapshot.invoice!.lines = [{ ...snapshot.invoice!.lines[0]!, description: "وصف\n".repeat(90), unitPrice: "12345.6789", total: "54321.9876" }];
  } else {
    snapshot.entries[0]!.lines = [{ ...snapshot.entries[0]!.lines[0]!, accountName: "ح\n".repeat(80), debit: "12345.6789", credit: "54321.9876" }];
  }
  return snapshot;
}
