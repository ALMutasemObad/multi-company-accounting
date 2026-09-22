import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SalesAccountUsageQueryAdapter } from "../src/sales/sales-account-usage-query-adapter.js";

describe("SalesAccountUsageQueryAdapter", () => {
  it("returns Customer, Selling Profile, then invoice history with company-scoped counts", async () => {
    const customerCount = vi.fn().mockResolvedValue(2);
    const sellingProfileCount = vi.fn().mockResolvedValue(3);
    const invoiceLineCount = vi.fn().mockResolvedValue(4);
    const immutableInvoiceLine = vi.fn().mockResolvedValue({ id: 41n });
    const tx = {
      customer: { count: customerCount },
      salesItemSellingProfile: { count: sellingProfileCount },
      salesInvoiceLine: { count: invoiceLineCount, findFirst: immutableInvoiceLine },
    } as unknown as Prisma.TransactionClient;

    await expect(new SalesAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "SALES_CUSTOMER", count: 2, hasImmutableHistory: false },
      { category: "SALES_SELLING_PROFILE", count: 3, hasImmutableHistory: false },
      { category: "SALES_INVOICE_HISTORY", count: 4, hasImmutableHistory: true },
    ]);
    expect(customerCount).toHaveBeenCalledWith({ where: { companyId: 7n, receivableAccountId: 11n } });
    expect(sellingProfileCount).toHaveBeenCalledWith({ where: { companyId: 7n, revenueAccountId: 11n } });
    expect(invoiceLineCount).toHaveBeenCalledWith({ where: { companyId: 7n, revenueAccountId: 11n } });
    expect(immutableInvoiceLine).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        revenueAccountId: 11n,
        salesInvoice: {
          companyId: 7n,
          accountingDocument: {
            companyId: 7n,
            documentType: { in: ["SALES_INVOICE", "SALES_CREDIT_NOTE"] },
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          },
        },
      },
      select: { id: true },
    });
  });

  it("counts DRAFT invoice lines as use without marking immutable history", async () => {
    const tx = {
      customer: { count: vi.fn().mockResolvedValue(0) },
      salesItemSellingProfile: { count: vi.fn().mockResolvedValue(0) },
      salesInvoiceLine: {
        count: vi.fn().mockResolvedValue(5),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(new SalesAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "SALES_CUSTOMER", count: 0, hasImmutableHistory: false },
      { category: "SALES_SELLING_PROFILE", count: 0, hasImmutableHistory: false },
      { category: "SALES_INVOICE_HISTORY", count: 5, hasImmutableHistory: false },
    ]);
  });

  it("keeps every Sales lookup isolated to the requested company", async () => {
    const customerCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const sellingProfileCount = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const invoiceLineCount = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const immutableInvoiceLine = vi.fn().mockResolvedValueOnce({ id: 41n }).mockResolvedValueOnce(null);
    const tx = {
      customer: { count: customerCount },
      salesItemSellingProfile: { count: sellingProfileCount },
      salesInvoiceLine: { count: invoiceLineCount, findFirst: immutableInvoiceLine },
    } as unknown as Prisma.TransactionClient;
    const adapter = new SalesAccountUsageQueryAdapter();

    await expect(adapter.queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "SALES_CUSTOMER", count: 1, hasImmutableHistory: false },
      { category: "SALES_SELLING_PROFILE", count: 2, hasImmutableHistory: false },
      { category: "SALES_INVOICE_HISTORY", count: 3, hasImmutableHistory: true },
    ]);
    await expect(adapter.queryAccountUsage(tx, 8n, 11n)).resolves.toEqual([
      { category: "SALES_CUSTOMER", count: 0, hasImmutableHistory: false },
      { category: "SALES_SELLING_PROFILE", count: 0, hasImmutableHistory: false },
      { category: "SALES_INVOICE_HISTORY", count: 0, hasImmutableHistory: false },
    ]);

    for (const [index, companyId] of [[1, 7n], [2, 8n]] as const) {
      expect(customerCount.mock.calls[index - 1]?.[0]).toEqual({ where: { companyId, receivableAccountId: 11n } });
      expect(sellingProfileCount.mock.calls[index - 1]?.[0]).toEqual({ where: { companyId, revenueAccountId: 11n } });
      expect(invoiceLineCount.mock.calls[index - 1]?.[0]).toEqual({ where: { companyId, revenueAccountId: 11n } });
      expect(immutableInvoiceLine.mock.calls[index - 1]?.[0]).toMatchObject({
        where: {
          companyId,
          revenueAccountId: 11n,
          salesInvoice: { companyId, accountingDocument: { companyId } },
        },
      });
    }
  });
});
