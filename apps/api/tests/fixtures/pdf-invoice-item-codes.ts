import type { PrintSnapshot } from "../../src/printing/print-types.js";
import { printSnapshotFixture } from "./print-snapshot.js";

export const pdfInvoiceItemCode = `ITM-${"W".repeat(28)}12345678`;
export const pdfInvoiceUnitCode = `U-${"W".repeat(14)}9073`;
export const pdfInvoiceCodeMoney = [
  "-999,999,999,999,999.9999",
  "-888,888,888,888,888.8888",
  "-777,777,777,777,777.7777",
  "9,999,999,999,999.9999",
] as const;

/** Synthetic archival output only; values fit DECIMAL/VARCHAR, not a posting example. */
function invoiceSnapshot(): PrintSnapshot {
  const snapshot = structuredClone(printSnapshotFixture);
  snapshot.document = {
    ...snapshot.document, type: "SALES_INVOICE", number: "SI-CODES-2026-1248",
    description: "اختبار الرموز المستقلة المحفوظة في الأرشيف",
  };
  snapshot.settlement = null;
  snapshot.entries = [];
  snapshot.invoice = {
    partyKind: "CUSTOMER", partyName: "عميل الاختبار", sourceInvoiceNumber: null,
    dueDate: "2026-09-10", currencyCode: "SAR", exchangeRate: "1.00000000",
    subtotal: "25.0000", discountTotal: "0.0000", taxTotal: "0.0000",
    total: "25.0000", baseTotal: "25.0000", notes: null,
    lines: [{
      number: 1, itemCode: pdfInvoiceItemCode, itemName: "اسم الصنف",
      unitOfMeasureCode: pdfInvoiceUnitCode, description: "وصف الصنف",
      accountCode: "4071", accountName: "إيرادات المبيعات",
      quantity: "9999999999999.999949", unitPrice: "-777777777777777.7777",
      discount: "0.0000", taxRate: "0.0000", tax: "-888888888888888.8888",
      total: "-999999999999999.9999",
    }],
  };
  return snapshot;
}

export function pdfInvoiceCodesLimitsSnapshot(): PrintSnapshot {
  return invoiceSnapshot();
}

export function pdfInvoiceCodesContinuationSnapshot(): PrintSnapshot {
  const snapshot = invoiceSnapshot();
  const line = snapshot.invoice!.lines[0]!;
  // VARCHAR(200) and VARCHAR(500), with enough explicit lines to span pages.
  line.itemName = "اسم\n".repeat(50);
  line.description = "وصف\n".repeat(124) + "وصف";
  snapshot.invoice!.lines.push({
    ...line, number: 2, itemCode: null, itemName: null, unitOfMeasureCode: null,
    description: "السطر التالي", quantity: "1.000000", unitPrice: "4.4444",
    tax: "2.2222", total: "6.6666",
  });
  return snapshot;
}

export function pdfInvoiceSingleCodeSnapshot(): PrintSnapshot {
  const snapshot = invoiceSnapshot();
  snapshot.invoice!.lines[0]!.itemCode = null;
  snapshot.invoice!.lines[0]!.unitOfMeasureCode = "U_9073-26";
  return snapshot;
}

export function pdfInvoiceNonAsciiCodeSnapshot(): PrintSnapshot {
  const snapshot = invoiceSnapshot();
  // One invalid code must keep the entire description on the legacy path.
  snapshot.invoice!.lines[0]!.unitOfMeasureCode = "وحدة-9073";
  return snapshot;
}

export function pdfInvoiceEmptyCodeSnapshot(): PrintSnapshot {
  const snapshot = invoiceSnapshot();
  snapshot.invoice!.lines[0]!.itemCode = "";
  return snapshot;
}

export function pdfInvoiceMissingItemNameSnapshot(): PrintSnapshot {
  const snapshot = invoiceSnapshot();
  delete snapshot.invoice!.lines[0]!.itemName;
  return snapshot;
}

/** Stable names and fresh snapshots for the separately owned actual-PDF/PNG QA. */
export const pdfInvoiceItemCodeFixtures = [
  { name: "limits-wrap", create: pdfInvoiceCodesLimitsSnapshot },
  { name: "name-description-continuation", create: pdfInvoiceCodesContinuationSnapshot },
  { name: "one-code", create: pdfInvoiceSingleCodeSnapshot },
  { name: "guard-non-ascii", create: pdfInvoiceNonAsciiCodeSnapshot },
  { name: "guard-empty", create: pdfInvoiceEmptyCodeSnapshot },
  { name: "guard-missing-item-name", create: pdfInvoiceMissingItemNameSnapshot },
] as const;
