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
import type { PlatformBillingSubscriptionSnapshotPort } from "../platform-subscriptions/platform-billing-subscription-snapshot-port.js";

export type PlatformBillingFailureReason =
  | "NOT_FOUND"
  | "INVALID_AMOUNT"
  | "INVALID_DATE_RANGE"
  | "INVALID_ACCOUNT_STATE"
  | "ACCOUNT_NOT_CONFIGURED"
  | "CURRENCY_CHANGE_WITH_HISTORY"
  | "BILLING_CURRENCY_MISMATCH"
  | "PERIOD_ALREADY_INVOICED"
  | "VERSION_CONFLICT"
  | "INVOICE_NOT_OPEN"
  | "INVOICE_HAS_PAYMENTS"
  | "INVOICE_HAS_ACTIVE_CHECKOUT"
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
  subscriptionChangeId?: string | null | undefined;
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

export type PlatformBillingPagination = {
  page: number;
  pageSize: number;
};

export const PLATFORM_BILLING_DEFAULT_PAGE_SIZE = 10;
export const PLATFORM_BILLING_MAX_PAGE_SIZE = 25;
export const PLATFORM_BILLING_RECENT_PAYMENT_LIMIT = 5;

type InvoiceGraph = PlatformBillingInvoice & {
  lines: PlatformBillingInvoiceLine[];
  payments: PlatformBillingPayment[];
};

type BillingTotals = {
  billed: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  overdue: Prisma.Decimal;
};

type AccountBillingAggregateRow = {
  billing_account_id: bigint;
  billed: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  overdue: Prisma.Decimal;
  overdue_invoices: bigint | Prisma.Decimal;
};

type CurrencyBillingAggregateRow = BillingTotals & {
  currency_code: string;
  configured_accounts: bigint;
  active_accounts: bigint;
  overdue_invoices: bigint | Prisma.Decimal;
};

type CurrencyRecurringFeeAggregateRow = {
  currency_code: string;
  billing_cycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  recurring_fee: Prisma.Decimal;
};

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
// MySQL/MariaDB DECIMAL SUM may return up to 65 digits. Keep this reporting-only
// arithmetic local so monthly normalization cannot lose fractional money through
// Decimal.js' default 20-significant-digit operation precision.
const PlatformReportingDecimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const nonNegative = (value: Prisma.Decimal) => value.gte(0) && value.isFinite();
const emptyBillingTotals = (): BillingTotals => ({
  billed: money(0),
  paid: money(0),
  balance: money(0),
  overdue: money(0),
});
const countFromDatabase = (value: bigint | number | Prisma.Decimal) => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid aggregate count: ${value}`);
    return value;
  }
  const text = value.toString();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid aggregate count: ${text}`);
  const exact = BigInt(text);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Aggregate count exceeds Number.MAX_SAFE_INTEGER: ${text}`);
  return Number(exact);
};
const paginationMeta = (input: PlatformBillingPagination, total: number) => ({
  page: input.page,
  pageSize: input.pageSize,
  total,
  totalPages: Math.ceil(total / input.pageSize),
});
const invoicePaid = (invoice: Pick<InvoiceGraph, "payments">) =>
  invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), money(0));

export function calculatePlatformRecurringMonthly(
  rows: Array<{
    billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
    recurringFee: Prisma.Decimal.Value;
  }>,
) {
  const total = rows.reduce((sum, row) => {
    const fee = new PlatformReportingDecimal(row.recurringFee.toString());
    if (row.billingCycle === "QUARTERLY") return sum.plus(fee.div(3));
    if (row.billingCycle === "ANNUAL") return sum.plus(fee.div(12));
    return sum.plus(fee);
  }, new PlatformReportingDecimal(0));
  return money(total.toDecimalPlaces(4, PlatformReportingDecimal.ROUND_HALF_UP).toFixed(4));
}

const invoicePaymentRowsSql = (where: Prisma.Sql) => Prisma.sql`
  SELECT
    invoice.id,
    invoice.company_id,
    invoice.billing_account_id,
    invoice.state,
    invoice.due_date,
    invoice.total_amount,
    GREATEST(COALESCE(payment.paid_amount, 0) - COALESCE(refund.refunded_amount, 0), 0) AS paid_amount
  FROM platform_billing_invoices AS invoice
  LEFT JOIN (
    SELECT company_id, invoice_id, SUM(amount) AS paid_amount
    FROM platform_billing_payments
    GROUP BY company_id, invoice_id
  ) AS payment
    ON payment.invoice_id = invoice.id AND payment.company_id = invoice.company_id
  LEFT JOIN (
    SELECT payment.company_id, payment.invoice_id, SUM(refund.amount) AS refunded_amount
    FROM platform_billing_refunds AS refund
    INNER JOIN platform_billing_payments AS payment
      ON payment.id = refund.payment_id AND payment.company_id = refund.company_id
    WHERE refund.state = 'SUCCEEDED'
    GROUP BY payment.company_id, payment.invoice_id
  ) AS refund
    ON refund.invoice_id = invoice.id AND refund.company_id = invoice.company_id
  WHERE ${where}
  GROUP BY
    invoice.id,
    invoice.company_id,
    invoice.billing_account_id,
    invoice.state,
    invoice.due_date,
    invoice.total_amount,
    payment.paid_amount,
    refund.refunded_amount
`;

const accountFinancialAggregatesSql = (where: Prisma.Sql, today: Date) => Prisma.sql`
  SELECT
    invoice_row.billing_account_id,
    COALESCE(SUM(invoice_row.total_amount), 0) AS billed,
    COALESCE(SUM(invoice_row.paid_amount), 0) AS paid,
    GREATEST(COALESCE(SUM(invoice_row.total_amount), 0) - COALESCE(SUM(invoice_row.paid_amount), 0), 0) AS balance,
    COALESCE(SUM(
      CASE
        WHEN invoice_row.due_date < ${today} AND invoice_row.paid_amount < invoice_row.total_amount
          THEN invoice_row.total_amount - invoice_row.paid_amount
        ELSE 0
      END
    ), 0) AS overdue,
    COUNT(
      CASE
        WHEN invoice_row.due_date < ${today} AND invoice_row.paid_amount < invoice_row.total_amount THEN 1
      END
    ) AS overdue_invoices
  FROM (${invoicePaymentRowsSql(where)}) AS invoice_row
  WHERE invoice_row.state <> 'VOID'
  GROUP BY invoice_row.billing_account_id
`;

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

function invoiceStatus(
  invoice: Pick<InvoiceGraph, "state" | "totalAmount" | "dueDate">,
  paid: Prisma.Decimal,
  now: Date,
) {
  if (invoice.state === "VOID") return "VOID" as const;
  if (paid.gte(invoice.totalAmount)) return "PAID" as const;
  if (invoice.dueDate < date(dateString(now))) return "OVERDUE" as const;
  if (paid.gt(0)) return "PARTIALLY_PAID" as const;
  return "ISSUED" as const;
}

function invoiceJson(
  invoice: InvoiceGraph,
  now: Date,
  paymentAggregate?: { paid: Prisma.Decimal.Value; count: number },
) {
  const paid = rounded(paymentAggregate ? money(paymentAggregate.paid) : invoicePaid(invoice));
  const paymentCount = paymentAggregate?.count ?? invoice.payments.length;
  const balance = Prisma.Decimal.max(money(0), invoice.totalAmount.minus(paid));
  return {
    id: invoice.publicId,
    companyId: invoice.companyId.toString(),
    billingAccountId: invoice.billingAccountId.toString(),
    subscriptionId: invoice.subscriptionId?.toString() ?? null,
    planVersionId: invoice.planVersionId?.toString() ?? null,
    subscriptionChangeId: invoice.subscriptionChangeId?.toString() ?? null,
    planDisplayNameSnapshot: invoice.planDisplayNameSnapshot,
    invoiceNumber: invoice.invoiceNumber,
    state: invoice.state,
    status: invoiceStatus(invoice, paid, now),
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
    paymentCount,
    lines: invoice.lines.map((line) => ({
      id: line.id.toString(), lineNumber: line.lineNumber, lineType: line.lineType,
      description: line.description, quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(4), amount: line.amount.toFixed(4),
    })),
    payments: invoice.payments.slice(0, PLATFORM_BILLING_RECENT_PAYMENT_LIMIT).map((payment) => ({
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

async function lockPlatformBillingAccount(
  tx: Prisma.TransactionClient,
  companyId: bigint,
) {
  await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id
    FROM platform_billing_accounts
    WHERE company_id = ${companyId}
    FOR UPDATE
  `;
}

export function assertPlatformBillingCurrencyChangeAllowed(
  existingCurrencyCode: string,
  requestedCurrencyCode: string,
  hasInvoiceHistory: boolean,
) {
  if (existingCurrencyCode !== requestedCurrencyCode && hasInvoiceHistory) {
    throw new PlatformBillingError("CURRENCY_CHANGE_WITH_HISTORY");
  }
}

export class PlatformBillingService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly operators: Pick<PlatformOperationsService, "requireOperator">,
    private readonly analytics: PlatformAnalyticsQueryPort,
    private readonly audit: AuditAppendPort,
    private readonly now: () => Date = () => new Date(),
    private readonly subscriptionSnapshots?: PlatformBillingSubscriptionSnapshotPort,
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async summary(
    userId: bigint,
    pagination: PlatformBillingPagination = { page: 1, pageSize: PLATFORM_BILLING_DEFAULT_PAGE_SIZE },
  ) {
    await this.operators.requireOperator(userId);
    const now = this.now();
    const [totalCompanies, accounts, currencyAggregates] = await Promise.all([
      this.analytics.companyCount(),
      this.prisma.platformBillingAccount.findMany({
        orderBy: [{ nextBillingDate: "asc" }, { id: "asc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.currencyBillingAggregates(now),
    ]);
    const { financial: currencyRows, recurring: recurringRows } = currencyAggregates;
    const [references, accountTotals] = accounts.length
      ? await Promise.all([
        this.analytics.companyReferences(accounts.map((account) => account.companyId)),
        this.accountBillingAggregates(accounts.map((account) => account.id), now),
      ])
      : [[], []];
    const names = new Map(references.map((company) => [company.id, company]));
    const totalsByAccount = new Map(accountTotals.map((row) => [row.billing_account_id.toString(), row]));
    const accountRows = accounts.map((account) => {
      const aggregate = totalsByAccount.get(account.id.toString()) ?? emptyBillingTotals();
      const company = names.get(account.companyId.toString());
      return {
        companyId: account.companyId.toString(), companyName: company?.name ?? "—",
        companyActive: company?.isActive ?? false, account: accountJson(account),
        ...this.billingTotalsJson(aggregate),
      };
    });
    const recurringByCurrency = new Map<string, CurrencyRecurringFeeAggregateRow[]>();
    for (const row of recurringRows) {
      const rows = recurringByCurrency.get(row.currency_code) ?? [];
      rows.push(row);
      recurringByCurrency.set(row.currency_code, rows);
    }
    const currencies = currencyRows.map((row) => {
      const billed = rounded(money(row.billed));
      const paid = rounded(money(row.paid));
      const recurringMonthly = calculatePlatformRecurringMonthly(
        (recurringByCurrency.get(row.currency_code) ?? []).map((recurring) => ({
          billingCycle: recurring.billing_cycle,
          recurringFee: recurring.recurring_fee,
        })),
      );
      return {
        currencyCode: row.currency_code,
        recurringMonthly: recurringMonthly.toFixed(4),
        billed: billed.toFixed(4), paid: paid.toFixed(4),
        balance: rounded(money(row.balance)).toFixed(4), overdue: rounded(money(row.overdue)).toFixed(4),
        collectionRate: billed.gt(0) ? paid.div(billed).mul(100).toFixed(1) : "0.0",
      };
    });
    const configuredCompanies = currencyRows.reduce(
      (total, row) => total + countFromDatabase(row.configured_accounts),
      0,
    );
    const activeAccounts = currencyRows.reduce(
      (total, row) => total + countFromDatabase(row.active_accounts),
      0,
    );
    const overdueInvoices = currencyRows.reduce(
      (total, row) => total + countFromDatabase(row.overdue_invoices),
      0,
    );
    return {
      generatedAt: now.toISOString(),
      metrics: {
        totalCompanies, configuredCompanies,
        unconfiguredCompanies: Math.max(0, totalCompanies - configuredCompanies),
        activeAccounts, overdueInvoices,
      },
      currencies,
      accounts: accountRows,
      meta: paginationMeta(pagination, configuredCompanies),
    };
  }

  async companyBilling(
    userId: bigint,
    companyId: bigint,
    pagination: PlatformBillingPagination = { page: 1, pageSize: PLATFORM_BILLING_DEFAULT_PAGE_SIZE },
  ) {
    await this.operators.requireOperator(userId);
    const [reference] = await this.analytics.companyReferences([companyId]);
    if (!reference) throw new PlatformBillingError("NOT_FOUND");
    const now = this.now();
    const [account, invoiceTotal, invoices, aggregate] = await Promise.all([
      this.prisma.platformBillingAccount.findUnique({ where: { companyId } }),
      this.prisma.platformBillingInvoice.count({ where: { companyId } }),
      this.prisma.platformBillingInvoice.findMany({
        where: { companyId },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          payments: {
            orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
            take: PLATFORM_BILLING_RECENT_PAYMENT_LIMIT,
          },
        },
        orderBy: [{ issueDate: "desc" }, { id: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.companyBillingAggregate(companyId, now),
    ]);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [paymentAggregates, succeededRefunds] = invoices.length
      ? await Promise.all([
        this.prisma.platformBillingPayment.groupBy({
          by: ["invoiceId"],
          where: { companyId, invoiceId: { in: invoiceIds } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.platformBillingRefund.findMany({
          where: { companyId, state: "SUCCEEDED", payment: { invoiceId: { in: invoiceIds } } },
          select: { amount: true, payment: { select: { invoiceId: true } } },
        }),
      ])
      : [[], []] as const;
    const paymentsByInvoice = new Map(paymentAggregates.map((payment) => [payment.invoiceId.toString(), payment]));
    const refundedByInvoice = new Map<string, Prisma.Decimal>();
    for (const refund of succeededRefunds) {
      const key = refund.payment.invoiceId.toString();
      refundedByInvoice.set(key, (refundedByInvoice.get(key) ?? money(0)).plus(refund.amount));
    }
    return {
      company: reference,
      account: account ? accountJson(account) : null,
      totals: this.billingTotalsJson(aggregate),
      invoices: invoices.map((invoice) => {
        const payments = paymentsByInvoice.get(invoice.id.toString());
        return invoiceJson(invoice, now, {
          paid: Prisma.Decimal.max(
            money(0),
            money(payments?._sum.amount ?? 0).minus(refundedByInvoice.get(invoice.id.toString()) ?? money(0)),
          ),
          count: payments?._count._all ?? 0,
        });
      }),
      meta: paginationMeta(pagination, invoiceTotal),
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
      await lockPlatformBillingAccount(tx, companyId);
      const existing = await tx.platformBillingAccount.findUnique({ where: { companyId } });
      const requestedCurrencyCode = input.currencyCode.toUpperCase();
      if (existing && (input.version === null || input.version === undefined || existing.version !== input.version)) {
        throw new PlatformBillingError("VERSION_CONFLICT");
      }
      if (existing && existing.currencyCode !== requestedCurrencyCode) {
        const invoiceHistory = await tx.platformBillingInvoice.findFirst({
          where: { companyId, billingAccountId: existing.id },
          select: { id: true },
        });
        assertPlatformBillingCurrencyChangeAllowed(
          existing.currencyCode,
          requestedCurrencyCode,
          invoiceHistory !== null,
        );
      }
      const common = {
        status: input.status,
        planName: input.planName,
        billingCycle: input.billingCycle,
        currencyCode: requestedCurrencyCode,
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
        const changed = await tx.platformBillingAccount.updateMany({
          where: { id: existing.id, companyId, version: existing.version }, data: { ...common, version: { increment: 1 } },
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
        await lockPlatformBillingAccount(tx, companyId);
        const account = await tx.platformBillingAccount.findUnique({ where: { companyId } });
        if (!account) throw new PlatformBillingError("ACCOUNT_NOT_CONFIGURED");
        if (account.status !== "ACTIVE" && account.status !== "TRIAL") throw new PlatformBillingError("INVALID_ACCOUNT_STATE");
        if (await tx.platformBillingInvoice.findUnique({ where: { companyId_periodStart_periodEnd: { companyId, periodStart, periodEnd } }, select: { id: true } })) {
          throw new PlatformBillingError("PERIOD_ALREADY_INVOICED");
        }
        const subscriptionSnapshot = await this.subscriptionSnapshots?.resolve(tx, {
          companyId,
          subscriptionChangePublicId: input.subscriptionChangeId,
          asOf: issueDate,
        }) ?? null;
        if (input.subscriptionChangeId && !subscriptionSnapshot) throw new PlatformBillingError("NOT_FOUND");
        if (subscriptionSnapshot && subscriptionSnapshot.currencyCode !== account.currencyCode) {
          throw new PlatformBillingError("BILLING_CURRENCY_MISMATCH");
        }
        const pricing = subscriptionSnapshot ?? account;
        const calculation = calculatePlatformInvoice(pricing, usage, input.adjustments);
        const invoice = await tx.platformBillingInvoice.create({
          data: {
            companyId, billingAccountId: account.id, invoiceNumber: `TMP-${randomUUID()}`,
            ...(subscriptionSnapshot ? {
              subscriptionId: subscriptionSnapshot.subscriptionId,
              planVersionId: subscriptionSnapshot.planVersionId,
              subscriptionChangeId: subscriptionSnapshot.subscriptionChangeId,
              planDisplayNameSnapshot: subscriptionSnapshot.planDisplayName,
            } : {}),
            periodStart, periodEnd, issueDate, dueDate: addDays(issueDate, pricing.paymentTermsDays),
            currencyCode: account.currencyCode,
            usageUsers: usage.users, usageEmployees: usage.employees,
            usagePostedDocuments: usage.postedDocuments, usageOperations: usage.operations,
            subtotal: calculation.subtotal, taxRateSnapshot: pricing.taxRate,
            taxAmount: calculation.taxAmount, totalAmount: calculation.totalAmount,
            notes: input.notes ?? null, issuedById: userId,
            lines: { create: calculation.lines.map((line, index) => ({
              lineNumber: index + 1, lineType: line.lineType, description: line.description,
              quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount,
            })) },
          },
        });
        const invoiceNumber = `PLT-${issueDate.getUTCFullYear()}-${invoice.id.toString().padStart(8, "0")}`;
        await tx.platformBillingInvoice.update({ where: { id: invoice.id }, data: { invoiceNumber } });
        await this.audit.append(tx, {
          companyId, actorUserId: userId, action: "PLATFORM_BILLING_INVOICE_ISSUED",
          entityType: "PLATFORM_BILLING_INVOICE", entityId: invoice.publicId,
          details: {
            invoiceNumber, periodStart: input.periodStart, periodEnd: input.periodEnd,
            totalAmount: calculation.totalAmount.toFixed(4), currencyCode: account.currencyCode, usage,
            subscriptionChangeId: input.subscriptionChangeId ?? null,
            planVersionId: subscriptionSnapshot?.planVersionId.toString() ?? null,
          },
        });
        const saved = await tx.platformBillingInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: {
            lines: { orderBy: { lineNumber: "asc" } },
            payments: { take: PLATFORM_BILLING_RECENT_PAYMENT_LIMIT },
          },
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
        where: { publicId: invoiceId },
      });
      if (!invoice) throw new PlatformBillingError("NOT_FOUND");
      if (invoice.state !== "ISSUED") throw new PlatformBillingError("INVOICE_NOT_OPEN");
      if (invoice.version !== input.invoiceVersion) throw new PlatformBillingError("VERSION_CONFLICT");
      const [existingPayments, succeededRefunds, activeCheckout] = await Promise.all([
        tx.platformBillingPayment.aggregate({
          where: { companyId: invoice.companyId, invoiceId: invoice.id },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        tx.platformBillingRefund.aggregate({
          where: { companyId: invoice.companyId, state: "SUCCEEDED", payment: { invoiceId: invoice.id } },
          _sum: { amount: true },
        }),
        tx.platformPaymentAttempt.findFirst({
          where: { companyId: invoice.companyId, invoiceId: invoice.id, state: { in: ["CHECKOUT", "PENDING"] } },
          select: { id: true },
        }),
      ]);
      if (activeCheckout) throw new PlatformBillingError("INVOICE_HAS_ACTIVE_CHECKOUT");
      const paidBefore = Prisma.Decimal.max(
        money(0),
        money(existingPayments._sum.amount ?? 0).minus(succeededRefunds._sum.amount ?? money(0)),
      );
      const balance = invoice.totalAmount.minus(paidBefore);
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
        where: { id: invoice.id },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          payments: {
            orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
            take: PLATFORM_BILLING_RECENT_PAYMENT_LIMIT,
          },
        },
      });
      return { invoice: invoiceJson(saved, this.now(), {
        paid: paidBefore.plus(amount),
        count: existingPayments._count._all + 1,
      }) };
    });
  }

  async voidInvoice(userId: bigint, invoiceId: string, input: { version: number; reason: string; idempotencyKey: string }) {
    await this.operators.requireOperator(userId);
    const target = await this.prisma.platformBillingInvoice.findUnique({ where: { publicId: invoiceId }, select: { companyId: true } });
    if (!target) throw new PlatformBillingError("NOT_FOUND");
    return this.execute(userId, target.companyId, "VOID_PLATFORM_BILLING_INVOICE", input.idempotencyKey, { invoiceId, ...input }, 200, async (tx) => {
      const invoice = await tx.platformBillingInvoice.findUnique({ where: { publicId: invoiceId } });
      if (!invoice) throw new PlatformBillingError("NOT_FOUND");
      if (invoice.state !== "ISSUED") throw new PlatformBillingError("INVOICE_NOT_OPEN");
      if (invoice.version !== input.version) throw new PlatformBillingError("VERSION_CONFLICT");
      if (await tx.platformBillingPayment.count({
        where: { companyId: invoice.companyId, invoiceId: invoice.id },
      })) throw new PlatformBillingError("INVOICE_HAS_PAYMENTS");
      if (await tx.platformPaymentAttempt.count({
        where: { companyId: invoice.companyId, invoiceId: invoice.id },
      })) throw new PlatformBillingError("INVOICE_HAS_ACTIVE_CHECKOUT");
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
      const saved = await tx.platformBillingInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          payments: { take: PLATFORM_BILLING_RECENT_PAYMENT_LIMIT },
        },
      });
      return { invoice: invoiceJson(saved, this.now(), { paid: money(0), count: 0 }) };
    });
  }

  private billingTotalsJson(totals: BillingTotals) {
    return {
      billed: rounded(money(totals.billed)).toFixed(4),
      paid: rounded(money(totals.paid)).toFixed(4),
      balance: rounded(Prisma.Decimal.max(money(0), money(totals.balance))).toFixed(4),
      overdue: rounded(Prisma.Decimal.max(money(0), money(totals.overdue))).toFixed(4),
    };
  }

  private accountBillingAggregates(accountIds: bigint[], now: Date) {
    if (!accountIds.length) return Promise.resolve([] as AccountBillingAggregateRow[]);
    return this.prisma.$queryRaw<AccountBillingAggregateRow[]>(accountFinancialAggregatesSql(
      Prisma.sql`invoice.billing_account_id IN (${Prisma.join(accountIds)})`,
      date(dateString(now)),
    ));
  }

  private companyBillingAggregate(companyId: bigint, now: Date) {
    return this.prisma.$queryRaw<AccountBillingAggregateRow[]>(accountFinancialAggregatesSql(
      Prisma.sql`invoice.company_id = ${companyId}`,
      date(dateString(now)),
    )).then((rows) => rows[0] ?? emptyBillingTotals());
  }

  private currencyBillingAggregates(now: Date) {
    const accountAggregates = accountFinancialAggregatesSql(Prisma.sql`TRUE`, date(dateString(now)));
    return Promise.all([
      this.prisma.$queryRaw<CurrencyBillingAggregateRow[]>(Prisma.sql`
        SELECT
          account.currency_code,
          COUNT(*) AS configured_accounts,
          COUNT(CASE WHEN account.status = 'ACTIVE' THEN 1 END) AS active_accounts,
          COALESCE(SUM(financial.billed), 0) AS billed,
          COALESCE(SUM(financial.paid), 0) AS paid,
          COALESCE(SUM(financial.balance), 0) AS balance,
          COALESCE(SUM(financial.overdue), 0) AS overdue,
          COALESCE(SUM(financial.overdue_invoices), 0) AS overdue_invoices
        FROM platform_billing_accounts AS account
        LEFT JOIN (${accountAggregates}) AS financial
          ON financial.billing_account_id = account.id
        GROUP BY account.currency_code
        ORDER BY account.currency_code ASC
      `),
      this.prisma.$queryRaw<CurrencyRecurringFeeAggregateRow[]>(Prisma.sql`
        SELECT
          account.currency_code,
          account.billing_cycle,
          COALESCE(SUM(account.recurring_fee), 0) AS recurring_fee
        FROM platform_billing_accounts AS account
        WHERE account.status IN ('TRIAL', 'ACTIVE')
        GROUP BY account.currency_code, account.billing_cycle
        ORDER BY account.currency_code ASC, account.billing_cycle ASC
      `),
    ]).then(([financial, recurring]) => ({ financial, recurring }));
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
