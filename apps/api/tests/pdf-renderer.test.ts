import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "../src/printing/pdf-renderer.js";
import { printSnapshotFixture } from "./fixtures/print-snapshot.js";

describe("archived document PDF renderer", () => {
  it("renders a non-empty PDF from an immutable Arabic snapshot", async () => {
    const result = await renderDocumentPdf(printSnapshotFixture);

    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.byteLength).toBeGreaterThan(8_000);
    expect(result.toString("latin1")).toContain("/Type /Page");
  });

  it("renders supplier invoice lines and input tax data", async () => {
    const result = await renderDocumentPdf({
      ...printSnapshotFixture,
      document: { ...printSnapshotFixture.document, type: "PURCHASE_INVOICE", number: "PI-2026-00100", description: "فاتورة خدمات تشغيلية" },
      settlement: null,
      invoice: { supplierName: "مؤسسة سحابة للحلول", supplierTaxMasked: "****6401", supplierAddress: "الرياض", supplierInvoiceNumber: "CLOUD-100", sourceInvoiceNumber: null, dueDate: "2026-09-10", currencyCode: "SAR", exchangeRate: "1.00000000", subtotal: "1000.0000", discountTotal: "50.0000", taxTotal: "142.5000", total: "1092.5000", baseTotal: "1092.5000", notes: null, lines: [{ number: 1, description: "خدمات سحابية", accountCode: "5130", accountName: "مصروفات تشغيلية", quantity: "1.0000", unitPrice: "1000.0000", discount: "50.0000", taxRate: "15.0000", tax: "142.5000", total: "1092.5000" }] },
    });
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.byteLength).toBeGreaterThan(8_000);
  });
});
