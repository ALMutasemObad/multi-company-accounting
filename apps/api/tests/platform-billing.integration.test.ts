import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditAppendAdapter } from "../src/audit/prisma-audit-append-adapter.js";
import { createDatabase } from "../src/database.js";
import {
  PLATFORM_BILLING_RECENT_PAYMENT_LIMIT,
  PlatformBillingError,
  PlatformBillingService,
  type PlatformBillingAccountInput,
} from "../src/platform-operations/platform-billing-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(enabled)("platform billing currency invariants with a supported database", () => {
  let operatorUserId: bigint;
  const companyIds: bigint[] = [];
  const organizationIds: bigint[] = [];

  const accountInput = (
    currencyCode: string,
    version: number,
    idempotencyKey: string,
  ): PlatformBillingAccountInput => ({
    status: "ACTIVE",
    planName: "Platform integration plan",
    billingCycle: "MONTHLY",
    currencyCode,
    recurringFee: "100.0000",
    includedUsers: 1,
    pricePerAdditionalUser: "10.0000",
    includedEmployees: 1,
    pricePerAdditionalEmployee: "10.0000",
    includedPostedDocuments: 1,
    pricePerAdditionalPostedDocument: "1.0000",
    taxRate: "15.0000",
    paymentTermsDays: 30,
    version,
    idempotencyKey,
  });

  const createCompany = async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const [currency, organization] = await Promise.all([
      prisma!.currency.findFirstOrThrow({ where: { code: "SAR", scopeKey: "GLOBAL" }, select: { id: true } }),
      prisma!.organization.create({ data: { code: `PLT-IT-${suffix}`, name: `Platform billing IT ${suffix}` } }),
    ]);
    organizationIds.push(organization.id);
    const company = await prisma!.company.create({
      data: {
        organizationId: organization.id,
        baseCurrencyId: currency.id,
        code: `PLT-IT-${suffix}`,
        name: `Platform billing IT ${suffix}`,
        timezone: "Asia/Riyadh",
      },
    });
    companyIds.push(company.id);
    return company;
  };

  const service = () => new PlatformBillingService(
    prisma!,
    { requireOperator: async (userId) => {
      if (userId !== operatorUserId) throw new Error("Unexpected operator");
    } },
    {
      companyCount: () => prisma!.company.count(),
      companyReferences: async (ids?: bigint[]) => (await prisma!.company.findMany({
        where: { id: { in: ids ?? companyIds } },
        include: { baseCurrency: { select: { code: true } } },
      })).map((company) => ({
        id: company.id.toString(),
        name: company.name,
        isActive: company.isActive,
        baseCurrencyCode: company.baseCurrency.code,
      })),
      companyUsage: async ({ companyId }: { companyId: bigint }) => companyIds.includes(companyId)
        ? { users: 2, employees: 2, postedDocuments: 2, operations: 2 }
        : null,
    } as never,
    new PrismaAuditAppendAdapter(),
    () => new Date("2048-01-01T00:00:00.000Z"),
  );

  beforeAll(async () => {
    operatorUserId = (await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
      select: { id: true },
    })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (companyIds.length) {
      const companyId = { in: companyIds };
      await prisma.platformBillingPayment.deleteMany({ where: { companyId } });
      await prisma.platformBillingInvoiceLine.deleteMany({ where: { companyId } });
      await prisma.platformBillingInvoice.deleteMany({ where: { companyId } });
      await prisma.platformBillingAccount.deleteMany({ where: { companyId } });
      await prisma.idempotencyRecord.deleteMany({ where: { companyId } });
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    if (organizationIds.length) {
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await prisma.$disconnect();
  });

  it("rejects a currency change after any invoice history", async () => {
    const company = await createCompany();
    const billing = service();
    await billing.upsertAccount(
      operatorUserId,
      company.id,
      accountInput("SAR", 0, `create-account-${randomUUID()}`),
    );
    await billing.issueInvoice(operatorUserId, company.id, {
      periodStart: "2048-01-01",
      periodEnd: "2048-01-31",
      issueDate: "2048-02-01",
      adjustments: [],
      idempotencyKey: `issue-invoice-${randomUUID()}`,
    });

    await expect(billing.upsertAccount(
      operatorUserId,
      company.id,
      accountInput("USD", 0, `change-currency-${randomUUID()}`),
    )).rejects.toEqual(new PlatformBillingError("CURRENCY_CHANGE_WITH_HISTORY"));

    const [account, invoices] = await Promise.all([
      prisma!.platformBillingAccount.findUniqueOrThrow({ where: { companyId: company.id } }),
      prisma!.platformBillingInvoice.findMany({ where: { companyId: company.id } }),
    ]);
    expect(account.currencyCode).toBe("SAR");
    expect(invoices.map((invoice) => invoice.currencyCode)).toEqual(["SAR"]);

    const companyBilling = await billing.companyBilling(operatorUserId, company.id, { page: 1, pageSize: 1 });
    expect(companyBilling.meta).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect(companyBilling.invoices).toHaveLength(1);
    expect(companyBilling.totals).toEqual({
      billed: companyBilling.invoices[0]!.totalAmount,
      paid: "0.0000",
      balance: companyBilling.invoices[0]!.totalAmount,
      overdue: "0.0000",
    });

    const summary = await billing.summary(operatorUserId, { page: 1, pageSize: 1 });
    expect(summary.meta.pageSize).toBe(1);
    expect(summary.accounts.length).toBeLessThanOrEqual(1);
    expect(summary.metrics.configuredCompanies).toBeGreaterThanOrEqual(1);
  });

  it("serializes first invoice issuance against a concurrent currency change", async () => {
    const company = await createCompany();
    const billing = service();
    await billing.upsertAccount(
      operatorUserId,
      company.id,
      accountInput("SAR", 0, `create-race-account-${randomUUID()}`),
    );

    const [issuance, update] = await Promise.allSettled([
      billing.issueInvoice(operatorUserId, company.id, {
        periodStart: "2048-03-01",
        periodEnd: "2048-03-31",
        issueDate: "2048-04-01",
        adjustments: [],
        idempotencyKey: `issue-race-invoice-${randomUUID()}`,
      }),
      billing.upsertAccount(
        operatorUserId,
        company.id,
        accountInput("USD", 0, `change-race-currency-${randomUUID()}`),
      ),
    ]);

    expect(issuance.status).toBe("fulfilled");
    if (update.status === "rejected") {
      expect(update.reason).toEqual(new PlatformBillingError("CURRENCY_CHANGE_WITH_HISTORY"));
    }
    const [account, invoices] = await Promise.all([
      prisma!.platformBillingAccount.findUniqueOrThrow({ where: { companyId: company.id } }),
      prisma!.platformBillingInvoice.findMany({ where: { companyId: company.id } }),
    ]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.currencyCode).toBe(account.currencyCode);
  });

  it("returns only the bounded recent payments while keeping exact full-history totals", async () => {
    const company = await createCompany();
    const billing = service();
    await billing.upsertAccount(
      operatorUserId,
      company.id,
      accountInput("SAR", 0, `create-payment-account-${randomUUID()}`),
    );
    const issued = await billing.issueInvoice(operatorUserId, company.id, {
      periodStart: "2048-05-01",
      periodEnd: "2048-05-31",
      issueDate: "2048-06-01",
      adjustments: [],
      idempotencyKey: `issue-payment-invoice-${randomUUID()}`,
    });

    let invoiceVersion = issued.invoice.version;
    for (let index = 1; index <= 7; index += 1) {
      const payment = await billing.recordPayment(operatorUserId, issued.invoice.id, {
        invoiceVersion,
        paymentDate: `2048-06-${String(index).padStart(2, "0")}`,
        amount: "1.0000",
        method: "BANK_TRANSFER",
        idempotencyKey: `record-payment-${index}-${randomUUID()}`,
      });
      invoiceVersion = payment.invoice.version;
      expect(payment.invoice.payments.length).toBeLessThanOrEqual(PLATFORM_BILLING_RECENT_PAYMENT_LIMIT);
    }

    const result = await billing.companyBilling(operatorUserId, company.id, { page: 1, pageSize: 1 });
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      paidAmount: "7.0000",
      paymentCount: 7,
    });
    expect(result.invoices[0]!.payments).toHaveLength(PLATFORM_BILLING_RECENT_PAYMENT_LIMIT);
    expect(result.invoices[0]!.payments.map((payment) => payment.paymentDate))
      .toEqual(["2048-06-07", "2048-06-06", "2048-06-05", "2048-06-04", "2048-06-03"]);
  });
});
