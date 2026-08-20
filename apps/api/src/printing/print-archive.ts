import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import type { PrintSnapshot } from "./print-types.js";

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)!;
  }
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("Print snapshot contains an unsupported JSON value");
};

export const snapshotJson = (snapshot: PrintSnapshot) => canonicalJson(snapshot);
export const snapshotHash = (snapshot: PrintSnapshot) => createHash("sha256").update(snapshotJson(snapshot)).digest("hex");
export const snapshotHashMatches = (snapshot: PrintSnapshot, expectedHash: string) => {
  if (snapshotHash(snapshot) === expectedHash) return true;
  const legacyHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return legacyHash === expectedHash;
};

export async function archiveDocument(tx: Prisma.TransactionClient, context: ActorContext, documentId: bigint) {
  const existing = await tx.documentPrintArchive.findFirst({ where: { accountingDocumentId: documentId, companyId: context.companyId } });
  if (existing) return existing;
  const document = await tx.accountingDocument.findFirst({
    where: { id: documentId, companyId: context.companyId, status: { in: ["POSTED", "REVERSED"] }, postedAt: { not: null } },
    include: {
      company: { include: { baseCurrency: true } }, creator: true, poster: true,
      receipt: { include: { cashBankAccount: true, paymentMethod: true, currency: true } },
      payment: { include: { cashBankAccount: true, paymentMethod: true, currency: true } },
      purchaseInvoice: { include: { currency: true, sourceInvoice: { include: { accountingDocument: true } }, lines: { orderBy: { lineNumber: "asc" }, include: { debitAccount: true } } } },
      journalEntries: { orderBy: { entryNumber: "asc" }, include: { lines: { orderBy: { lineNumber: "asc" }, include: { account: true, costCenter: true, currency: true } } } },
    },
  });
  if (!document || !document.postedAt || !document.poster) throw new Error("DOCUMENT_NOT_PRINTABLE");
  if (!["RECEIPT", "PAYMENT", "MANUAL_JOURNAL", "PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE"].includes(document.documentType)) throw new Error("DOCUMENT_NOT_PRINTABLE");
  const documentType = document.documentType as PrintSnapshot["document"]["type"];
  const settlementSource = document.receipt ?? document.payment;
  const snapshot: PrintSnapshot = {
    formatVersion: 1,
    archivedAt: new Date().toISOString(),
    company: { id: document.company.id.toString(), name: document.company.name, timezone: document.company.timezone, baseCurrencyCode: document.company.baseCurrency.code, baseCurrencyNameAr: document.company.baseCurrency.nameAr },
    document: { id: document.id.toString(), type: documentType, number: document.documentNumber, date: dateOnly(document.documentDate), description: document.description, statusAtArchive: "POSTED", createdAt: document.createdAt.toISOString(), postedAt: document.postedAt.toISOString(), creatorName: document.creator.displayName, posterName: document.poster.displayName },
    settlement: settlementSource ? { counterpartyName: settlementSource.counterpartyNameSnapshot, counterpartyTaxMasked: settlementSource.counterpartyTaxLast4 ? `****${settlementSource.counterpartyTaxLast4}` : null, counterpartyAddress: settlementSource.counterpartyAddressSnapshot, cashBankAccount: settlementSource.cashBankAccount.nameAr, paymentMethod: settlementSource.paymentMethod.nameAr, currencyCode: settlementSource.currency.code, exchangeRate: settlementSource.exchangeRate.toFixed(8), amount: settlementSource.amount.toFixed(4), baseAmount: settlementSource.baseAmount.toFixed(4), referenceNumber: settlementSource.referenceNumber, notes: settlementSource.notes } : null,
    invoice: document.purchaseInvoice ? {
      supplierName: document.purchaseInvoice.supplierNameSnapshot,
      supplierTaxMasked: document.purchaseInvoice.supplierTaxLast4 ? `****${document.purchaseInvoice.supplierTaxLast4}` : null,
      supplierAddress: document.purchaseInvoice.supplierAddressSnapshot,
      supplierInvoiceNumber: document.purchaseInvoice.supplierInvoiceNumber,
      sourceInvoiceNumber: document.purchaseInvoice.sourceInvoice?.accountingDocument.documentNumber ?? null,
      dueDate: dateOnly(document.purchaseInvoice.dueDate),
      currencyCode: document.purchaseInvoice.currency.code,
      exchangeRate: document.purchaseInvoice.exchangeRate.toFixed(8),
      subtotal: document.purchaseInvoice.subtotal.toFixed(4),
      discountTotal: document.purchaseInvoice.discountTotal.toFixed(4),
      taxTotal: document.purchaseInvoice.taxTotal.toFixed(4),
      total: document.purchaseInvoice.total.toFixed(4),
      baseTotal: document.purchaseInvoice.baseTotal.toFixed(4),
      notes: document.purchaseInvoice.notes,
      lines: document.purchaseInvoice.lines.map((line) => ({ number: line.lineNumber, description: line.description, accountCode: line.debitAccount.code, accountName: line.debitAccount.nameAr, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(4), discount: line.discountAmount.toFixed(4), taxRate: line.taxRateSnapshot.toFixed(4), tax: line.taxAmount.toFixed(4), total: line.totalAmount.toFixed(4) })),
    } : null,
    entries: document.journalEntries.map((entry) => ({ number: entry.entryNumber, date: dateOnly(entry.entryDate), description: entry.description, lines: entry.lines.map((line) => ({ number: line.lineNumber, accountCode: line.account.code, accountName: line.account.nameAr, costCenter: line.costCenter?.nameAr ?? null, description: line.description, currencyCode: line.currency.code, exchangeRate: line.exchangeRate.toFixed(8), debit: line.debitAmount.toFixed(4), credit: line.creditAmount.toFixed(4), baseDebit: line.baseDebitAmount.toFixed(4), baseCredit: line.baseCreditAmount.toFixed(4) })) })),
  };
  const archive = await tx.documentPrintArchive.create({ data: { companyId: context.companyId, accountingDocumentId: document.id, snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash: snapshotHash(snapshot), createdBy: context.userId } });
  await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "DOCUMENT_PRINT_ARCHIVED", entityType: "ACCOUNTING_DOCUMENT", entityId: document.id.toString(), details: { archiveId: archive.id.toString(), snapshotHash: archive.snapshotHash, formatVersion: 1 } } });
  return archive;
}
