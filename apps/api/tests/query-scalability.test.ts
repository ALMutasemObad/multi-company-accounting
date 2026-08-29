import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseInvoiceService } from '../src/purchases/purchase-invoice-service.js';
import { PrismaTaxSummaryQueryAdapter, TAX_SUMMARY_BATCH_SIZE } from '../src/reports/adapters/prisma-tax-summary-query-adapter.js';
import { ReportService } from '../src/reports/report-service.js';
import { SalesInvoiceService } from '../src/sales/sales-invoice-service.js';

const actor = { companyId: 7n, userId: 11n };

function transactionMock() {
  return vi.fn((operations: Promise<unknown>[]) => Promise.all(operations));
}

describe('bounded invoice listing queries', () => {
  it('paginates and counts sales invoices in the database, including outstandingOnly', async () => {
    const row = { id: 91n };
    const findMany = vi.fn((_query: unknown) => Promise.resolve([row]));
    const count = vi.fn((_query: unknown) => Promise.resolve(41));
    const service = new SalesInvoiceService({
      salesInvoice: { findMany, count },
      $transaction: transactionMock(),
    } as never, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      receivables: {} as never,
    });

    const result = await service.list(actor, { page: 3, pageSize: 20, outstandingOnly: true });
    const pageQuery = findMany.mock.calls[0]![0] as {
      skip: number;
      take: number;
      where: { AND: unknown[] };
    };

    expect(result).toEqual({ data: [row], total: 41 });
    expect(pageQuery).toMatchObject({ skip: 40, take: 20 });
    expect(pageQuery.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: actor.companyId }),
      { accountingDocument: { documentType: 'SALES_INVOICE', status: 'POSTED' } },
      { receivableItem: { is: { outstandingAmount: { gt: 0 } } } },
    ]));
    expect(count).toHaveBeenCalledWith({ where: pageQuery.where });
  });

  it('paginates and counts purchase invoices in the database, including outstandingOnly', async () => {
    const row = { id: 92n };
    const findMany = vi.fn((_query: unknown) => Promise.resolve([row]));
    const count = vi.fn((_query: unknown) => Promise.resolve(26));
    const service = new PurchaseInvoiceService({
      purchaseInvoice: { findMany, count },
      $transaction: transactionMock(),
    } as never, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      payables: {} as never,
    });

    const result = await service.list(actor, { page: 2, pageSize: 10, outstandingOnly: true });
    const pageQuery = findMany.mock.calls[0]![0] as {
      skip: number;
      take: number;
      where: { AND: unknown[] };
    };

    expect(result).toEqual({ data: [row], total: 26 });
    expect(pageQuery).toMatchObject({ skip: 10, take: 10 });
    expect(pageQuery.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: actor.companyId }),
      { accountingDocument: { documentType: 'PURCHASE_INVOICE', status: 'POSTED' } },
      { payableItem: { is: { outstandingAmount: { gt: 0 } } } },
    ]));
    expect(count).toHaveBeenCalledWith({ where: pageQuery.where });
  });
});

describe('bounded reporting reads', () => {
  it('keeps ledger pagination in SQL while preserving running and closing balances', async () => {
    const aggregate = vi.fn((_query: unknown) => Promise.resolve({
      _sum: { baseDebitAmount: new Prisma.Decimal('100.0000'), baseCreditAmount: new Prisma.Decimal('0.0000') },
    }));
    aggregate
      .mockResolvedValueOnce({ _sum: { baseDebitAmount: new Prisma.Decimal('100.0000'), baseCreditAmount: new Prisma.Decimal('0.0000') } })
      .mockResolvedValueOnce({ _sum: { baseDebitAmount: new Prisma.Decimal('40.0000'), baseCreditAmount: new Prisma.Decimal('10.0000') } });
    const queryRaw = vi.fn((_query: unknown) => Promise.resolve([
      {
        id: 3n,
        entry_date: new Date('2026-01-03T00:00:00.000Z'),
        document_id: 103n,
        document_number: 'JV-3',
        document_type: 'MANUAL_JOURNAL',
        document_status: 'POSTED',
        line_description: null,
        entry_description: 'القيد الثالث',
        debit: new Prisma.Decimal('10.0000'),
        credit: new Prisma.Decimal('0.0000'),
        range_running: new Prisma.Decimal('30.0000'),
      },
      {
        id: 4n,
        entry_date: new Date('2026-01-04T00:00:00.000Z'),
        document_id: 104n,
        document_number: 'JV-4',
        document_type: 'MANUAL_JOURNAL',
        document_status: 'POSTED',
        line_description: 'السطر الرابع',
        entry_description: 'القيد الرابع',
        debit: new Prisma.Decimal('0.0000'),
        credit: new Prisma.Decimal('5.0000'),
        range_running: new Prisma.Decimal('25.0000'),
      },
    ]));
    const prisma = {
      account: { findFirst: vi.fn((_query: unknown) => Promise.resolve({ id: 5n, code: '1110', nameAr: 'النقد', nameEn: 'Cash' })) },
      costCenter: { findFirst: vi.fn((_query: unknown) => Promise.resolve(null)) },
      company: { findUniqueOrThrow: vi.fn((_query: unknown) => Promise.resolve({ name: 'شركة', baseCurrency: { id: 1n, code: 'SAR', nameAr: 'ريال', decimals: 2 } })) },
      journalLine: { aggregate, count: vi.fn((_query: unknown) => Promise.resolve(5)) },
      $queryRaw: queryRaw,
      $transaction: transactionMock(),
    };

    const report = await new ReportService(prisma as never).ledger(actor, {
      accountId: 5n,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      page: 2,
      pageSize: 2,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(report.data).toHaveLength(2);
    expect(report.data[0]).toMatchObject({ id: '3', runningDebit: '130.0000', runningCredit: '0.0000' });
    expect(report.data[1]).toMatchObject({ id: '4', runningDebit: '125.0000', runningCredit: '0.0000' });
    expect(report.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(report.closingDebit).toBe('130.0000');
  });

  it('scans tax invoices in fixed-size keyset batches', async () => {
    const rows = Array.from({ length: TAX_SUMMARY_BATCH_SIZE + 1 }, (_value, index) => ({
      id: BigInt(index + 1),
      exchangeRate: new Prisma.Decimal('1.00000000'),
      accountingDocument: {
        id: BigInt(index + 101),
        documentDate: new Date('2026-08-01T00:00:00.000Z'),
        status: 'POSTED',
        documentType: 'SALES_INVOICE',
        reversedByDocument: null,
      },
      lines: [{ taxRateId: 15n, taxRateSnapshot: new Prisma.Decimal('15.0000'), netAmount: new Prisma.Decimal('1.0000'), taxAmount: new Prisma.Decimal('0.1500') }],
    }));
    const salesFindMany = vi.fn((query: { where: { id?: { gt: bigint } }; take: number }) => {
      const cursor = query.where.id?.gt ?? 0n;
      return Promise.resolve(rows.filter((row) => row.id > cursor).slice(0, query.take));
    });
    const purchaseFindMany = vi.fn((_query: unknown) => Promise.resolve([]));
    const adapter = new PrismaTaxSummaryQueryAdapter();
    const sizes: number[] = [];

    await adapter.scanInvoices({
      salesInvoice: { findMany: salesFindMany },
      purchaseInvoice: { findMany: purchaseFindMany },
    } as never, actor.companyId, new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T00:00:00.000Z'), (batch) => {
      sizes.push(batch.length);
    });

    expect(sizes).toEqual([TAX_SUMMARY_BATCH_SIZE, 1]);
    expect(salesFindMany).toHaveBeenCalledTimes(2);
    expect(salesFindMany.mock.calls.every(([query]) => query.take === TAX_SUMMARY_BATCH_SIZE)).toBe(true);
    expect(salesFindMany.mock.calls[1]![0].where.id).toEqual({ gt: BigInt(TAX_SUMMARY_BATCH_SIZE) });
    expect(purchaseFindMany).toHaveBeenCalledTimes(1);
  });
});
