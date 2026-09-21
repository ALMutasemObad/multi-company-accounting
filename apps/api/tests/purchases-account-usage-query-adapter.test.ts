import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PurchasesAccountUsageQueryAdapter } from "../src/purchases/purchases-account-usage-query-adapter.js";

describe("PurchasesAccountUsageQueryAdapter", () => {
  it("returns Supplier then invoice history with company-scoped totals", async () => {
    const supplierCount = vi.fn().mockResolvedValue(2);
    const invoiceLineCount = vi.fn().mockResolvedValue(4);
    const immutableInvoiceLine = vi.fn().mockResolvedValue({ id: 41n });
    const tx = {
      supplier: { count: supplierCount },
      purchaseInvoiceLine: { count: invoiceLineCount, findFirst: immutableInvoiceLine },
    } as unknown as Prisma.TransactionClient;

    await expect(new PurchasesAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "PURCHASES_SUPPLIER", count: 2, hasImmutableHistory: false },
      { category: "PURCHASES_INVOICE_HISTORY", count: 4, hasImmutableHistory: true },
    ]);
    expect(supplierCount).toHaveBeenCalledWith({ where: { companyId: 7n, payableAccountId: 11n } });
    expect(invoiceLineCount).toHaveBeenCalledWith({ where: { companyId: 7n, debitAccountId: 11n } });
    expect(immutableInvoiceLine).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        debitAccountId: 11n,
        purchaseInvoice: {
          companyId: 7n,
          accountingDocument: {
            companyId: 7n,
            documentType: { in: ["PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE"] },
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          },
        },
      },
      select: { id: true },
    });
  });

  it("counts DRAFT lines as use without immutable history", async () => {
    const tx = {
      supplier: { count: vi.fn().mockResolvedValue(0) },
      purchaseInvoiceLine: {
        count: vi.fn().mockResolvedValue(5),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(new PurchasesAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "PURCHASES_SUPPLIER", count: 0, hasImmutableHistory: false },
      { category: "PURCHASES_INVOICE_HISTORY", count: 5, hasImmutableHistory: false },
    ]);
  });

  it("isolates every lookup to the requested company", async () => {
    const supplierCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const invoiceLineCount = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const immutableInvoiceLine = vi.fn().mockResolvedValueOnce({ id: 41n }).mockResolvedValueOnce(null);
    const tx = {
      supplier: { count: supplierCount },
      purchaseInvoiceLine: { count: invoiceLineCount, findFirst: immutableInvoiceLine },
    } as unknown as Prisma.TransactionClient;
    const adapter = new PurchasesAccountUsageQueryAdapter();

    await adapter.queryAccountUsage(tx, 7n, 11n);
    await adapter.queryAccountUsage(tx, 8n, 11n);

    for (const [index, companyId] of [[0, 7n], [1, 8n]] as const) {
      expect(supplierCount.mock.calls[index]?.[0]).toEqual({ where: { companyId, payableAccountId: 11n } });
      expect(invoiceLineCount.mock.calls[index]?.[0]).toEqual({ where: { companyId, debitAccountId: 11n } });
      expect(immutableInvoiceLine.mock.calls[index]?.[0]).toMatchObject({
        where: {
          companyId,
          debitAccountId: 11n,
          purchaseInvoice: { companyId, accountingDocument: { companyId } },
        },
      });
    }
  });
});
