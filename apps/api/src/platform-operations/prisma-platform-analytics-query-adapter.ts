import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  PlatformAnalyticsDashboard,
  PlatformAnalyticsQueryPort,
  PlatformCompanyDetails,
  PlatformCompanyReference,
  PlatformCompanySummary,
  PlatformCompanyUsage,
  PlatformModuleActivity,
  PlatformOverview,
} from "./platform-operations-ports.js";
import { calculatePlatformRecurringMonthly } from "./platform-billing-service.js";

type CountPair = { total: number; recent: number };

const percentage = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

const dayMilliseconds = 86_400_000;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * dayMilliseconds);
const PlatformAnalyticsDecimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const decimal = (value: Prisma.Decimal.Value) => new PlatformAnalyticsDecimal(value.toString());
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
const changePercent = (current: number, previous: number | null) => {
  if (previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
};
const decimalChangePercent = (current: Prisma.Decimal, previous: Prisma.Decimal | null) => {
  if (previous === null) return null;
  if (previous.eq(0)) return current.eq(0) ? 0 : null;
  return current.minus(previous).div(previous.abs()).mul(100).toDecimalPlaces(1).toNumber();
};
const comparedNumber = (current: number, previous: number | null) => ({
  current,
  previous,
  changePercent: changePercent(current, previous),
});
const comparedMoney = (current: Prisma.Decimal, previous: Prisma.Decimal | null) => ({
  current: fixed(current),
  previous: previous === null ? null : fixed(previous),
  changePercent: decimalChangePercent(current, previous),
});

type AnalyticsBucket = { from: Date; toExclusive: Date };

export const PLATFORM_ANALYTICS_BILLING_BATCH_SIZE = 500;

type PlatformBillingTimelineAggregate = {
  billed: Prisma.Decimal;
  collected: Prisma.Decimal;
};

type PlatformBillingCurrencyAggregate = {
  recurring: Array<{
    billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
    recurringFee: Prisma.Decimal.Value;
  }>;
  billed: Prisma.Decimal;
  priorBilled: Prisma.Decimal;
  collected: Prisma.Decimal;
  priorCollected: Prisma.Decimal;
  invoiceCount: number;
  priorInvoiceCount: number;
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
  aging: {
    notDue: Prisma.Decimal;
    days1To30: Prisma.Decimal;
    days31To60: Prisma.Decimal;
    days61Plus: Prisma.Decimal;
  };
  currentTimeline: PlatformBillingTimelineAggregate[];
  previousTimeline: PlatformBillingTimelineAggregate[] | null;
};

type PlatformBillingCompanyAggregate = {
  currencyCode: string;
  billed: Prisma.Decimal;
  collected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
};

const analyticsBuckets = (from: Date, toExclusive: Date, requestedCount = 12): AnalyticsBucket[] => {
  const totalDays = Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / dayMilliseconds));
  const count = Math.min(requestedCount, totalDays);
  return Array.from({ length: count }, (_, index) => {
    const startsAfterDays = Math.floor((totalDays * index) / count);
    const endsAfterDays = index === count - 1 ? totalDays : Math.floor((totalDays * (index + 1)) / count);
    return { from: addDays(from, startsAfterDays), toExclusive: addDays(from, endsAfterDays) };
  });
};

const within = (value: Date, from: Date, toExclusive: Date) => value >= from && value < toExclusive;

const monthBuckets = (now: Date, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { month: start.toISOString().slice(0, 7), start, end };
  });

export class PrismaPlatformAnalyticsQueryAdapter implements PlatformAnalyticsQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async analytics(input: Parameters<PlatformAnalyticsQueryPort["analytics"]>[0]): Promise<PlatformAnalyticsDashboard | null> {
    const companyOptions = await this.companyReferences();
    const scopedCompany = input.companyId === undefined
      ? null
      : companyOptions.find((company) => company.id === input.companyId!.toString()) ?? null;
    if (input.companyId !== undefined && !scopedCompany) return null;
    const references = scopedCompany ? [scopedCompany] : companyOptions;

    const companyWhere = input.companyId === undefined ? {} : { companyId: input.companyId };
    const companyEntityWhere = input.companyId === undefined ? {} : { id: input.companyId };
    const outboxCompanyWhere = input.companyId === undefined ? {} : { companyId: input.companyId };
    const currentBuckets = analyticsBuckets(input.from, input.toExclusive);
    const previousBuckets = input.comparisonFrom && input.comparisonToExclusive
      ? analyticsBuckets(input.comparisonFrom, input.comparisonToExclusive, currentBuckets.length)
      : null;

    const operationalSnapshot = async (from: Date, toExclusive: Date) => {
      const range = { gte: from, lt: toExclusive };
      const [activity, documents, securityAlerts, newCompanies] = await Promise.all([
        this.prisma.auditLog.groupBy({
          by: ["companyId"], where: { ...companyWhere, createdAt: range },
          _count: { _all: true }, _max: { createdAt: true },
        }),
        this.prisma.accountingDocument.groupBy({
          by: ["companyId"], where: { ...companyWhere, postedAt: range }, _count: { _all: true },
        }),
        this.prisma.securityEvent.count({
          where: { ...companyWhere, createdAt: range, severity: { in: ["HIGH", "CRITICAL"] } },
        }),
        this.prisma.company.count({ where: { ...companyEntityWhere, createdAt: range } }),
      ]);
      return {
        activity,
        documents,
        operations: activity.reduce((sum, row) => sum + row._count._all, 0),
        postedDocuments: documents.reduce((sum, row) => sum + row._count._all, 0),
        activeCompanies: activity.length,
        securityAlerts,
        newCompanies,
      };
    };

    const bucketSnapshot = (buckets: AnalyticsBucket[]) => Promise.all(buckets.map(async (bucket) => {
      const range = { gte: bucket.from, lt: bucket.toExclusive };
      const [operations, postedDocuments, securityAlerts, newCompanies] = await Promise.all([
        this.prisma.auditLog.count({ where: { ...companyWhere, createdAt: range } }),
        this.prisma.accountingDocument.count({ where: { ...companyWhere, postedAt: range } }),
        this.prisma.securityEvent.count({
          where: { ...companyWhere, createdAt: range, severity: { in: ["HIGH", "CRITICAL"] } },
        }),
        this.prisma.company.count({ where: { ...companyEntityWhere, createdAt: range } }),
      ]);
      return { operations, postedDocuments, securityAlerts, newCompanies };
    }));

    const previousSnapshotPromise = input.comparisonFrom && input.comparisonToExclusive
      ? operationalSnapshot(input.comparisonFrom, input.comparisonToExclusive)
      : Promise.resolve(null);
    const previousTimelinePromise = previousBuckets ? bucketSnapshot(previousBuckets) : Promise.resolve(null);
    const previousModulesPromise = input.comparisonFrom && input.comparisonToExclusive
      ? this.modulePairs(input.comparisonFrom, input.comparisonToExclusive, input.companyId)
      : Promise.resolve(null);

    const [
      currentSnapshot,
      previousSnapshot,
      currentTimeline,
      previousTimeline,
      currentModules,
      previousModules,
      billing,
      unacknowledgedSecurity,
      pendingOutbox,
      failedOutbox,
    ] = await Promise.all([
      operationalSnapshot(input.from, input.toExclusive),
      previousSnapshotPromise,
      bucketSnapshot(currentBuckets),
      previousTimelinePromise,
      this.modulePairs(input.from, input.toExclusive, input.companyId),
      previousModulesPromise,
      this.billingAnalytics({
        ...input,
        references,
        currentBuckets,
        previousBuckets,
      }),
      this.prisma.securityEvent.count({
        where: { ...companyWhere, acknowledgedAt: null, severity: { in: ["HIGH", "CRITICAL"] } },
      }),
      this.prisma.outboxEvent.count({
        where: { ...outboxCompanyWhere, status: { in: ["PENDING", "PROCESSING"] } },
      }),
      this.prisma.outboxEvent.count({ where: { ...outboxCompanyWhere, status: "FAILED" } }),
    ]);

    const previousValue = <T>(selector: (snapshot: NonNullable<typeof previousSnapshot>) => T): T | null =>
      previousSnapshot ? selector(previousSnapshot) : null;
    const activityByCompany = new Map(currentSnapshot.activity.map((row) => [row.companyId.toString(), row]));
    const documentsByCompany = new Map(currentSnapshot.documents.map((row) => [row.companyId.toString(), row._count._all]));
    const companies = references.map((company) => {
      const financial = billing.companies.get(company.id) ?? {
        currencyCode: company.baseCurrencyCode,
        billed: decimal(0), collected: decimal(0), outstanding: decimal(0), overdue: decimal(0),
      };
      const activity = activityByCompany.get(company.id);
      return {
        id: company.id, name: company.name, currencyCode: financial.currencyCode,
        operations: activity?._count._all ?? 0,
        postedDocuments: documentsByCompany.get(company.id) ?? 0,
        billed: fixed(financial.billed),
        collected: fixed(financial.collected),
        outstanding: fixed(financial.outstanding),
        overdue: fixed(financial.overdue),
        lastActivityAt: activity?._max.createdAt?.toISOString() ?? null,
      };
    }).sort((left, right) =>
      right.operations - left.operations
      || decimal(right.billed).comparedTo(decimal(left.billed))
      || left.name.localeCompare(right.name, "ar"),
    ).slice(0, 12);

    const activeReferenceIds = new Set(references.filter((company) => company.isActive).map((company) => company.id));

    return {
      generatedAt: input.now.toISOString(),
      scope: { company: scopedCompany },
      period: {
        from: dateOnly(input.from), to: dateOnly(addDays(input.toExclusive, -1)),
        days: Math.round((input.toExclusive.getTime() - input.from.getTime()) / dayMilliseconds),
        comparison: input.comparison,
        comparisonFrom: input.comparisonFrom ? dateOnly(input.comparisonFrom) : null,
        comparisonTo: input.comparisonToExclusive ? dateOnly(addDays(input.comparisonToExclusive, -1)) : null,
      },
      companyOptions,
      metrics: {
        operations: comparedNumber(currentSnapshot.operations, previousValue((snapshot) => snapshot.operations)),
        postedDocuments: comparedNumber(currentSnapshot.postedDocuments, previousValue((snapshot) => snapshot.postedDocuments)),
        activeCompanies: comparedNumber(currentSnapshot.activeCompanies, previousValue((snapshot) => snapshot.activeCompanies)),
        newCompanies: comparedNumber(currentSnapshot.newCompanies, previousValue((snapshot) => snapshot.newCompanies)),
        securityAlerts: comparedNumber(currentSnapshot.securityAlerts, previousValue((snapshot) => snapshot.securityAlerts)),
      },
      activityTimeline: currentBuckets.map((bucket, index) => ({
        key: dateOnly(bucket.from), from: dateOnly(bucket.from), to: dateOnly(addDays(bucket.toExclusive, -1)),
        operations: currentTimeline[index]!.operations,
        previousOperations: previousTimeline?.[index]?.operations ?? null,
        postedDocuments: currentTimeline[index]!.postedDocuments,
        previousPostedDocuments: previousTimeline?.[index]?.postedDocuments ?? null,
        securityAlerts: currentTimeline[index]!.securityAlerts,
        newCompanies: currentTimeline[index]!.newCompanies,
      })),
      financials: billing.financials,
      modules: currentModules.map((module, index) => ({
        code: module.code,
        current: module.recent,
        previous: previousModules?.[index]?.recent ?? null,
        changePercent: changePercent(module.recent, previousModules?.[index]?.recent ?? null),
      })),
      companies,
      alerts: {
        overdueInvoices: billing.overdueInvoices,
        dueSoonInvoices: billing.dueSoonInvoices,
        unacknowledgedSecurity,
        pendingOutbox,
        failedOutbox,
        staleCompanies: [...activeReferenceIds].filter((id) => !activityByCompany.has(id)).length,
      },
    };
  }

  private async billingAnalytics(input: Parameters<PlatformAnalyticsQueryPort["analytics"]>[0] & {
    references: PlatformCompanyReference[];
    currentBuckets: AnalyticsBucket[];
    previousBuckets: AnalyticsBucket[] | null;
  }) {
    const companyWhere = input.companyId === undefined ? {} : { companyId: input.companyId };
    const zeroTimeline = (buckets: AnalyticsBucket[]): PlatformBillingTimelineAggregate[] =>
      buckets.map(() => ({ billed: decimal(0), collected: decimal(0) }));
    const currencyAggregates = new Map<string, PlatformBillingCurrencyAggregate>();
    const currencyAggregate = (currencyCode: string) => {
      const existing = currencyAggregates.get(currencyCode);
      if (existing) return existing;
      const created: PlatformBillingCurrencyAggregate = {
        recurring: [],
        billed: decimal(0), priorBilled: decimal(0),
        collected: decimal(0), priorCollected: decimal(0),
        invoiceCount: 0, priorInvoiceCount: 0,
        outstanding: decimal(0), overdue: decimal(0),
        aging: {
          notDue: decimal(0), days1To30: decimal(0),
          days31To60: decimal(0), days61Plus: decimal(0),
        },
        currentTimeline: zeroTimeline(input.currentBuckets),
        previousTimeline: input.previousBuckets ? zeroTimeline(input.previousBuckets) : null,
      };
      currencyAggregates.set(currencyCode, created);
      return created;
    };
    const [accountCurrencies, recurringRows] = await Promise.all([
      this.prisma.platformBillingAccount.findMany({
        where: companyWhere,
        select: { companyId: true, currencyCode: true },
        orderBy: { companyId: "asc" },
      }),
      this.prisma.platformBillingAccount.groupBy({
        by: ["currencyCode", "billingCycle"],
        where: { ...companyWhere, status: { in: ["TRIAL", "ACTIVE"] } },
        _sum: { recurringFee: true },
        orderBy: [{ currencyCode: "asc" }, { billingCycle: "asc" }],
      }),
    ]);
    const companyCurrency = new Map(input.references.map((company) => [company.id, company.baseCurrencyCode]));
    for (const account of accountCurrencies) {
      companyCurrency.set(account.companyId.toString(), account.currencyCode);
      currencyAggregate(account.currencyCode);
    }
    for (const row of recurringRows) {
      currencyAggregate(row.currencyCode).recurring.push({
        billingCycle: row.billingCycle,
        recurringFee: row._sum.recurringFee ?? decimal(0),
      });
    }
    const companies = new Map<string, PlatformBillingCompanyAggregate>();
    for (const company of input.references) {
      companies.set(company.id, {
        currencyCode: companyCurrency.get(company.id) ?? company.baseCurrencyCode,
        billed: decimal(0), collected: decimal(0), outstanding: decimal(0), overdue: decimal(0),
      });
    }
    const today = new Date(`${dateOnly(input.now)}T00:00:00.000Z`);
    const dueSoonCutoff = addDays(today, 8);
    let overdueInvoices = 0;
    let dueSoonInvoices = 0;
    let invoiceCursor: bigint | undefined;
    while (true) {
      const invoices = await this.prisma.platformBillingInvoice.findMany({
        where: { ...companyWhere, state: "ISSUED" },
        select: {
          id: true, companyId: true, currencyCode: true,
          issueDate: true, dueDate: true, totalAmount: true,
        },
        orderBy: { id: "asc" },
        take: PLATFORM_ANALYTICS_BILLING_BATCH_SIZE,
        ...(invoiceCursor === undefined ? {} : { cursor: { id: invoiceCursor }, skip: 1 }),
      });
      if (!invoices.length) break;
      const invoiceIds = invoices.map((invoice) => invoice.id);
      const [paymentTotals, succeededRefunds] = await Promise.all([
        this.prisma.platformBillingPayment.groupBy({
          by: ["invoiceId"],
          where: { invoiceId: { in: invoiceIds } },
          _sum: { amount: true },
        }),
        this.prisma.platformBillingRefund.findMany({
          where: { state: "SUCCEEDED", payment: { invoiceId: { in: invoiceIds } } },
          select: { amount: true, payment: { select: { invoiceId: true } } },
        }),
      ]);
      const paidByInvoice = new Map(paymentTotals.map((row) => [row.invoiceId.toString(), decimal(row._sum.amount ?? 0)]));
      for (const refund of succeededRefunds) {
        const key = refund.payment.invoiceId.toString();
        paidByInvoice.set(key, (paidByInvoice.get(key) ?? decimal(0)).minus(refund.amount));
      }
      for (const invoice of invoices) {
        const aggregate = currencyAggregate(invoice.currencyCode);
        const company = companies.get(invoice.companyId.toString());
        const companyMatchesCurrency = company?.currencyCode === invoice.currencyCode;
        if (within(invoice.issueDate, input.from, input.toExclusive)) {
          aggregate.billed = aggregate.billed.plus(invoice.totalAmount);
          aggregate.invoiceCount += 1;
          if (companyMatchesCurrency) company.billed = company.billed.plus(invoice.totalAmount);
        }
        if (input.comparisonFrom && input.comparisonToExclusive
          && within(invoice.issueDate, input.comparisonFrom, input.comparisonToExclusive)) {
          aggregate.priorBilled = aggregate.priorBilled.plus(invoice.totalAmount);
          aggregate.priorInvoiceCount += 1;
        }
        const currentBucketIndex = input.currentBuckets.findIndex((bucket) =>
          within(invoice.issueDate, bucket.from, bucket.toExclusive));
        if (currentBucketIndex >= 0) {
          aggregate.currentTimeline[currentBucketIndex]!.billed =
            aggregate.currentTimeline[currentBucketIndex]!.billed.plus(invoice.totalAmount);
        }
        const previousBucketIndex = input.previousBuckets?.findIndex((bucket) =>
          within(invoice.issueDate, bucket.from, bucket.toExclusive)) ?? -1;
        if (previousBucketIndex >= 0 && aggregate.previousTimeline) {
          aggregate.previousTimeline[previousBucketIndex]!.billed =
            aggregate.previousTimeline[previousBucketIndex]!.billed.plus(invoice.totalAmount);
        }
        const rawPaid = paidByInvoice.get(invoice.id.toString()) ?? decimal(0);
        const paid = rawPaid.gt(0) ? rawPaid : decimal(0);
        const difference = decimal(invoice.totalAmount).minus(paid);
        const balance = difference.gt(0) ? difference : decimal(0);
        if (balance.eq(0)) continue;
        aggregate.outstanding = aggregate.outstanding.plus(balance);
        if (companyMatchesCurrency) company.outstanding = company.outstanding.plus(balance);
        if (invoice.dueDate >= today) {
          aggregate.aging.notDue = aggregate.aging.notDue.plus(balance);
          if (invoice.dueDate < dueSoonCutoff) dueSoonInvoices += 1;
          continue;
        }
        overdueInvoices += 1;
        aggregate.overdue = aggregate.overdue.plus(balance);
        if (companyMatchesCurrency) company.overdue = company.overdue.plus(balance);
        const age = (today.getTime() - invoice.dueDate.getTime()) / dayMilliseconds;
        if (age <= 30) aggregate.aging.days1To30 = aggregate.aging.days1To30.plus(balance);
        else if (age <= 60) aggregate.aging.days31To60 = aggregate.aging.days31To60.plus(balance);
        else aggregate.aging.days61Plus = aggregate.aging.days61Plus.plus(balance);
      }
      if (invoices.length < PLATFORM_ANALYTICS_BILLING_BATCH_SIZE) break;
      invoiceCursor = invoices.at(-1)!.id;
    }

    const paymentStarts = [input.from, input.comparisonFrom].filter((value): value is Date => value !== null);
    const paymentEnds = [input.toExclusive, input.comparisonToExclusive].filter((value): value is Date => value !== null);
    const paymentFrom = new Date(Math.min(...paymentStarts.map((value) => value.getTime())));
    const paymentToExclusive = new Date(Math.max(...paymentEnds.map((value) => value.getTime())));
    let paymentCursor: bigint | undefined;
    while (true) {
      const payments = await this.prisma.platformBillingPayment.findMany({
        where: {
          ...companyWhere,
          paymentDate: { gte: paymentFrom, lt: paymentToExclusive },
          invoice: { state: "ISSUED" },
        },
        select: {
          id: true, companyId: true, paymentDate: true, amount: true,
          invoice: { select: { currencyCode: true } },
        },
        orderBy: { id: "asc" },
        take: PLATFORM_ANALYTICS_BILLING_BATCH_SIZE,
        ...(paymentCursor === undefined ? {} : { cursor: { id: paymentCursor }, skip: 1 }),
      });
      if (!payments.length) break;
      for (const payment of payments) {
        const aggregate = currencyAggregate(payment.invoice.currencyCode);
        const company = companies.get(payment.companyId.toString());
        const companyMatchesCurrency = company?.currencyCode === payment.invoice.currencyCode;
        if (within(payment.paymentDate, input.from, input.toExclusive)) {
          aggregate.collected = aggregate.collected.plus(payment.amount);
          if (companyMatchesCurrency) company.collected = company.collected.plus(payment.amount);
        }
        if (input.comparisonFrom && input.comparisonToExclusive
          && within(payment.paymentDate, input.comparisonFrom, input.comparisonToExclusive)) {
          aggregate.priorCollected = aggregate.priorCollected.plus(payment.amount);
        }
        const currentBucketIndex = input.currentBuckets.findIndex((bucket) =>
          within(payment.paymentDate, bucket.from, bucket.toExclusive));
        if (currentBucketIndex >= 0) {
          aggregate.currentTimeline[currentBucketIndex]!.collected =
            aggregate.currentTimeline[currentBucketIndex]!.collected.plus(payment.amount);
        }
        const previousBucketIndex = input.previousBuckets?.findIndex((bucket) =>
          within(payment.paymentDate, bucket.from, bucket.toExclusive)) ?? -1;
        if (previousBucketIndex >= 0 && aggregate.previousTimeline) {
          aggregate.previousTimeline[previousBucketIndex]!.collected =
            aggregate.previousTimeline[previousBucketIndex]!.collected.plus(payment.amount);
        }
      }
      if (payments.length < PLATFORM_ANALYTICS_BILLING_BATCH_SIZE) break;
      paymentCursor = payments.at(-1)!.id;
    }

    let refundCursor: bigint | undefined;
    while (true) {
      const refunds = await this.prisma.platformBillingRefund.findMany({
        where: {
          ...companyWhere,
          state: "SUCCEEDED",
          completedAt: { gte: paymentFrom, lt: paymentToExclusive },
          payment: { invoice: { state: "ISSUED" } },
        },
        select: {
          id: true, companyId: true, completedAt: true, amount: true,
          payment: { select: { invoice: { select: { currencyCode: true } } } },
        },
        orderBy: { id: "asc" },
        take: PLATFORM_ANALYTICS_BILLING_BATCH_SIZE,
        ...(refundCursor === undefined ? {} : { cursor: { id: refundCursor }, skip: 1 }),
      });
      if (!refunds.length) break;
      for (const refund of refunds) {
        if (!refund.completedAt) continue;
        const currencyCode = refund.payment.invoice.currencyCode;
        const aggregate = currencyAggregate(currencyCode);
        const company = companies.get(refund.companyId.toString());
        const companyMatchesCurrency = company?.currencyCode === currencyCode;
        if (within(refund.completedAt, input.from, input.toExclusive)) {
          aggregate.collected = aggregate.collected.minus(refund.amount);
          if (companyMatchesCurrency) company.collected = company.collected.minus(refund.amount);
        }
        if (input.comparisonFrom && input.comparisonToExclusive
          && within(refund.completedAt, input.comparisonFrom, input.comparisonToExclusive)) {
          aggregate.priorCollected = aggregate.priorCollected.minus(refund.amount);
        }
        const currentBucketIndex = input.currentBuckets.findIndex((bucket) =>
          within(refund.completedAt!, bucket.from, bucket.toExclusive));
        if (currentBucketIndex >= 0) {
          aggregate.currentTimeline[currentBucketIndex]!.collected =
            aggregate.currentTimeline[currentBucketIndex]!.collected.minus(refund.amount);
        }
        const previousBucketIndex = input.previousBuckets?.findIndex((bucket) =>
          within(refund.completedAt!, bucket.from, bucket.toExclusive)) ?? -1;
        if (previousBucketIndex >= 0 && aggregate.previousTimeline) {
          aggregate.previousTimeline[previousBucketIndex]!.collected =
            aggregate.previousTimeline[previousBucketIndex]!.collected.minus(refund.amount);
        }
      }
      if (refunds.length < PLATFORM_ANALYTICS_BILLING_BATCH_SIZE) break;
      refundCursor = refunds.at(-1)!.id;
    }

    const financials = [...currencyAggregates.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([currencyCode, aggregate]) => {
        const priorBilled = input.comparisonFrom ? aggregate.priorBilled : null;
        const priorCollected = input.comparisonFrom ? aggregate.priorCollected : null;
        const rate = aggregate.billed.gt(0)
          ? aggregate.collected.div(aggregate.billed).mul(100).toDecimalPlaces(1).toNumber()
          : 0;
        const priorRate = priorBilled && priorCollected && priorBilled.gt(0)
          ? priorCollected.div(priorBilled).mul(100).toDecimalPlaces(1).toNumber()
          : priorBilled === null ? null : 0;
        return {
          currencyCode,
          recurringMonthly: calculatePlatformRecurringMonthly(aggregate.recurring).toFixed(4),
          billed: comparedMoney(aggregate.billed, priorBilled),
          collected: comparedMoney(aggregate.collected, priorCollected),
          collectionRate: comparedNumber(rate, priorRate),
          outstanding: fixed(aggregate.outstanding),
          overdue: fixed(aggregate.overdue),
          invoiceCount: comparedNumber(
            aggregate.invoiceCount,
            input.comparisonFrom ? aggregate.priorInvoiceCount : null,
          ),
          timeline: input.currentBuckets.map((bucket, index) => ({
            key: dateOnly(bucket.from), from: dateOnly(bucket.from), to: dateOnly(addDays(bucket.toExclusive, -1)),
            billed: fixed(aggregate.currentTimeline[index]!.billed),
            previousBilled: aggregate.previousTimeline ? fixed(aggregate.previousTimeline[index]!.billed) : null,
            collected: fixed(aggregate.currentTimeline[index]!.collected),
            previousCollected: aggregate.previousTimeline ? fixed(aggregate.previousTimeline[index]!.collected) : null,
          })),
          aging: {
            notDue: fixed(aggregate.aging.notDue),
            days1To30: fixed(aggregate.aging.days1To30),
            days31To60: fixed(aggregate.aging.days31To60),
            days61Plus: fixed(aggregate.aging.days61Plus),
          },
        };
      });
    return { financials, companies, overdueInvoices, dueSoonInvoices };
  }

  async overview(input: { now: Date; days: 7 | 30 | 90 }): Promise<PlatformOverview> {
    const startsAt = new Date(input.now.getTime() - input.days * 86_400_000);
    const activeSessionSince = new Date(input.now.getTime() - 30 * 60_000);

    const [
      totalCompanies,
      activeCompanies,
      newCompanies,
      totalEmployees,
      activeEmployees,
      linkedEmployees,
      totalUsers,
      activeUsers,
      activeSessions,
      systemOperations,
      financialDocuments,
      postedDocuments,
      securityAlerts,
      pendingOutbox,
      failedOutbox,
      activityByCompany,
      modulePairs,
      trends,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { isActive: true } }),
      this.prisma.company.count({ where: { createdAt: { gte: startsAt, lte: input.now } } }),
      this.prisma.employee.count(),
      this.prisma.employee.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
      this.prisma.employee.count({ where: { userId: { not: null } } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.session.count({
        where: {
          state: "AUTHENTICATED",
          revokedAt: null,
          expiresAt: { gt: input.now },
          lastSeenAt: { gte: activeSessionSince },
        },
      }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: startsAt, lte: input.now } } }),
      this.prisma.accountingDocument.count({ where: { createdAt: { gte: startsAt, lte: input.now } } }),
      this.prisma.accountingDocument.count({
        where: { createdAt: { gte: startsAt, lte: input.now }, status: "POSTED" },
      }),
      this.prisma.securityEvent.count({
        where: {
          createdAt: { gte: startsAt, lte: input.now },
          severity: { in: ["HIGH", "CRITICAL"] },
        },
      }),
      this.prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      this.prisma.outboxEvent.count({ where: { status: "FAILED" } }),
      this.prisma.auditLog.groupBy({
        by: ["companyId"],
        where: { createdAt: { gte: startsAt, lte: input.now } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.modulePairs(startsAt, input.now),
      Promise.all(monthBuckets(input.now, 6).map(async (bucket) => {
        const [companies, operations] = await Promise.all([
          this.prisma.company.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
          this.prisma.auditLog.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
        ]);
        return { month: bucket.month, newCompanies: companies, operations };
      })),
    ]);

    const rankedActivity = activityByCompany
      .map((item) => ({
        companyId: item.companyId,
        operations: item._count._all,
        lastActivityAt: item._max.createdAt,
      }))
      .filter((item): item is typeof item & { lastActivityAt: Date } => item.lastActivityAt !== null)
      .sort((left, right) => right.operations - left.operations)
      .slice(0, 5);
    const companyNames = await this.prisma.company.findMany({
      where: { id: { in: rankedActivity.map((item) => item.companyId) } },
      select: { id: true, name: true },
    });
    const names = new Map(companyNames.map((company) => [company.id.toString(), company.name]));

    return {
      generatedAt: input.now.toISOString(),
      window: { days: input.days, startsAt: startsAt.toISOString(), endsAt: input.now.toISOString() },
      metrics: {
        totalCompanies,
        activeCompanies,
        newCompanies,
        totalEmployees,
        activeEmployees,
        linkedEmployees,
        totalUsers,
        activeUsers,
        activeSessions,
        systemOperations,
        financialDocuments,
        postedDocuments,
        securityAlerts,
      },
      health: {
        pendingOutbox,
        failedOutbox,
        unacknowledgedSecurityAlerts: await this.prisma.securityEvent.count({
          where: { acknowledgedAt: null, severity: { in: ["HIGH", "CRITICAL"] } },
        }),
        activeCompaniesInWindow: activityByCompany.length,
        employeeAccountCoverage: percentage(linkedEmployees, totalEmployees),
        companyAdoptionRate: percentage(activityByCompany.length, activeCompanies),
      },
      trends,
      modules: modulePairs,
      topCompanies: rankedActivity.map((item) => ({
        id: item.companyId.toString(),
        name: names.get(item.companyId.toString()) ?? "—",
        operations: item.operations,
        lastActivityAt: item.lastActivityAt.toISOString(),
      })),
    };
  }

  async listCompanies(input: {
    now: Date;
    days: 7 | 30 | 90;
    search?: string | undefined;
    status?: "ALL" | "ACTIVE" | "INACTIVE" | undefined;
    page: number;
    pageSize: number;
  }) {
    const startsAt = new Date(input.now.getTime() - input.days * 86_400_000);
    const search = input.search?.trim();
    const where = {
      ...(input.status === "ACTIVE" ? { isActive: true } : {}),
      ...(input.status === "INACTIVE" ? { isActive: false } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search } },
          { code: { contains: search } },
          { organization: { is: { name: { contains: search } } } },
        ],
      } : {}),
    };
    const [total, companies] = await Promise.all([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          baseCurrency: { select: { code: true } },
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    const ids = companies.map((company) => company.id);
    const [users, employees, operations, documents] = ids.length
      ? await Promise.all([
        this.prisma.userCompany.groupBy({
          by: ["companyId"], where: { companyId: { in: ids }, isActive: true, user: { isActive: true } }, _count: { _all: true },
        }),
        this.prisma.employee.groupBy({
          by: ["companyId"], where: { companyId: { in: ids }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, _count: { _all: true },
        }),
        this.prisma.auditLog.groupBy({
          by: ["companyId"], where: { companyId: { in: ids }, createdAt: { gte: startsAt, lte: input.now } },
          _count: { _all: true }, _max: { createdAt: true },
        }),
        this.prisma.accountingDocument.groupBy({
          by: ["companyId"], where: { companyId: { in: ids }, postedAt: { gte: startsAt, lte: input.now } }, _count: { _all: true },
        }),
      ])
      : [[], [], [], []];
    const countMap = <T extends { companyId: bigint; _count: { _all: number } }>(rows: T[]) =>
      new Map(rows.map((row) => [row.companyId.toString(), row._count._all]));
    const userCounts = countMap(users);
    const employeeCounts = countMap(employees);
    const operationCounts = countMap(operations);
    const documentCounts = countMap(documents);
    const activityDates = new Map(operations.map((row) => [row.companyId.toString(), row._max.createdAt]));
    return {
      data: companies.map((company): PlatformCompanySummary => ({
        id: company.id.toString(),
        code: company.code,
        name: company.name,
        organizationName: company.organization.name,
        baseCurrencyCode: company.baseCurrency.code,
        timezone: company.timezone,
        isActive: company.isActive,
        createdAt: company.createdAt.toISOString(),
        activeUsers: userCounts.get(company.id.toString()) ?? 0,
        activeEmployees: employeeCounts.get(company.id.toString()) ?? 0,
        operations: operationCounts.get(company.id.toString()) ?? 0,
        postedDocuments: documentCounts.get(company.id.toString()) ?? 0,
        lastActivityAt: activityDates.get(company.id.toString())?.toISOString() ?? null,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async companyDetails(input: {
    companyId: bigint;
    now: Date;
    days: 7 | 30 | 90;
  }): Promise<PlatformCompanyDetails | null> {
    const startsAt = new Date(input.now.getTime() - input.days * 86_400_000);
    const company = await this.prisma.company.findUnique({
      where: { id: input.companyId },
      include: {
        organization: { select: { name: true } },
        baseCurrency: { select: { code: true } },
      },
    });
    if (!company) return null;
    const recent = { gte: startsAt, lte: input.now };
    const activeSessionSince = new Date(input.now.getTime() - 30 * 60_000);
    const [
      totalUsers, activeUsers, totalEmployees, activeEmployees, linkedEmployees, activeSessions,
      totalDocuments, financialDocuments, postedDocuments, operations, securityAlerts,
      lastActivity, modules, documentsByType, trends,
    ] = await Promise.all([
      this.prisma.userCompany.count({ where: { companyId: input.companyId } }),
      this.prisma.userCompany.count({ where: { companyId: input.companyId, isActive: true, user: { isActive: true } } }),
      this.prisma.employee.count({ where: { companyId: input.companyId } }),
      this.prisma.employee.count({ where: { companyId: input.companyId, status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
      this.prisma.employee.count({ where: { companyId: input.companyId, userId: { not: null } } }),
      this.prisma.session.count({ where: {
        selectedCompanyId: input.companyId, state: "AUTHENTICATED", revokedAt: null,
        expiresAt: { gt: input.now }, lastSeenAt: { gte: activeSessionSince },
      } }),
      this.prisma.accountingDocument.count({ where: { companyId: input.companyId } }),
      this.prisma.accountingDocument.count({ where: { companyId: input.companyId, createdAt: recent } }),
      this.prisma.accountingDocument.count({ where: { companyId: input.companyId, postedAt: recent } }),
      this.prisma.auditLog.count({ where: { companyId: input.companyId, createdAt: recent } }),
      this.prisma.securityEvent.count({ where: {
        companyId: input.companyId, createdAt: recent, severity: { in: ["HIGH", "CRITICAL"] },
      } }),
      this.prisma.auditLog.findFirst({
        where: { companyId: input.companyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true },
      }),
      this.modulePairs(startsAt, input.now, input.companyId),
      this.prisma.accountingDocument.groupBy({
        by: ["documentType", "status"], where: { companyId: input.companyId, createdAt: recent }, _count: { _all: true },
      }),
      Promise.all(monthBuckets(input.now, 6).map(async (bucket) => {
        const [monthOperations, monthPosted] = await Promise.all([
          this.prisma.auditLog.count({ where: { companyId: input.companyId, createdAt: { gte: bucket.start, lt: bucket.end } } }),
          this.prisma.accountingDocument.count({ where: { companyId: input.companyId, postedAt: { gte: bucket.start, lt: bucket.end } } }),
        ]);
        return { month: bucket.month, operations: monthOperations, postedDocuments: monthPosted };
      })),
    ]);
    const typeMap = new Map<string, { type: string; total: number; posted: number }>();
    for (const row of documentsByType) {
      const key = String(row.documentType);
      const value = typeMap.get(key) ?? { type: key, total: 0, posted: 0 };
      value.total += row._count._all;
      if (row.status === "POSTED") value.posted += row._count._all;
      typeMap.set(key, value);
    }
    return {
      id: company.id.toString(), code: company.code, name: company.name,
      organizationName: company.organization.name, baseCurrencyCode: company.baseCurrency.code,
      timezone: company.timezone, isActive: company.isActive, createdAt: company.createdAt.toISOString(),
      activeUsers, activeEmployees, operations, postedDocuments,
      lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
      metrics: {
        totalUsers, activeUsers, totalEmployees, activeEmployees, linkedEmployees, activeSessions,
        totalDocuments, financialDocuments, postedDocuments, operations, securityAlerts,
      },
      trends, modules, documentsByType: [...typeMap.values()].sort((a, b) => b.total - a.total),
    };
  }

  async companyUsage(input: {
    companyId: bigint;
    periodStart: Date;
    periodEndExclusive: Date;
  }): Promise<PlatformCompanyUsage | null> {
    if (!await this.prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return null;
    const range = { gte: input.periodStart, lt: input.periodEndExclusive };
    const [users, employees, postedDocuments, operations] = await Promise.all([
      this.prisma.userCompany.count({ where: { companyId: input.companyId, isActive: true, user: { isActive: true } } }),
      this.prisma.employee.count({ where: { companyId: input.companyId, status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
      this.prisma.accountingDocument.count({ where: { companyId: input.companyId, postedAt: range } }),
      this.prisma.auditLog.count({ where: { companyId: input.companyId, createdAt: range } }),
    ]);
    return { users, employees, postedDocuments, operations };
  }

  companyCount(): Promise<number> {
    return this.prisma.company.count();
  }

  async companyReferences(companyIds?: bigint[]): Promise<PlatformCompanyReference[]> {
    return (await this.prisma.company.findMany({
      ...(companyIds ? { where: { id: { in: companyIds } } } : {}),
      select: { id: true, name: true, isActive: true, baseCurrency: { select: { code: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    })).map((company) => ({
      id: company.id.toString(), name: company.name, isActive: company.isActive,
      baseCurrencyCode: company.baseCurrency.code,
    }));
  }

  private async modulePairs(startsAt: Date, endsAt: Date, companyId?: bigint): Promise<PlatformModuleActivity[]> {
    const recent = { gte: startsAt, lt: endsAt };
    const company = companyId === undefined ? {} : { companyId };
    const pairs = await Promise.all<CountPair>([
      Promise.all([
        this.prisma.salesInvoice.count({ where: company }),
        this.prisma.salesInvoice.count({ where: { ...company, accountingDocument: { createdAt: recent } } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.purchaseInvoice.count({ where: company }),
        this.prisma.purchaseInvoice.count({ where: { ...company, accountingDocument: { createdAt: recent } } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.receipt.count({ where: company }).then(async (receipts) => receipts + await this.prisma.payment.count({ where: company })),
        Promise.all([
          this.prisma.receipt.count({ where: { ...company, accountingDocument: { createdAt: recent } } }),
          this.prisma.payment.count({ where: { ...company, accountingDocument: { createdAt: recent } } }),
        ]).then(([receipts, payments]) => receipts + payments),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.posSale.count({ where: company }),
        this.prisma.posSale.count({ where: { ...company, completedAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.inventoryMovement.count({ where: company }),
        this.prisma.inventoryMovement.count({ where: { ...company, createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.professionalProject.count({ where: company }),
        this.prisma.professionalProject.count({ where: { ...company, createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.employee.count({ where: company }),
        this.prisma.employee.count({ where: { ...company, createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.approvalRequest.count({ where: company }),
        this.prisma.approvalRequest.count({ where: { ...company, createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.dataImportBatch.count({ where: company }),
        this.prisma.dataImportBatch.count({ where: { ...company, createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
    ]);
    const codes: PlatformModuleActivity["code"][] = [
      "SALES", "PURCHASES", "TREASURY", "POS", "INVENTORY", "PROJECTS", "HR", "APPROVALS", "IMPORTS",
    ];
    return pairs.map((pair, index) => ({ code: codes[index]!, ...pair }));
  }
}
