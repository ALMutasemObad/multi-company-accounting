import { Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseInvoiceService } from '../src/purchases/purchase-invoice-service.js';
import { PrismaTaxSummaryQueryAdapter, TAX_SUMMARY_BATCH_SIZE } from '../src/reports/adapters/prisma-tax-summary-query-adapter.js';
import { ReportService } from '../src/reports/report-service.js';
import { SalesInvoiceService } from '../src/sales/sales-invoice-service.js';
import {
  PLATFORM_BILLING_RECENT_PAYMENT_LIMIT,
  PlatformBillingService,
} from '../src/platform-operations/platform-billing-service.js';

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

describe('bounded platform billing reads', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  const billingAccount = {
    id: 31n,
    companyId: 9n,
    status: 'ACTIVE',
    planName: 'Scale plan',
    billingCycle: 'MONTHLY',
    currencyCode: 'SAR',
    recurringFee: new Prisma.Decimal('100.0000'),
    includedUsers: 5,
    pricePerAdditionalUser: new Prisma.Decimal('10.0000'),
    includedEmployees: 5,
    pricePerAdditionalEmployee: new Prisma.Decimal('10.0000'),
    includedPostedDocuments: 100,
    pricePerAdditionalPostedDocument: new Prisma.Decimal('1.0000'),
    taxRate: new Prisma.Decimal('15.0000'),
    paymentTermsDays: 30,
    nextBillingDate: new Date('2026-09-01T00:00:00.000Z'),
    notes: null,
    version: 0,
    createdById: 7n,
    updatedById: 7n,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('pages account rows while deriving global metrics and page totals with constant aggregate queries', async () => {
    const findMany = vi.fn((_query: unknown) => Promise.resolve([billingAccount]));
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        currency_code: 'SAR',
        configured_accounts: 41n,
        active_accounts: 20n,
        billed: new Prisma.Decimal('900719925474099.1234'),
        paid: new Prisma.Decimal('1.0000'),
        balance: new Prisma.Decimal('900719925474098.1234'),
        overdue: new Prisma.Decimal('50.0000'),
        overdue_invoices: 5n,
      }])
      .mockResolvedValueOnce([{
        currency_code: 'SAR',
        billing_cycle: 'QUARTERLY',
        recurring_fee: new Prisma.Decimal('370.3701'),
      }])
      .mockResolvedValueOnce([{
        billing_account_id: 31n,
        billed: new Prisma.Decimal('800.0000'),
        paid: new Prisma.Decimal('300.0000'),
        balance: new Prisma.Decimal('500.0000'),
        overdue: new Prisma.Decimal('200.0000'),
        overdue_invoices: 2n,
      }]);
    const companyReferences = vi.fn((_ids: bigint[]) => Promise.resolve([{
      id: '9', name: 'شركة تسعة', isActive: true, baseCurrencyCode: 'SAR',
    }]));
    const service = new PlatformBillingService({
      platformBillingAccount: { findMany },
      $queryRaw: queryRaw,
    } as never, { requireOperator: vi.fn() } as never, {
      companyCount: vi.fn().mockResolvedValue(100),
      companyReferences,
    } as never, {} as never, () => now);

    const result = await service.summary(7n, { page: 3, pageSize: 10 });
    const pageQuery = findMany.mock.calls[0]![0] as { skip: number; take: number; orderBy: unknown };

    expect(pageQuery).toMatchObject({ skip: 20, take: 10, orderBy: [{ nextBillingDate: 'asc' }, { id: 'asc' }] });
    expect(companyReferences).toHaveBeenCalledWith([9n]);
    expect(queryRaw).toHaveBeenCalledTimes(3);
    const recurringAggregateSql = (queryRaw.mock.calls[1]![0] as { sql: string }).sql;
    expect(recurringAggregateSql).toContain('GROUP BY account.currency_code, account.billing_cycle');
    expect(recurringAggregateSql).not.toMatch(/recurring_fee\s*\/\s*(?:3|12)/u);
    expect(result.meta).toEqual({ page: 3, pageSize: 10, total: 41, totalPages: 5 });
    expect(result.metrics).toEqual({
      totalCompanies: 100,
      configuredCompanies: 41,
      unconfiguredCompanies: 59,
      activeAccounts: 20,
      overdueInvoices: 5,
    });
    expect(result.currencies[0]).toMatchObject({
      billed: '900719925474099.1234',
      balance: '900719925474098.1234',
      recurringMonthly: '123.4567',
      collectionRate: '0.0',
    });
    expect(result.accounts[0]).toMatchObject({ billed: '800.0000', paid: '300.0000', balance: '500.0000' });
  });

  it('loads lines and payments only for the requested invoice page while totals cover all history', async () => {
    const invoice = {
      id: 71n,
      publicId: '00000000-0000-4000-8000-000000000071',
      companyId: 9n,
      billingAccountId: 31n,
      invoiceNumber: 'PLT-2026-71',
      state: 'ISSUED',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-07-31T00:00:00.000Z'),
      issueDate: new Date('2026-08-01T00:00:00.000Z'),
      dueDate: new Date('2026-08-15T00:00:00.000Z'),
      currencyCode: 'SAR',
      usageUsers: 1,
      usageEmployees: 1,
      usagePostedDocuments: 1,
      usageOperations: 1,
      subtotal: new Prisma.Decimal('10.0000'),
      taxRateSnapshot: new Prisma.Decimal('0.0000'),
      taxAmount: new Prisma.Decimal('0.0000'),
      totalAmount: new Prisma.Decimal('10.0000'),
      notes: null,
      version: 0,
      issuedById: 7n,
      voidedById: null,
      voidedAt: null,
      voidReason: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      lines: [{
        id: 81n,
        companyId: 9n,
        invoiceId: 71n,
        lineNumber: 1,
        lineType: 'RECURRING_FEE',
        description: 'Fee',
        quantity: 1,
        unitPrice: new Prisma.Decimal('10.0000'),
        amount: new Prisma.Decimal('10.0000'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      }],
      payments: Array.from({ length: 7 }, (_, index) => ({
        id: BigInt(91 + index),
        publicId: `00000000-0000-4000-8000-${String(91 + index).padStart(12, '0')}`,
        companyId: 9n,
        invoiceId: 71n,
        paymentDate: new Date(`2026-08-${String(8 - index).padStart(2, '0')}T00:00:00.000Z`),
        amount: new Prisma.Decimal('1.0000'),
        method: 'BANK_TRANSFER',
        reference: null,
        notes: null,
        receivedById: 7n,
        createdAt: new Date(`2026-08-${String(8 - index).padStart(2, '0')}T00:00:00.000Z`),
      })),
    };
    const invoiceFindMany = vi.fn((_query: unknown) => Promise.resolve([invoice]));
    const paymentGroupBy = vi.fn().mockResolvedValue([{
      invoiceId: 71n,
      _sum: { amount: new Prisma.Decimal('7.0000') },
      _count: { _all: 7 },
    }]);
    const queryRaw = vi.fn().mockResolvedValue([{
      billing_account_id: 31n,
      billed: new Prisma.Decimal('1000.0000'),
      paid: new Prisma.Decimal('400.0000'),
      balance: new Prisma.Decimal('600.0000'),
      overdue: new Prisma.Decimal('250.0000'),
      overdue_invoices: 3n,
    }]);
    const service = new PlatformBillingService({
      platformBillingAccount: { findUnique: vi.fn().mockResolvedValue(billingAccount) },
      platformBillingInvoice: { count: vi.fn().mockResolvedValue(31), findMany: invoiceFindMany },
      platformBillingPayment: { groupBy: paymentGroupBy },
      $queryRaw: queryRaw,
    } as never, { requireOperator: vi.fn() } as never, {
      companyReferences: vi.fn().mockResolvedValue([{
        id: '9', name: 'شركة تسعة', isActive: true, baseCurrencyCode: 'SAR',
      }]),
    } as never, {} as never, () => now);

    const result = await service.companyBilling(7n, 9n, { page: 2, pageSize: 5 });
    const pageQuery = invoiceFindMany.mock.calls[0]![0] as {
      skip: number;
      take: number;
      include: { lines: unknown; payments: { take: number; orderBy: unknown } };
    };

    expect(pageQuery).toMatchObject({ skip: 5, take: 5 });
    expect(pageQuery.include).toHaveProperty('lines');
    expect(pageQuery.include.payments).toMatchObject({ take: PLATFORM_BILLING_RECENT_PAYMENT_LIMIT });
    expect(invoiceFindMany).toHaveBeenCalledTimes(1);
    expect(paymentGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['invoiceId'],
      where: { companyId: 9n, invoiceId: { in: [71n] } },
    }));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual({ page: 2, pageSize: 5, total: 31, totalPages: 7 });
    expect(result.totals).toEqual({ billed: '1000.0000', paid: '400.0000', balance: '600.0000', overdue: '250.0000' });
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({ paidAmount: '7.0000', balance: '3.0000', paymentCount: 7 });
    expect(result.invoices[0]!.payments).toHaveLength(PLATFORM_BILLING_RECENT_PAYMENT_LIMIT);
  });
});

describe('bounded platform subscription reads', () => {
  it('guards every new list path against in-memory pagination', async () => {
    const owner = await readFile(new URL('../src/platform-subscriptions/platform-subscription-service.ts', import.meta.url), 'utf8');
    const listPlans = owner.slice(owner.indexOf('async listPlans('), owner.indexOf('async plan('));
    const listSubscriptions = owner.slice(owner.indexOf('async listSubscriptions('), owner.indexOf('async operatorCompany('));
    const ownerCatalog = owner.slice(owner.indexOf('async ownerCatalog('), owner.indexOf('async scheduleOperatorChange('));
    for (const method of [listPlans, listSubscriptions, ownerCatalog]) {
      expect(method).toMatch(/\.count\s*\(/u);
      expect(method).toMatch(/\.findMany\s*\(/u);
      expect(method).toMatch(/skip:\s*\(input\.page - 1\) \* input\.pageSize/u);
      expect(method).toMatch(/take:\s*input\.pageSize/u);
      expect(method).not.toMatch(/\.slice\s*\(/u);
    }
  });
});

describe('bounded platform analytics billing reads', () => {
  it('keeps invoice and payment history behind cursor batches and aggregated payment totals', async () => {
    const source = await readFile(
      new URL('../src/platform-operations/prisma-platform-analytics-query-adapter.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/platformBillingInvoice\.findMany\([\s\S]*?take: PLATFORM_ANALYTICS_BILLING_BATCH_SIZE/u);
    expect(source).toMatch(/platformBillingPayment\.groupBy\([\s\S]*?by: \["invoiceId"\][\s\S]*?_sum: \{ amount: true \}/u);
    expect(source).toMatch(/platformBillingPayment\.findMany\([\s\S]*?take: PLATFORM_ANALYTICS_BILLING_BATCH_SIZE/u);
    expect(source).toMatch(/platformBillingAccount\.groupBy\([\s\S]*?by: \["currencyCode", "billingCycle"\][\s\S]*?_sum: \{ recurringFee: true \}/u);
    expect(source).not.toMatch(/platformBillingInvoice\.findMany\([\s\S]{0,1200}?payments\s*:/u);
  });
});
