import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import {
  createReceiptService,
  createSalesInvoiceService,
} from "../src/composition/create-financial-document-services.js";
import { createDatabase } from "../src/database.js";
import { InventoryCatalogService } from "../src/inventory/inventory-catalog-service.js";
import { InventoryMovementService } from "../src/inventory/inventory-movement-service.js";
import { PrismaPosSaleQueryAdapter } from "../src/pos/adapters/prisma-pos-sale-query-adapter.js";
import { PosService } from "../src/pos/pos-service.js";
import { TaxService } from "../src/tax/tax-service.js";
import { testAuthOptions } from "./helpers/test-auth-options.js";
import { TreasuryService } from "../src/treasury/treasury-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("POS cash-sale vertical slice with MariaDB", () => {
  let app: ReturnType<typeof createApp>;
  let companyId: bigint;
  let userId: bigint;
  let yearId: bigint;
  let periodId: bigint;
  let currencyId: bigint;
  let customerId: bigint;
  let warehouseId: bigint;
  let unitId: bigint;
  let itemId: bigint;
  let balanceId: bigint;
  let cashBankAccountId: bigint;
  let paymentMethodId: bigint;
  const accountIds: bigint[] = [];

  async function removeYear(id: bigint) {
    const documentWhere = { companyId, fiscalPeriod: { fiscalYearId: id } };
    const invoiceWhere = { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } };
    const receiptWhere = { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } };
    const invoiceIds = (await prisma!.salesInvoice.findMany({ where: invoiceWhere, select: { id: true } }))
      .map(({ id: invoiceId }) => invoiceId);
    const movementIds = invoiceIds.length
      ? (await prisma!.inventoryMovement.findMany({
          where: { companyId, sourceType: "SALES_INVOICE", sourceId: { in: invoiceIds } },
          select: { id: true },
        })).map(({ id: movementId }) => movementId)
      : [];
    await prisma!.posSale.deleteMany({
      where: {
        companyId,
        OR: [
          { salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } },
          { receipt: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } },
        ],
      },
    });
    await prisma!.receiptAllocation.deleteMany({ where: { companyId, receipt: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.receipt.deleteMany({ where: receiptWhere });
    await prisma!.receivableItem.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.salesInvoice.updateMany({ where: invoiceWhere, data: { arJournalLineId: null } });
    if (movementIds.length) {
      await prisma!.inventoryMovementLine.deleteMany({ where: { companyId, movementId: { in: movementIds } } });
      await prisma!.inventoryMovement.deleteMany({ where: { companyId, id: { in: movementIds } } });
    }
    await prisma!.journalLine.deleteMany({ where: { companyId, journalEntry: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.journalEntry.updateMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.salesInvoiceLine.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.salesInvoice.deleteMany({ where: invoiceWhere });
    await prisma!.documentPrintArchive.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.accountingDocument.deleteMany({ where: documentWhere });
    await prisma!.documentSequence.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId, id } });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    currencyId = (await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })).baseCurrencyId;
    const staleYear = await prisma!.fiscalYear.findFirst({ where: { companyId, name: "IT-POS-2048" } });
    if (staleYear) await removeYear(staleYear.id);
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: "COMPLETE_POS_CHECKOUT" } });
    await prisma!.auditLog.deleteMany({ where: { companyId, entityType: "POS_SALE" } });

    const staleItems = await prisma!.inventoryItem.findMany({ where: { companyId, code: "IT-POS-ITEM" }, select: { id: true } });
    if (staleItems.length) {
      await prisma!.inventoryBalance.deleteMany({ where: { companyId, inventoryItemId: { in: staleItems.map(({ id }) => id) } } });
      await prisma!.inventoryItem.deleteMany({ where: { companyId, id: { in: staleItems.map(({ id }) => id) } } });
    }
    await prisma!.unitOfMeasure.deleteMany({ where: { companyId, code: "ITP6" } });
    await prisma!.warehouse.deleteMany({ where: { companyId, code: "IT-POS-WH" } });
    await prisma!.customerAddress.deleteMany({ where: { companyId, customer: { code: "IT-POS-CUSTOMER" } } });
    await prisma!.customer.deleteMany({ where: { companyId, code: "IT-POS-CUSTOMER" } });
    await prisma!.cashBankAccount.deleteMany({ where: { companyId, code: "IT-POS-CASH" } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: "IT-POS-" } } });

    const accountTypes = Object.fromEntries((await prisma!.accountType.findMany()).map((value) => [value.class, value.id]));
    const ar = await prisma!.account.create({ data: { companyId, accountTypeId: accountTypes.ASSET!, code: "IT-POS-AR", nameAr: "ذمم POS اختبارية", level: 1, allowsPosting: true } });
    const cash = await prisma!.account.create({ data: { companyId, accountTypeId: accountTypes.ASSET!, code: "IT-POS-CASH-GL", nameAr: "صندوق POS اختباري", level: 1, allowsPosting: true } });
    const revenue = await prisma!.account.create({ data: { companyId, accountTypeId: accountTypes.REVENUE!, code: "IT-POS-REVENUE", nameAr: "إيراد POS اختباري", level: 1, allowsPosting: true } });
    accountIds.push(ar.id, cash.id, revenue.id);
    customerId = (await prisma!.customer.create({ data: { companyId, receivableAccountId: ar.id, code: "IT-POS-CUSTOMER", nameAr: "عميل POS اختباري" } })).id;
    cashBankAccountId = (await prisma!.cashBankAccount.create({ data: { companyId, ledgerAccountId: cash.id, accountType: "CASH", code: "IT-POS-CASH", nameAr: "صندوق POS" } })).id;
    paymentMethodId = (await prisma!.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } })).id;
    warehouseId = (await prisma!.warehouse.create({ data: { companyId, code: "IT-POS-WH", nameAr: "مستودع POS" } })).id;
    unitId = (await prisma!.unitOfMeasure.create({ data: { companyId, code: "ITP6", nameAr: "وحدة POS", decimalPlaces: 6 } })).id;
    itemId = (await prisma!.inventoryItem.create({ data: { companyId, unitOfMeasureId: unitId, code: "IT-POS-ITEM", nameAr: "صنف POS" } })).id;
    balanceId = (await prisma!.inventoryBalance.create({ data: {
      companyId,
      warehouseId,
      inventoryItemId: itemId,
      onHand: "10.000000",
      inventoryValueBase: "40.0000",
      averageUnitCostBase: "4.00000000",
      isValuationInitialized: true,
    } })).id;
    const year = await prisma!.fiscalYear.create({
      data: {
        companyId,
        name: "IT-POS-2048",
        startDate: new Date("2048-01-01T00:00:00.000Z"),
        endDate: new Date("2048-12-31T00:00:00.000Z"),
        periods: { create: { periodNumber: 1, name: "فترة POS الاختبارية", startDate: new Date("2048-01-01T00:00:00.000Z"), endDate: new Date("2048-12-31T00:00:00.000Z") } },
      },
      include: { periods: true },
    });
    yearId = year.id;
    periodId = year.periods[0]!.id;

    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, testAuthOptions(prisma!));
    const taxes = new TaxService(prisma!);
    const treasury = new TreasuryService(prisma!);
    const inventory = new InventoryCatalogService(prisma!);
    const stock = new InventoryMovementService(prisma!);
    const sales = createSalesInvoiceService(prisma!, { taxes, inventory, stock });
    const receipts = createReceiptService(prisma!, { treasury });
    const pos = new PosService(prisma!, sales, receipts, new PrismaPosSaleQueryAdapter(prisma!));
    app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: databaseUrl,
    }, { auth, pos });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: "COMPLETE_POS_CHECKOUT" } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["POS_SALE", "SALES_INVOICE", "RECEIPT", "INVENTORY_MOVEMENT"] } } });
    if (yearId) await removeYear(yearId);
    if (balanceId) await prisma.inventoryBalance.deleteMany({ where: { id: balanceId, companyId } });
    if (itemId) await prisma.inventoryItem.deleteMany({ where: { id: itemId, companyId } });
    if (unitId) await prisma.unitOfMeasure.deleteMany({ where: { id: unitId, companyId } });
    if (warehouseId) await prisma.warehouse.deleteMany({ where: { id: warehouseId, companyId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId, companyId } });
    if (cashBankAccountId) await prisma.cashBankAccount.deleteMany({ where: { id: cashBankAccountId, companyId } });
    if (accountIds.length) await prisma.account.deleteMany({ where: { companyId, id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("posts invoice, stock issue, receipt and journals once under concurrent retry", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf.body.csrfToken)
      .send({ email: "admin@mcap.local", password })
      .expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context")
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({ companyId: companies.body.data.find((company: any) => company.id === companyId.toString()).id })
      .expect(204);
    const payload = {
      fiscalPeriodId: periodId.toString(),
      documentDate: "2048-08-27",
      description: "بيع POS ذري",
      customerId: customerId.toString(),
      warehouseId: warehouseId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      cashBankAccountId: cashBankAccountId.toString(),
      paymentMethodId: paymentMethodId.toString(),
      referenceNumber: null,
      lines: [{
        inventoryItemId: itemId.toString(),
        description: "صنف POS",
        quantity: "2.000000",
        unitPrice: "25.0000",
        discountAmount: "0.0000",
        revenueAccountId: accountIds[2]!.toString(),
        costCenterId: null,
        taxRateId: null,
      }],
    };
    const submit = () => agent.post("/api/v1/pos/checkouts")
      .set("X-CSRF-Token", login.body.csrfToken)
      .set("Idempotency-Key", "it-pos-concurrent-checkout-0001")
      .send(payload);
    const [first, retry] = await Promise.all([submit(), submit()]);
    expect([first.status, retry.status]).toEqual([201, 201]);
    expect(retry.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      invoice: { status: "POSTED", total: "50.0000", baseTotal: "50.0000" },
      receipt: { status: "POSTED" },
    });

    const sale = await prisma!.posSale.findUniqueOrThrow({
      where: { id: BigInt(first.body.id) },
      include: {
        salesInvoice: { include: { accountingDocument: { include: { journalEntries: true } }, receivableItem: true } },
        receipt: { include: { accountingDocument: { include: { journalEntries: true } }, allocations: true } },
      },
    });
    expect(sale.salesInvoice.accountingDocument.status).toBe("POSTED");
    expect(sale.receipt.accountingDocument.status).toBe("POSTED");
    expect(sale.salesInvoice.receivableItem).toMatchObject({ status: "SETTLED" });
    expect(sale.salesInvoice.receivableItem!.outstandingAmount.toFixed(4)).toBe("0.0000");
    expect(sale.receipt.allocations).toHaveLength(1);
    expect(sale.salesInvoice.accountingDocument.journalEntries).toHaveLength(1);
    expect(sale.receipt.accountingDocument.journalEntries).toHaveLength(1);
    expect(await prisma!.idempotencyRecord.findFirstOrThrow({
      where: { companyId, operation: "COMPLETE_POS_CHECKOUT", status: "COMPLETED" },
    })).toMatchObject({ responseStatus: 201 });
    expect(await prisma!.inventoryMovement.count({ where: { companyId, sourceType: "SALES_INVOICE", sourceId: sale.salesInvoiceId, sourceEvent: "POST" } })).toBe(1);
    const balanceAfterSale = await prisma!.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } });
    expect(balanceAfterSale.onHand.toFixed(6)).toBe("8.000000");
    expect(balanceAfterSale.inventoryValueBase.toFixed(4)).toBe("32.0000");

    const beforeFailure = {
      documents: await prisma!.accountingDocument.count({ where: { companyId, fiscalPeriodId: periodId } }),
      invoices: await prisma!.salesInvoice.count({ where: { companyId, accountingDocument: { fiscalPeriodId: periodId } } }),
      movements: await prisma!.inventoryMovement.count({ where: { companyId, sourceType: "SALES_INVOICE" } }),
      sales: await prisma!.posSale.count({ where: { companyId } }),
    };
    await agent.post("/api/v1/pos/checkouts")
      .set("X-CSRF-Token", login.body.csrfToken)
      .set("Idempotency-Key", "it-pos-rollback-checkout-0001")
      .send({ ...payload, cashBankAccountId: "999999999999", description: "يجب عكسه" })
      .expect(422);
    expect({
      documents: await prisma!.accountingDocument.count({ where: { companyId, fiscalPeriodId: periodId } }),
      invoices: await prisma!.salesInvoice.count({ where: { companyId, accountingDocument: { fiscalPeriodId: periodId } } }),
      movements: await prisma!.inventoryMovement.count({ where: { companyId, sourceType: "SALES_INVOICE" } }),
      sales: await prisma!.posSale.count({ where: { companyId } }),
    }).toEqual(beforeFailure);
    expect((await prisma!.inventoryBalance.findUniqueOrThrow({ where: { id: balanceId } })).onHand.toFixed(6)).toBe("8.000000");

    await agent.post("/api/v1/pos/checkouts")
      .set("X-CSRF-Token", login.body.csrfToken)
      .set("Idempotency-Key", "it-pos-concurrent-checkout-0001")
      .send({ ...payload, description: "طلب مالي مختلف" })
      .expect(409);
    const listed = await agent.get("/api/v1/pos/sales?page=1&pageSize=10").expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(first.body.id);
    const foreign = await new PrismaPosSaleQueryAdapter(prisma!).list(
      { companyId: companyId + 999_999n, userId },
      { page: 1, pageSize: 10 },
    );
    expect(foreign).toEqual({ data: [], total: 0 });
  }, 30_000);
});
