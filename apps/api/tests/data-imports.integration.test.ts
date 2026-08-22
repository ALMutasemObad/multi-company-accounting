import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { DataImportError, DataImportService } from "../src/imports/data-import-service.js";
import { importHeaders } from "../src/imports/data-import-parser.js";
import { PrismaOutboxAppender } from "../src/outbox/outbox.js";
import { PurchaseInvoiceService } from "../src/purchases/purchase-invoice-service.js";
import { ReceiptReferenceService } from "../src/receipts/reference-service.js";
import { SalesInvoiceService } from "../src/sales/sales-invoice-service.js";
import { SupplierReferenceService } from "../src/suppliers/supplier-service.js";
import { TaxService } from "../src/tax/tax-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

const csv = (type: keyof typeof importHeaders, records: Array<Record<string, string>>) => Buffer.from(`\uFEFF${importHeaders[type].map((value) => `"${value}"`).join(",")}\r\n${records.map((record) => importHeaders[type].map((header) => `"${(record[header] ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")}`).toString("base64");

describe.runIf(enabled)("atomic data imports with MariaDB/MySQL", () => {
  let service: DataImportService;
  let companyId: bigint;
  let userId: bigint;
  let yearId: bigint;
  let assetId: bigint;
  let liabilityId: bigint;
  let revenueId: bigint;
  let expenseId: bigint;
  let currencyCode: string;
  let foreignCompanyId: bigint;
  const context = () => ({ companyId, userId });

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    const oldYear = await prisma!.fiscalYear.findFirst({ where: { companyId, name: "IT-IMPORT-2047" } });
    if (oldYear) {
      await prisma!.salesInvoiceLine.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: oldYear.id } } } } });
      await prisma!.purchaseInvoiceLine.deleteMany({ where: { companyId, purchaseInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: oldYear.id } } } } });
      await prisma!.salesInvoice.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: oldYear.id } } } });
      await prisma!.purchaseInvoice.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: oldYear.id } } } });
      await prisma!.accountingDocument.deleteMany({ where: { companyId, fiscalPeriod: { fiscalYearId: oldYear.id } } });
      await prisma!.documentSequence.deleteMany({ where: { companyId, fiscalYearId: oldYear.id } });
      await prisma!.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: oldYear.id } });
      await prisma!.fiscalYear.delete({ where: { id: oldYear.id } });
    }
    await prisma!.dataImportBatch.deleteMany({ where: { companyId } });
    await prisma!.customerAddress.deleteMany({ where: { companyId, customer: { nameAr: { startsWith: "IT استيراد" } } } });
    await prisma!.customer.deleteMany({ where: { companyId, nameAr: { startsWith: "IT استيراد" } } });
    await prisma!.supplierAddress.deleteMany({ where: { companyId, supplier: { nameAr: { startsWith: "IT استيراد" } } } });
    await prisma!.supplier.deleteMany({ where: { companyId, nameAr: { startsWith: "IT استيراد" } } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: "IT-IMPORT-" } } });
    const types = Object.fromEntries((await prisma!.accountType.findMany()).map((value) => [value.code, value.id]));
    assetId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.ASSET!, code: "IT-IMPORT-AR", nameAr: "ذمم استيراد", level: 1, allowsPosting: true } })).id;
    liabilityId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.LIABILITY!, code: "IT-IMPORT-AP", nameAr: "دائنون استيراد", level: 1, allowsPosting: true } })).id;
    revenueId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.REVENUE!, code: "IT-IMPORT-REV", nameAr: "إيراد استيراد", level: 1, allowsPosting: true } })).id;
    expenseId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.EXPENSE!, code: "IT-IMPORT-EXP", nameAr: "مصروف استيراد", level: 1, allowsPosting: true } })).id;
    const company = await prisma!.company.findUniqueOrThrow({ where: { id: companyId }, include: { baseCurrency: true } });
    currencyCode = company.baseCurrency.code;
    await prisma!.company.deleteMany({ where: { organizationId: company.organizationId, code: "IT-IMPORT-OTHER" } });
    foreignCompanyId = (await prisma!.company.create({ data: { organizationId: company.organizationId, baseCurrencyId: company.baseCurrencyId, code: "IT-IMPORT-OTHER", name: "IT Import Isolation", timezone: company.timezone } })).id;
    const year = await prisma!.fiscalYear.create({ data: { companyId, name: "IT-IMPORT-2047", startDate: new Date("2047-01-01T00:00:00Z"), endDate: new Date("2047-12-31T00:00:00Z"), periods: { create: { periodNumber: 1, name: "فترة الاستيراد", startDate: new Date("2047-01-01T00:00:00Z"), endDate: new Date("2047-12-31T00:00:00Z") } } } });
    yearId = year.id;
    const taxes = new TaxService(prisma!);
    service = new DataImportService(prisma!, new ReceiptReferenceService(prisma!), new SupplierReferenceService(prisma!), new SalesInvoiceService(prisma!, taxes), new PurchaseInvoiceService(prisma!, taxes), new PrismaOutboxAppender(8));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: "COMMIT_DATA_IMPORT" } });
    await prisma.outboxEvent.deleteMany({ where: { companyId, eventType: "DataImportCommitted" } });
    await prisma.auditLog.deleteMany({ where: { companyId, action: { in: ["DATA_IMPORT_PREVIEWED", "DATA_IMPORT_COMMITTED", "CUSTOMER_CREATED", "SUPPLIER_CREATED", "SALES_INVOICE_CREATED", "PURCHASE_INVOICE_CREATED"] } } });
    await prisma.dataImportBatch.deleteMany({ where: { companyId } });
    if (yearId) {
      await prisma.salesInvoiceLine.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: yearId } } } } });
      await prisma.purchaseInvoiceLine.deleteMany({ where: { companyId, purchaseInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: yearId } } } } });
      await prisma.salesInvoice.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: yearId } } } });
      await prisma.purchaseInvoice.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: yearId } } } });
      await prisma.accountingDocument.deleteMany({ where: { companyId, fiscalPeriod: { fiscalYearId: yearId } } });
      await prisma.documentSequence.deleteMany({ where: { companyId, fiscalYearId: yearId } });
      await prisma.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: yearId } });
      await prisma.fiscalYear.deleteMany({ where: { id: yearId } });
    }
    await prisma.customerAddress.deleteMany({ where: { companyId, customer: { nameAr: { startsWith: "IT استيراد" } } } });
    await prisma.customer.deleteMany({ where: { companyId, nameAr: { startsWith: "IT استيراد" } } });
    await prisma.supplierAddress.deleteMany({ where: { companyId, supplier: { nameAr: { startsWith: "IT استيراد" } } } });
    await prisma.supplier.deleteMany({ where: { companyId, nameAr: { startsWith: "IT استيراد" } } });
    await prisma.account.deleteMany({ where: { id: { in: [assetId, liabilityId, revenueId, expenseId].filter(Boolean) } } });
    if (foreignCompanyId) await prisma.company.deleteMany({ where: { id: foreignCompanyId } });
    await prisma.$disconnect();
  });

  it("imports all four targets as isolated, idempotent drafts and rejects partial batches", async () => {
    const customerFile = csv("CUSTOMERS", [{ receivable_account_code: "IT-IMPORT-AR", name_ar: "IT استيراد عميل", name_en: "Imported customer", email: "import@example.com", address_type: "BILLING", address_line1: "الرياض", country_code: "SA", is_primary: "true" }]);
    const customerPreview = await service.preview(context(), "CUSTOMERS", "CSV", customerFile);
    expect(customerPreview.errors).toEqual([]);
    const modifiedCustomerFile = csv("CUSTOMERS", [{ receivable_account_code: "IT-IMPORT-AR", name_ar: "IT استيراد ملف معدل" }]);
    await expect(service.commit(context(), customerPreview.batch.id, "CUSTOMERS", "CSV", modifiedCustomerFile, "it-import-modified-file")).rejects.toEqual(new DataImportError("FILE_MISMATCH"));
    const customerCommit = await service.commit(context(), customerPreview.batch.id, "CUSTOMERS", "CSV", customerFile, "it-import-customer-key");
    const customerReplay = await service.commit(context(), customerPreview.batch.id, "CUSTOMERS", "CSV", customerFile, "it-import-customer-key");
    expect(customerReplay).toEqual(customerCommit);
    expect(await prisma!.customer.count({ where: { companyId, nameAr: "IT استيراد عميل" } })).toBe(1);
    const customer = await prisma!.customer.findFirstOrThrow({ where: { companyId, nameAr: "IT استيراد عميل" } });
    await expect(service.commit({ companyId: foreignCompanyId, userId }, customerPreview.batch.id, "CUSTOMERS", "CSV", customerFile, "it-import-cross-company")).rejects.toEqual(new DataImportError("NOT_FOUND"));

    const oversizedCustomer = csv("CUSTOMERS", [{ receivable_account_code: "IT-IMPORT-AR", name_ar: "س".repeat(201) }]);
    expect((await service.preview(context(), "CUSTOMERS", "CSV", oversizedCustomer)).errors).toContainEqual({ row: 2, column: "name_ar", code: "MAX_LENGTH_EXCEEDED" });

    const expiredFile = csv("CUSTOMERS", [{ receivable_account_code: "IT-IMPORT-AR", name_ar: "IT استيراد منتهي" }]);
    const expiredPreview = await service.preview(context(), "CUSTOMERS", "CSV", expiredFile);
    await prisma!.dataImportBatch.update({ where: { publicId: expiredPreview.batch.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(service.commit(context(), expiredPreview.batch.id, "CUSTOMERS", "CSV", expiredFile, "it-import-expired-file")).rejects.toEqual(new DataImportError("PREVIEW_EXPIRED"));

    const concurrentFile = csv("CUSTOMERS", [{ receivable_account_code: "IT-IMPORT-AR", name_ar: "IT استيراد متزامن" }]);
    const concurrentPreview = await service.preview(context(), "CUSTOMERS", "CSV", concurrentFile);
    const concurrent = await Promise.allSettled([
      service.commit(context(), concurrentPreview.batch.id, "CUSTOMERS", "CSV", concurrentFile, "it-import-concurrent-a"),
      service.commit(context(), concurrentPreview.batch.id, "CUSTOMERS", "CSV", concurrentFile, "it-import-concurrent-b"),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma!.customer.count({ where: { companyId, nameAr: "IT استيراد متزامن" } })).toBe(1);

    const supplierFile = csv("SUPPLIERS", [{ payable_account_code: "IT-IMPORT-AP", name_ar: "IT استيراد مورد", name_en: "Imported supplier", address_type: "PAYMENT", address_line1: "جدة", country_code: "SA", is_primary: "true" }]);
    const supplierPreview = await service.preview(context(), "SUPPLIERS", "CSV", supplierFile);
    await service.commit(context(), supplierPreview.batch.id, "SUPPLIERS", "CSV", supplierFile, "it-import-supplier-key");
    const supplier = await prisma!.supplier.findFirstOrThrow({ where: { companyId, nameAr: "IT استيراد مورد" } });

    const salesFile = csv("SALES_INVOICES", [{ invoice_key: "S-1", document_date: "2047-02-01", due_date: "2047-02-28", description: "IT فاتورة بيع مستوردة", customer_code: customer.code, currency_code: currencyCode, exchange_rate: "1.00000000", line_description: "خدمة", quantity: "2.0000", unit_price: "100.0000", discount_amount: "0.0000", account_code: "IT-IMPORT-REV" }]);
    const salesPreview = await service.preview(context(), "SALES_INVOICES", "CSV", salesFile);
    const salesCommit = await service.commit(context(), salesPreview.batch.id, "SALES_INVOICES", "CSV", salesFile, "it-import-sales-key");
    const sales = await prisma!.salesInvoice.findUniqueOrThrow({ where: { id: BigInt(salesCommit.createdIds[0]!) }, include: { accountingDocument: true } });
    expect(sales.accountingDocument.status).toBe("DRAFT");
    expect(sales.total.toFixed(4)).toBe("200.0000");

    const invalidTaxFile = csv("SALES_INVOICES", [{ invoice_key: "S-TAX", document_date: "2047-02-01", due_date: "2047-02-28", description: "IT ضريبة غير صالحة", customer_code: customer.code, currency_code: currencyCode, exchange_rate: "1.00000000", line_description: "خدمة", quantity: "1.0000", unit_price: "1.0000", discount_amount: "0.0000", account_code: "IT-IMPORT-REV", tax_code: "NO-SUCH-TAX" }]);
    expect((await service.preview(context(), "SALES_INVOICES", "CSV", invalidTaxFile)).errors).toContainEqual({ row: 2, column: "tax_code", code: "INVALID_TAX_RATE" });

    const purchaseFile = csv("PURCHASE_INVOICES", [{ invoice_key: "P-1", document_date: "2047-03-01", due_date: "2047-03-31", description: "IT فاتورة شراء مستوردة", supplier_code: supplier.code, supplier_invoice_number: "EXT-2047-1", currency_code: currencyCode, exchange_rate: "1.00000000", line_description: "مصروف", quantity: "1.0000", unit_price: "75.0000", discount_amount: "5.0000", account_code: "IT-IMPORT-EXP" }]);
    const purchasePreview = await service.preview(context(), "PURCHASE_INVOICES", "CSV", purchaseFile);
    const purchaseCommit = await service.commit(context(), purchasePreview.batch.id, "PURCHASE_INVOICES", "CSV", purchaseFile, "it-import-purchase-key");
    const purchase = await prisma!.purchaseInvoice.findUniqueOrThrow({ where: { id: BigInt(purchaseCommit.createdIds[0]!) }, include: { accountingDocument: true } });
    expect(purchase.accountingDocument.status).toBe("DRAFT");
    expect(purchase.total.toFixed(4)).toBe("70.0000");

    const partialFile = csv("SALES_INVOICES", [
      { invoice_key: "GOOD", document_date: "2047-04-01", due_date: "2047-04-30", description: "IT good", customer_code: customer.code, currency_code: currencyCode, exchange_rate: "1.00000000", line_description: "خدمة", quantity: "1.0000", unit_price: "10.0000", discount_amount: "0.0000", account_code: "IT-IMPORT-REV" },
      { invoice_key: "BAD", document_date: "2047-04-01", due_date: "2047-04-30", description: "IT bad", customer_code: customer.code, currency_code: currencyCode, exchange_rate: "1.00000000", line_description: "خدمة", quantity: "1.0000", unit_price: "10.0000", discount_amount: "0.0000", account_code: "DOES-NOT-EXIST" },
    ]);
    const partialPreview = await service.preview(context(), "SALES_INVOICES", "CSV", partialFile);
    expect(partialPreview.errors).toHaveLength(1);
    const before = await prisma!.accountingDocument.count({ where: { companyId, description: { startsWith: "IT good" } } });
    await expect(service.commit(context(), partialPreview.batch.id, "SALES_INVOICES", "CSV", partialFile, "it-import-partial-key")).rejects.toMatchObject({ reason: "IMPORT_HAS_ERRORS" });
    expect(await prisma!.accountingDocument.count({ where: { companyId, description: { startsWith: "IT good" } } })).toBe(before);
    expect((await prisma!.outboxEvent.findMany({ where: { companyId, eventType: "DataImportCommitted" } })).length).toBe(5);
  }, 30_000);
});
