import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PlatformBillingAccount,
  type PlatformBillingInvoice,
  type PlatformBillingInvoiceLine,
  type PlatformBillingPayment,
  type PrismaClient,
} from "@prisma/client";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type { PlatformAnalyticsQueryPort, PlatformCompanyUsage } from "./platform-operations-ports.js";
import type { PlatformOperationsService } from "./platform-operations-service.js";

export type PlatformBillingFailureReason =
  | "NOT_FOUND"
  | "INVALID_AMOUNT"
  | "INVALID_DATE_RANGE"
  | "INVALID_ACCOUNT_STATE"
  | "ACCOUNT_NOT_CONFIGURED"
  | "PERIOD_ALREADY_INVOICED"
  | "VERSION_CONFLICT"
  | "INVOICE_NOT_OPEN"
  | "INVOICE_HAS_PAYMENTS"
  | "PAYMENT_EXCEEDS_BALANCE"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class PlatformBillingError extends Error {
  constructor(public readonly reason: PlatformBillingFailureReason) {
    super(reason);
  }
}

export type PlatformBillingAccountInput = {
  status: "TRIAL" | "ACTIVE" | "PAUSED" | "CLOSED";
  planName: string;
  billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  currencyCode: string;
  recurringFee: string;
  includedUsers: number;
  pricePerAdditionalUser: string;
  includedEmployees: number;
  pricePerAdditionalEmployee: string;
  includedPostedDocuments: number;
  pricePerAdditionalPostedDocument: string;
  taxRate: string;
  paymentTermsDays: number;
  nextBillingDate?: string | null | undefined;
  notes?: string | null | undefined;
  version?: number | null | undefined;
  idempotencyKey: string;
};

export type PlatformInvoiceInput = {
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  notes?: string | null | undefined;
  adjustments: Array<{ description: string; amount: string }>;
  idempotencyKey: string;
};

export type PlatformPaymentInput = {
  invoiceVersion: number;
  paymentDate: string;
  amount: string;
  method: "BANK_TRANSFER" | "CARD" | "CASH" | "OTHER";
  reference?: string | null | undefined;
  notes?: string | null | undefined;
  idempotencyKey: string;
};

type InvoiceGraph = PlatformBillingInvoice & {
  lines: PlatformBillingInvoiceLine[];
  payments: PlatformBillingPayment[];
};

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const nonNegative = (value: Prisma.Decimal) => value.gte(0) && value.isFinite();
const invoicePaid = (invoice: Pick<InvoiceGraph, "payments">) =>
  invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), money(0));

function accountJson(account: PlatformBillingAccount) {
  return {
    id: account.id.toString(),
    companyId: account.companyId.toString(),
    status: account.status,
    planName: account.planName,
    billingCycle: account.billingCycle,
    currencyCode: account.currencyCode,
    recurringFee: account.recurringFee.toFixed(4),
    includedUsers: account.includedUsers,
    pricePerAdditionalUser: account.pricePerAdditionalUser.toFixed(4),
    includedEmployees: account.includedEmployees,
    pricePerAdditionalEmployee: account.pricePerAdditionalEmployee.toFixed(4),
    includedPostedDocuments: account.includedPostedDocuments,
    pricePerAdditionalPostedDocument: account.pricePerAdditionalPostedDocument.toFixed(4),
    taxRate: account.taxRate.toFixed(4),
    paymentTermsDays: account.paymentTermsDays,
    nextBillingDate: account.nextBillingDate ? dateString(account.nextBillingDate) : null,
    notes: account.notes,
    version: account.version,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function invoiceStatus(invoice: InvoiceGraph, now: Date) {
  if (invoice.state === "VOID") return "VOID" as const;
  const paid = invoicePaid(invoice);
  if (paid.gte(invoice.totalAmount)) return "PAID" as const;
  if (invoice.dueDate < date(dateString(now))) return "OVERDUE" as const;
  if (paid.gt(0)) return "PARTIALLY_PAID" as const;
  return "ISSUED" as const;
}

function invoiceJson(invoice: InvoiceGraph, now: Date) {
  const paid = rounded(invoicePaid(invoice));
  const balance = Prisma.Decimal.max(money(0), invoice.totalAmount.minus(paid));
  return {
    id: invoice.publicId,
    companyId: invoice.companyId.toString(),
    billingAccountId: invoice.billingAccountId.toString(),
    invoiceNumber: invoice.invoiceNumber,
    state: invoice.state,
    status: invoiceStatus(invoice, now),
    periodStart: dateString(invoice.periodStart),
    periodEnd: dateString(invoice.periodEnd),
    issueDate: dateString(invoice.issueDate),
    dueDate: dateString(invoice.dueDate),
    currencyCode: invoice.currencyCode,
    usage: {
      users: invoice.usageUsers,
      employees: invoice.usageEmployees,
      postedDocuments: invoice.usagePostedDocuments,
      operations: invoice.usageOperations,
    },
    subtotal: invoice.subtotal.toFixed(4),
    taxRate: invoice.taxRateSnapshot.toFixed(4),
    taxAmount: invoice.taxAmount.toFixed(4),
    totalAmount: invoice.totalAmount.toFixed(4),
    paidAmount: paid.toFixed(4),
    balance: rounded(balance).toFixed(4),
    notes: invoice.notes,
    version: invoice.version,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    voidReason: invoice.voidReason,
    createdAt: invoice.createdAt.toISOString(),
    lines: invoice.lines.map((line) => ({
      id: line.id.toString(), lineNumber: line.lineNumber, lineType: line.lineType,
      description: line.description, quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(4), amount: line.amount.toFixed(4),
    })),
    payments: invoice.payments.map((payment) => ({
      id: payment.publicId, paymentDate: dateString(payment.paymentDate),
      amount: payment.amount.toFixed(4), method: payment.method,
      reference: payment.reference, notes: payment.notes, createdAt: payment.createdAt.toISOString(),
    })),
  };
}

type CalculatedLine = {
  lineType: "RECURRING_FEE" | "ADDITIONAL_USERS" | "ADDITIONAL_EMPLOYEES" | "ADDITIONAL_POSTED_DOCUMENTS" | "ADJUSTMENT";
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
};

export function calculatePlatformInvoice(
  account: Pick<PlatformBillingAccount,
    | "recurringFee" | "includedUsers" | "pricePerAdditionalUser"
    | "includedEmployees" | "pricePerAdditionalEmployee"
    | "includedPostedDocuments" | "pricePerAdditionalPostedDocument" | "taxRate">,
  usage: PlatformCompanyUsage,
  adjustments: Array<{ description: string; amount: string }>,
) {
  const lines: CalculatedLine[] = [];
  const add = (lineType: CalculatedLine["lineType"], description: string, quantity: number, unitPrice: Prisma.Decimal) => {
    if (quantity <= 0 && lineType !== "RECURRING_FEE") return;
    const amount = rounded(unitPrice.mul(quantity));
    if (amount.eq(0) && lineType !== "RECURRING_FEE") return;
    lines.push({ lineType, description, quantity, unitPrice: rounded(unitPrice), amount });
  };
  add("RECURRING_FEE", "رسوم الاشتراك الدورية", 1, account.recurringFee);
  add("ADDITIONAL_USERS", "مستخدمون إضافيون", Math.max(0, usage.users - account.includedUsers), account.pricePerAdditionalUser);
  add("ADDITIONAL_EMPLOYEES", "موظفون إضافيون", Math.max(0, usage.employees - account.includedEmployees), account.pricePerAdditionalEmployee);
  add(
    "ADDITIONAL_POSTED_DOCUMENTS", "مستندات مرحلة إضافية",
    Math.max(0, usage.postedDocuments - account.includedPostedDocuments), account.pricePerAdditionalPostedDocument,
  );
  for (const adjustment of adjustments) {
    const amount = rounded(money(adjustment.amount));
    if (!amount.isFinite()) throw new PlatformBillingError("INVALID_AMOUNT");
    if (!amount.eq(0)) lines.push({
      lineType: "ADJUSTMENT", description: adjustment.description, quantity: 1,
      unitPrice: amount, amount,
    });
  }
  const subtotal = rounded(lines.reduce((sum, line) => sum.plus(line.amount), money(0)));
  if (subtotal.lt(0)) throw new PlatformBillingError("INVALID_AMOUNT");
  const taxAmount = rounded(subtotal.mul(account.taxRate).div(100));
  const totalAmount = rounded(subtotal.plus(taxAmount));
  return { lines, subtotal, taxAmount, totalAmount };
}

export class PlatformBillingService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly operators: Pick<PlatformOperationsService, "requireOperator">,
    private readonly analytics: PlatformAnalyticsQueryPort,
    private readonly audit: AuditAppendPort,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async summary(userId: bigint) {
    await this.operators.requireOperator(userId);
    const now = this.now();
    const [references, accounts, invoices] = await Promise.all([
      this.analytics.companyReferences(),
      this.prisma.platformBillingAccount.findMany({ orderBy: [{ nextBillingDate: "asc" }, { id: "asc" }] }),
      this.prisma.platformBillingInvoice.findMany({ include: { lines: true, payments: true } }),
    ]);
    const names = new Map(references.map((company) => [company.id, company]));
    const accountRows = accounts.map((account) => {
      const companyInvoices = invoices.filter((invoice) => invoice.companyId === account.companyId);
      const billed = companyInvoices.filter((invoice) => invoice.state !== "VOID")
        .reduce((sum, invoice) => sum.plus(invoice.totalAmount), money(0));
      const paid = companyInvoices.filter((invoice) => invoice.state !== "VOID")
        .reduce((sum, invoice) => sum.plus(invoicePaid(invoice)), money(0));
      const overdue = companyInvoices.filter((invoice) => invoiceStatus(invoice, now) === "OVERDUE")
        .reduce((sum, invoice) => sum.plus(invoice.totalAmount.minus(invoicePaid(invoice))), money(0));
      const company = names.get(account.companyId.toString());
      return {
        companyId: account.companyId.toString(), companyName: company?.name ?? "—",
        companyActive: company?.isActive ?? false, account: accountJson(account),
        billed: rounded(billed).toFixed(4), paid: rounded(paid).toFixed(4),
        balance: rounded(Prisma.Decimal.max(money(0), billed.minus(paid))).toFixed(4),
        overdue: rounded(Prisma.Decimal.max(money(0), overdue)).toFixed(4),
      };
    });
    const currencies = [...new Set(accounts.map((account) => account.currencyCode))].sort().map((currencyCode) => {
      const rows = accountRows.filter((row) => row.account.currencyCode === currencyCode);
      const sum = (field: "billed" | "paid" | "balance" | "overdue") =>
        rounded(rows.reduce((total, row) => total.plus(row[field]), money(0)));
      const billed = sum("billed");
      const mrr = accounts.filter((account) => account.currencyCode === currencyCode && ["TRIAL", "ACTIVE"].includes(account.status))
        .reduce((total, account) => total.plus(
          account.billingCycle === "MONTHLY" ? account.recurringFee
            : account.billingCycle === "QUARTERLY" ? account.recurringFee.div(3)
              : account.recurringFee.div(12),
        ), money(0));
      const paid = sum("paid");
      return {
        currencyCode, recurringMonthly: rounded(mrr).toFixed(4), billed: billed.toFixed(4),
        paid: paid.toFixed(4), balance: sum("balance").toFixed(4), overdue: sum("overdue").toFixed(4),
        collectionRate: billed.gt(0) ? paid.div(billed).mul(100).toDecimalPlaces(1).toString() : "0.0",
      };
    });
    return {
      generatedAt: now.toISOString(),
      metrics: {
        totalCompanies: references.length, configuredCompanies: accounts.length,
        unconfiguredCompanies: Math.max(0, references.length - accounts.length),
        activeAccounts: accounts.filter((account) => account.status === "ACTIVE").length,
        overdueInvoices: invoices.filter((invoice) => invoiceStatus(invoice, now) === "OVERDUE").length,
      },
      currencies,
      accounts: accountRows,
    };
  }

  async companyBilling(userId: bigint, companyId: bigint) {
    await this.operators.requireOperator(userId);
    const [reference] = await this.analytics.companyReferences([companyId]);
    if (!reference) throw new PlatformBillingError("NOT_FOUND");
    const [account, invoices] = await Promise.all([
      this.prisma.platformBillingAccount.findUnique({ where: { companyId } }),
      this.prisma.platformBillingInvoice.findMany({
        where: { companyId }, include: { lines: { orderBy: { lineNumber: "asc" } }, payments: { orderBy: [{ paymentDate: "desc" }, { id: "desc" }] } },
        orderBy: [{ issueDate: "desc" }, { id: "desc" }],
      }),
    ]);
    return {
      company: reference,
      account: account ? accountJson(account) : null,
      totals: this.companyTotals(invoices),
      invoices: invoices.map((invoice) => invoiceJson(invoice, this.now())),
    };
  }

  async upsertAccount(userId: bigint, companyId: bigint, input: PlatformBillingAccountInput) {
    await this.operators.requireOperator(userId);
    if (!(await this.analytics.companyReferences([companyId]))[0]) throw new PlatformBillingError("NOT_FOUND");
    const pricing = [
      money(input.recurringFee), money(input.pricePerAdditionalUser), money(input.pricePerAdditionalEmployee),
      money(input.pricePerAdditionalPostedDocument), money(input.taxRate),
    ];
    if (pricing.some((value) => !nonNegative(value)) || pricing[4]!.gt(100)) throw new PlatformBillingError("INVALID_AMOUNT");
    return this.execute(userId, companyId, "UPSERT_PLATFORM_BILLING_ACCOUNT", input.idempotencyKey, input, 200, async (tx) => {
      const existing = await tx.platformBillingAccount.findUnique({ where: { companyId } });
      const common = {
        status: input.status,
        planName: input.planName,
        billingCycle: input.billingCycle,
        currencyCode: input.currencyCode.toUpperCase(),
        recurringFee: pricing[0]!, includedUsers: input.includedUsers,
        pricePerAdditionalUser: pricing[1]!, includedEmployees: input.includedEmployees,
        pricePerAdditionalEmployee: pricing[2]!, includedPostedDocuments: input.includedPostedDocuments,
        pricePerAdditionalPostedDocument: pricing[3]!, taxRate: pricing[4]!,
        paymentTermsDays: input.paymentTermsDays,
        nextBillingDate: input.nextBillingDate ? date(input.nextBillingDate) : null,
        notes: input.notes ?? null, updatedById: userId,
      };
      let account: PlatformBillingAccount;
      if (existing) {
        if (input.version === null || input.version === undefined || existing.version !== input.version) {
          throw new PlatformBillingError("VERSION_CONFLICT");
        }
        const changed = await tx.platformBillingAccount.updateMany({
          where: { id: existing.id, companyId, version: input.version }, data: { ...common, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new PlatformBillingError("VERSION_CONFLICT");
        account = await tx.platformBillingAccount.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        if (input.version !== null && input.version !== undefined && input.version !== 0) throw new PlatformBillingError("VERSION_CONFLICT");
        account = await tx.platformBillingAccount.create({ data: { companyId, ...common, createdById: userId } });
      }
      await this.audit.append(tx, {
        companyId, actorUserId: userId,
        action: existing ? "PLATFORM_BILLING_ACCOUNT_UPDATED" : "PLATFORM_BILLING_ACCOUNT_CREATED",
        entityType: "PLATFORM_BILLING_ACCOUNT", entityId: account.id.toString(),
        details: { status: account.status, planName: account.planName, currencyCode: account.currencyCode, version: account.version },
      });
      return { account: accountJson(account) };
    });
  }

  async issueInvoice(userId: bigint, companyId: bigint, input: PlatformInvoiceInput) {
    await this.operators.requireOperator(userId);
    const periodStart = date(input.periodStart);
    const periodEnd = date(input.periodEnd);
    const issueDate = date(input.issueDate);
    if (periodEnd < periodStart || periodEnd.getTime() - periodStart.getTime() > 370 * 86_400_000) {
      throw new PlatformBillingError("INVALID_DATE_RANGE");
    }
    const usage = await this.analytics.companyUsage({ companyId, periodStart, periodEndExclusive: addDays(periodEnd, 1) });
    if (!usage) throw new PlatformBillingError("NOT_FOUND");
    try {
      return await this.execute(userId, companyId, "ISSUE_PLATFORM_BILLING_INVOICE", input.idempotencyKey, input, 201, async (tx) => {
        const account = await tx.platformBillingAccount.findUnique({ where: { companyId } });
        if (!account) throw new PlatformBillingError("ACCOUNT_NOT_CONFIGURED");
        if (account.status !== "ACTIVE" && account.status !== "TRIAL") throw new PlatformBillingError("INVALID_ACCOUNT_STATE");
        if (await tx.platformBillingInvoice.findUnique({ where: { companyId_periodStart_periodEnd: { companyId, periodStart, periodEnd } }, select: { id: true } })) {
          throw new PlatformBillingError("PERIOD_ALREADY_INVOICED");
        }
        const calculation = calculatePlatformInvoice(account, usage, input.adjustments);
        const invoice = await tx.platformBillingInvoice.create({
          data: {
            companyId, billingAccountId: account.id, invoiceNumber: `TMP-${randomUUID()}`,
            periodStart, periodEnd, issueDate, dueDate: addDays(issueDate, account.paymentTermsDays),
            currencyCode: account.currencyCode,
            usageUsers: usage.users, usageEmployees: usage.employees,
            usagePostedDocuments: usage.postedDocuments, usageOperations: usage.operations,
            subtotal: calculation.subtotal, taxRateSnapshot: account.taxRate,
            taxAmount: calculation.taxAmount, totalAmount: calculation.totalAmount,
            notes: input.notes ?? null, issuedById: userId,
            lines: { create: calculation.lines.map((line, index) => ({
              companyId, lineNumber: index + 1, lineType: line.lineType, description: line.description,
              quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount,
            })) },
          },
        });
        const invoiceNumber = `PLT-${issueDate.getUTCFullYear()}-${invoice.id.toString().padStart(8, "0")}`;
        await tx.platformBillingInvoice.update({ where: { id: invoice.id }, data: { invoiceNumber } });
        await this.audit.append(tx, {
          companyId, actorUserId: userId, action: "PLATFORM_BILLING_INVOICE_ISSUED",
          entityType: "PLATFORM_BILLING_INVOICE", entityId: invoice.publicId,
          details: { invoiceNumber, periodStart: input.periodStart, periodEnd: input.periodEnd, totalAmount: calculation.totalAmount.toFixed(4), currencyCode: account.currencyCode, usage },
        });
        const saved = await tx.platformBillingInvoice.findUniqueOrThrow({
          where: { id: invoice.id }, include: { lines: { orderBy: { lineNumber: "asc" } }, payments: true },
        });
        return { invoice: invoiceJson(saved, this.now()) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PlatformBillingError("PERIOD_ALREADY_INVOICED");
      }
      throw error;
    }
  }

  async recordPayment(userId: bigint, invoiceId: string, input: PlatformPaymentInput) {
    await this.operators.requireOperator(userId);
    const target = await this.prisma.platformBillingInvoice.findUnique({ where: { publicId: invoiceId }, select: { companyId: true } });
    if (!target) throw new PlatformBillingError("NOT_FOUND");
    const amount = rounded(money(input.amount));
    if (!amount.isFinite() || amount.lte(0)) throw new PlatformBillingError("INVALID_AMOUNT");
    return this.execute(userId, target.companyId, "RECORD_PLATFORM_BILLING_PAYMENT", input.idempotencyKey, { invoiceId, ...input }, 201, async (tx) => {
      const invoice = await tx.platformBillingInvoice.findUnique({
        where: { publicId: invoiceId }, include: { lines: true, payments: true },
      });
      if (!invoice) throw new PlatformBillingError("NOT_FOUND");
      if (invoice.state !== "ISSUED") throw new PlatformBillingError("INVOICE_NOT_OPEN");
      if (invoice.version !== input.invoiceVersion) throw new PlatformBillingError("VERSION_CONFLICT");
      const balance = invoice.totalAmount.minus(invoicePaid(invoice));
      if (amount.gt(balance)) throw new PlatformBillingError("PAYMENT_EXCEEDS_BALANCE");
      const payment = await tx.platformBillingPayment.create({ data: {
        companyId: invoice.companyId, invoiceId: invoice.id, paymentDate: date(input.paymentDate), amount,
        method: input.method, reference: input.reference ?? null, notes: input.notes ?? null, receivedById: userId,
      } });
      const changed = await tx.platformBillingInvoice.updateMany({
        where: { id: invoice.id, companyId: invoice.companyId, version: input.invoiceVersion }, data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PlatformBillingError("VERSION_CONFLICT");
      await this.audit.append(tx, {
        companyId: invoice.companyId, actorUserId: userId, action: "PLATFORM_BILLING_PAYMENT_RECORDED",
        entityType: "PLATFORM_BILLING_PAYMENT", entityId: payment.publicId,
        details: { invoiceId, invoiceNumber: invoice.invoiceNumber, amount: amount.toFixed(4), method: input.method, reference: input.reference ?? null },
      });
      const saved = await tx.platformBillingInvoice.findUniqueOrThrow({
        where: { id: invoice.id }, include: { lines: { orderBy: { lineNumber: "asc" } }, payments: { orderBy: [{ paymentDate: "desc" }, { id: "desc" }] } },
      });
      return { invoice: invoiceJson(saved, this.now()) };
    });
  }

  async voidInvoice(userId: bigint, invoiceId: string, input: { version: number; reason: string; idempotencyKey: string }) {
    await this.operators.requireOperator(userId);
    const target = await this.prisma.platformBillingInvoice.findUnique({ where: { publicId: invoiceId }, select: { companyId: true } });
    if (!target) throw new PlatformBillingError("NOT_FOUND");
    return this.execute(userId, target.companyId, "VOID_PLATFORM_BILLING_INVOICE", input.idempotencyKey, { invoiceId, ...input }, 200, async (tx) => {
      const invoice = await tx.platformBillingInvoice.findUnique({ where: { publicId: invoiceId }, include: { lines: true, payments: true } });
      if (!invoice) throw new PlatformBillingError("NOT_FOUND");
      if (invoice.state !== "ISSUED") throw new PlatformBillingError("INVOICE_NOT_OPEN");
      if (invoice.version !== input.version) throw new PlatformBillingError("VERSION_CONFLICT");
      if (invoice.payments.length) throw new PlatformBillingError("INVOICE_HAS_PAYMENTS");
      const voidedAt = this.now();
      const changed = await tx.platformBillingInvoice.updateMany({
        where: { id: invoice.id, companyId: invoice.companyId, state: "ISSUED", version: input.version },
        data: { state: "VOID", voidedById: userId, voidedAt, voidReason: input.reason, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PlatformBillingError("VERSION_CONFLICT");
      await this.audit.append(tx, {
        companyId: invoice.companyId, actorUserId: userId, action: "PLATFORM_BILLING_INVOICE_VOIDED",
        entityType: "PLATFORM_BILLING_INVOICE", entityId: invoice.publicId,
        details: { invoiceNumber: invoice.invoiceNumber, reason: input.reason },
      });
      const saved = await tx.platformBillingInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true, payments: true } });
      return { invoice: invoiceJson(saved, this.now()) };
    });
  }

  private companyTotals(invoices: InvoiceGraph[]) {
    const active = invoices.filter((invoice) => invoice.state !== "VOID");
    const billed = active.reduce((sum, invoice) => sum.plus(invoice.totalAmount), money(0));
    const paid = active.reduce((sum, invoice) => sum.plus(invoicePaid(invoice)), money(0));
    const overdue = active.filter((invoice) => invoiceStatus(invoice, this.now()) === "OVERDUE")
      .reduce((sum, invoice) => sum.plus(invoice.totalAmount.minus(invoicePaid(invoice))), money(0));
    return {
      billed: rounded(billed).toFixed(4), paid: rounded(paid).toFixed(4),
      balance: rounded(Prisma.Decimal.max(money(0), billed.minus(paid))).toFixed(4),
      overdue: rounded(Prisma.Decimal.max(money(0), overdue)).toFixed(4),
    };
  }

  private execute<T>(
    userId: bigint,
    companyId: bigint,
    operation: string,
    key: string,
    payload: unknown,
    responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context: { userId, companyId }, operation, key, fingerprint: JSON.stringify(payload), responseStatus,
      errors: {
        mismatch: () => new PlatformBillingError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new PlatformBillingError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }
}
