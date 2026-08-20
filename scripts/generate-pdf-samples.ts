import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderDocumentPdf } from "../apps/api/src/printing/pdf-renderer.js";
import type { PrintSnapshot } from "../apps/api/src/printing/print-types.js";
import { printSnapshotFixture } from "../apps/api/tests/fixtures/print-snapshot.js";

const outputDirectory = resolve("output/pdf");

const purchaseSnapshot: PrintSnapshot = {
  ...printSnapshotFixture,
  document: {
    ...printSnapshotFixture.document,
    type: "PURCHASE_INVOICE",
    number: "PI-2026-00100",
    description: "فاتورة خدمات تشغيلية",
  },
  settlement: null,
  invoice: {
    supplierName: "مؤسسة سحابة للحلول",
    supplierTaxMasked: "****6401",
    supplierAddress: "الرياض",
    supplierInvoiceNumber: "CLOUD-100",
    sourceInvoiceNumber: null,
    dueDate: "2026-09-10",
    currencyCode: "SAR",
    exchangeRate: "1.00000000",
    subtotal: "1000.0000",
    discountTotal: "50.0000",
    taxTotal: "142.5000",
    total: "1092.5000",
    baseTotal: "1092.5000",
    notes: null,
    lines: [
      {
        number: 1,
        description: "خدمات سحابية",
        accountCode: "5130",
        accountName: "مصروفات تشغيلية",
        quantity: "1.0000",
        unitPrice: "1000.0000",
        discount: "50.0000",
        taxRate: "15.0000",
        tax: "142.5000",
        total: "1092.5000",
      },
    ],
  },
};

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputDirectory, "receipt-sample.pdf"),
      await renderDocumentPdf(printSnapshotFixture),
    ),
    writeFile(
      resolve(outputDirectory, "purchase-invoice-sample.pdf"),
      await renderDocumentPdf(purchaseSnapshot),
    ),
  ]);
}

void main();
