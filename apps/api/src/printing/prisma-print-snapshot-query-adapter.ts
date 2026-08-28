import type { Prisma } from '@prisma/client';
import type { PrintSnapshotQueryPort } from './print-ports.js';
import type { PrintSnapshot } from './print-types.js';

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** Dedicated downstream read adapter. It may join source contexts but owns no writes. */
export class PrismaPrintSnapshotQueryAdapter implements PrintSnapshotQueryPort {
  async load(tx: Prisma.TransactionClient, companyId: bigint, documentId: bigint): Promise<PrintSnapshot | null> {
    const document = await tx.accountingDocument.findFirst({
      where: { id: documentId, companyId, status: { in: ['POSTED', 'REVERSED'] }, postedAt: { not: null } },
      include: {
        company: { include: { baseCurrency: true } }, creator: true, poster: true,
        receipt: { include: { cashBankAccount: true, paymentMethod: true, currency: true } },
        payment: { include: { cashBankAccount: true, paymentMethod: true, currency: true } },
        salesInvoice: { include: { currency: true, sourceInvoice: { include: { accountingDocument: true } }, lines: { orderBy: { lineNumber: 'asc' }, include: { revenueAccount: true } } } },
        purchaseInvoice: { include: { currency: true, sourceInvoice: { include: { accountingDocument: true } }, lines: { orderBy: { lineNumber: 'asc' }, include: { debitAccount: true } } } },
        journalEntries: { orderBy: { entryNumber: 'asc' }, include: { lines: { orderBy: { lineNumber: 'asc' }, include: { account: true, costCenter: true, currency: true } } } },
      },
    });
    if (!document || !document.postedAt || !document.poster) return null;
    if (!['RECEIPT', 'PAYMENT', 'MANUAL_JOURNAL', 'PURCHASE_INVOICE', 'PURCHASE_DEBIT_NOTE', 'SALES_INVOICE', 'SALES_CREDIT_NOTE'].includes(document.documentType)) return null;
    const documentType = document.documentType as PrintSnapshot['document']['type'];
    const settlementSource = document.receipt ?? document.payment;
    return {
      formatVersion: 1,
      archivedAt: new Date().toISOString(),
      company: { id: document.company.id.toString(), name: document.company.name, timezone: document.company.timezone, baseCurrencyCode: document.company.baseCurrency.code, baseCurrencyNameAr: document.company.baseCurrency.nameAr },
      document: { id: document.id.toString(), type: documentType, number: document.documentNumber, date: dateOnly(document.documentDate), description: document.description, statusAtArchive: 'POSTED', createdAt: document.createdAt.toISOString(), postedAt: document.postedAt.toISOString(), creatorName: document.creator.displayName, posterName: document.poster.displayName },
      settlement: settlementSource ? { counterpartyName: settlementSource.counterpartyNameSnapshot, counterpartyTaxMasked: settlementSource.counterpartyTaxLast4 ? `****${settlementSource.counterpartyTaxLast4}` : null, counterpartyAddress: settlementSource.counterpartyAddressSnapshot, cashBankAccount: settlementSource.cashBankAccount.nameAr, paymentMethod: settlementSource.paymentMethod.nameAr, currencyCode: settlementSource.currency.code, exchangeRate: settlementSource.exchangeRate.toFixed(8), amount: settlementSource.amount.toFixed(4), baseAmount: settlementSource.baseAmount.toFixed(4), referenceNumber: settlementSource.referenceNumber, notes: settlementSource.notes } : null,
      invoice: document.purchaseInvoice ? {
        partyKind: 'SUPPLIER', partyName: document.purchaseInvoice.supplierNameSnapshot,
        partyTaxMasked: document.purchaseInvoice.supplierTaxLast4 ? `****${document.purchaseInvoice.supplierTaxLast4}` : null,
        partyAddress: document.purchaseInvoice.supplierAddressSnapshot,
        externalInvoiceNumber: document.purchaseInvoice.supplierInvoiceNumber,
        sourceInvoiceNumber: document.purchaseInvoice.sourceInvoice?.accountingDocument.documentNumber ?? null,
        warehouseCode: document.purchaseInvoice.warehouseCodeSnapshot, warehouseName: document.purchaseInvoice.warehouseNameSnapshot,
        dueDate: dateOnly(document.purchaseInvoice.dueDate), currencyCode: document.purchaseInvoice.currency.code,
        exchangeRate: document.purchaseInvoice.exchangeRate.toFixed(8), subtotal: document.purchaseInvoice.subtotal.toFixed(4),
        discountTotal: document.purchaseInvoice.discountTotal.toFixed(4), taxTotal: document.purchaseInvoice.taxTotal.toFixed(4),
        total: document.purchaseInvoice.total.toFixed(4), baseTotal: document.purchaseInvoice.baseTotal.toFixed(4), notes: document.purchaseInvoice.notes,
        lines: document.purchaseInvoice.lines.map((line) => ({ number: line.lineNumber, itemCode: line.inventoryItemCodeSnapshot, itemName: line.inventoryItemNameSnapshot, unitOfMeasureCode: line.unitOfMeasureCodeSnapshot, description: line.description, accountCode: line.debitAccount.code, accountName: line.debitAccount.nameAr, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discount: line.discountAmount.toFixed(4), taxRate: line.taxRateSnapshot.toFixed(4), tax: line.taxAmount.toFixed(4), total: line.totalAmount.toFixed(4) })),
      } : document.salesInvoice ? {
        partyKind: 'CUSTOMER', partyName: document.salesInvoice.customerNameSnapshot,
        partyTaxMasked: document.salesInvoice.customerTaxLast4 ? `****${document.salesInvoice.customerTaxLast4}` : null,
        partyAddress: document.salesInvoice.customerAddressSnapshot, externalInvoiceNumber: null,
        sourceInvoiceNumber: document.salesInvoice.sourceInvoice?.accountingDocument.documentNumber ?? null,
        warehouseCode: document.salesInvoice.warehouseCodeSnapshot, warehouseName: document.salesInvoice.warehouseNameSnapshot,
        dueDate: dateOnly(document.salesInvoice.dueDate), currencyCode: document.salesInvoice.currency.code,
        exchangeRate: document.salesInvoice.exchangeRate.toFixed(8), subtotal: document.salesInvoice.subtotal.toFixed(4),
        discountTotal: document.salesInvoice.discountTotal.toFixed(4), taxTotal: document.salesInvoice.taxTotal.toFixed(4),
        total: document.salesInvoice.total.toFixed(4), baseTotal: document.salesInvoice.baseTotal.toFixed(4), notes: document.salesInvoice.notes,
        lines: document.salesInvoice.lines.map((line) => ({ number: line.lineNumber, itemCode: line.inventoryItemCodeSnapshot, itemName: line.inventoryItemNameSnapshot, unitOfMeasureCode: line.unitOfMeasureCodeSnapshot, description: line.description, accountCode: line.revenueAccount.code, accountName: line.revenueAccount.nameAr, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discount: line.discountAmount.toFixed(4), taxRate: line.taxRateSnapshot.toFixed(4), tax: line.taxAmount.toFixed(4), total: line.totalAmount.toFixed(4) })),
      } : null,
      entries: document.journalEntries.map((entry) => ({ number: entry.entryNumber, date: dateOnly(entry.entryDate), description: entry.description, lines: entry.lines.map((line) => ({ number: line.lineNumber, accountCode: line.account.code, accountName: line.account.nameAr, costCenter: line.costCenter?.nameAr ?? null, description: line.description, currencyCode: line.currency.code, exchangeRate: line.exchangeRate.toFixed(8), debit: line.debitAmount.toFixed(4), credit: line.creditAmount.toFixed(4), baseDebit: line.baseDebitAmount.toFixed(4), baseCredit: line.baseCreditAmount.toFixed(4) })) })),
    };
  }
}
