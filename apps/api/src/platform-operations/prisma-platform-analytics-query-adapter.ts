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

type CountPair = { total: number; recent: number };

const percentage = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

const dayMilliseconds = 86_400_000;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * dayMilliseconds);
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
const decimalSum = (values: Prisma.Decimal[]) => values.reduce((sum, value) => sum.plus(value), decimal(0));
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
      accounts,
      invoices,
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
      this.prisma.platformBillingAccount.findMany({
        where: companyWhere,
        orderBy: [{ currencyCode: "asc" }, { companyId: "asc" }],
      }),
      this.prisma.platformBillingInvoice.findMany({
        where: { ...companyWhere, state: "ISSUED" },
        select: {
          companyId: true, currencyCode: true, issueDate: true, dueDate: true, totalAmount: true,
          payments: { select: { paymentDate: true, amount: true } },
        },
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
    const today = new Date(`${dateOnly(input.now)}T00:00:00.000Z`);
    const dueSoonCutoff = addDays(today, 8);
    const balanceOf = (invoice: (typeof invoices)[number]) => Prisma.Decimal.max(
      decimal(0),
      invoice.totalAmount.minus(decimalSum(invoice.payments.map((payment) => payment.amount))),
    );
    const currencyCodes = [...new Set([
      ...accounts.map((account) => account.currencyCode),
      ...invoices.map((invoice) => invoice.currencyCode),
    ])].sort();

    const financials = currencyCodes.map((currencyCode) => {
      const currencyInvoices = invoices.filter((invoice) => invoice.currencyCode === currencyCode);
      const currentInvoices = currencyInvoices.filter((invoice) => within(invoice.issueDate, input.from, input.toExclusive));
      const priorInvoices = input.comparisonFrom && input.comparisonToExclusive
        ? currencyInvoices.filter((invoice) => within(invoice.issueDate, input.comparisonFrom!, input.comparisonToExclusive!))
        : null;
      const paymentsIn = (from: Date, toExclusive: Date) => currencyInvoices.flatMap((invoice) =>
        invoice.payments.filter((payment) => within(payment.paymentDate, from, toExclusive)).map((payment) => payment.amount));
      const billed = decimalSum(currentInvoices.map((invoice) => invoice.totalAmount));
      const priorBilled = priorInvoices === null ? null : decimalSum(priorInvoices.map((invoice) => invoice.totalAmount));
      const collected = decimalSum(paymentsIn(input.from, input.toExclusive));
      const priorCollected = input.comparisonFrom && input.comparisonToExclusive
        ? decimalSum(paymentsIn(input.comparisonFrom, input.comparisonToExclusive))
        : null;
      const balances = currencyInvoices.map((invoice) => ({ invoice, balance: balanceOf(invoice) }))
        .filter((item) => item.balance.gt(0));
      const overdue = balances.filter((item) => item.invoice.dueDate < today);
      const aging = {
        notDue: decimalSum(balances.filter((item) => item.invoice.dueDate >= today).map((item) => item.balance)),
        days1To30: decimalSum(overdue.filter((item) => (today.getTime() - item.invoice.dueDate.getTime()) / dayMilliseconds <= 30).map((item) => item.balance)),
        days31To60: decimalSum(overdue.filter((item) => {
          const age = (today.getTime() - item.invoice.dueDate.getTime()) / dayMilliseconds;
          return age > 30 && age <= 60;
        }).map((item) => item.balance)),
        days61Plus: decimalSum(overdue.filter((item) => (today.getTime() - item.invoice.dueDate.getTime()) / dayMilliseconds > 60).map((item) => item.balance)),
      };
      const rate = billed.gt(0) ? collected.div(billed).mul(100).toDecimalPlaces(1).toNumber() : 0;
      const priorRate = priorBilled && priorCollected && priorBilled.gt(0)
        ? priorCollected.div(priorBilled).mul(100).toDecimalPlaces(1).toNumber()
        : priorBilled === null ? null : 0;
      const recurringMonthly = accounts
        .filter((account) => account.currencyCode === currencyCode && ["TRIAL", "ACTIVE"].includes(account.status))
        .reduce((sum, account) => sum.plus(
          account.billingCycle === "MONTHLY" ? account.recurringFee
            : account.billingCycle === "QUARTERLY" ? account.recurringFee.div(3)
              : account.recurringFee.div(12),
        ), decimal(0));
      return {
        currencyCode,
        recurringMonthly: fixed(recurringMonthly),
        billed: comparedMoney(billed, priorBilled),
        collected: comparedMoney(collected, priorCollected),
        collectionRate: comparedNumber(rate, priorRate),
        outstanding: fixed(decimalSum(balances.map((item) => item.balance))),
        overdue: fixed(decimalSum(overdue.map((item) => item.balance))),
        invoiceCount: comparedNumber(currentInvoices.length, priorInvoices?.length ?? null),
        timeline: currentBuckets.map((bucket, index) => {
          const previousBucket = previousBuckets?.[index] ?? null;
          const currentBucketInvoices = currencyInvoices.filter((invoice) => within(invoice.issueDate, bucket.from, bucket.toExclusive));
          const previousBucketInvoices = previousBucket
            ? currencyInvoices.filter((invoice) => within(invoice.issueDate, previousBucket.from, previousBucket.toExclusive))
            : null;
          return {
            key: dateOnly(bucket.from), from: dateOnly(bucket.from), to: dateOnly(addDays(bucket.toExclusive, -1)),
            billed: fixed(decimalSum(currentBucketInvoices.map((invoice) => invoice.totalAmount))),
            previousBilled: previousBucketInvoices === null ? null : fixed(decimalSum(previousBucketInvoices.map((invoice) => invoice.totalAmount))),
            collected: fixed(decimalSum(paymentsIn(bucket.from, bucket.toExclusive))),
            previousCollected: previousBucket === null ? null : fixed(decimalSum(paymentsIn(previousBucket.from, previousBucket.toExclusive))),
          };
        }),
        aging: {
          notDue: fixed(aging.notDue), days1To30: fixed(aging.days1To30),
          days31To60: fixed(aging.days31To60), days61Plus: fixed(aging.days61Plus),
        },
      };
    });

    const activityByCompany = new Map(currentSnapshot.activity.map((row) => [row.companyId.toString(), row]));
    const documentsByCompany = new Map(currentSnapshot.documents.map((row) => [row.companyId.toString(), row._count._all]));
    const accountByCompany = new Map(accounts.map((account) => [account.companyId.toString(), account]));
    const references = scopedCompany ? [scopedCompany] : companyOptions;
    const companies = references.map((company) => {
      const companyInvoices = invoices.filter((invoice) => invoice.companyId.toString() === company.id);
      const account = accountByCompany.get(company.id);
      const currencyCode = account?.currencyCode ?? company.baseCurrencyCode;
      const currencyInvoices = companyInvoices.filter((invoice) => invoice.currencyCode === currencyCode);
      const currentInvoices = currencyInvoices.filter((invoice) => within(invoice.issueDate, input.from, input.toExclusive));
      const collected = decimalSum(currencyInvoices.flatMap((invoice) => invoice.payments
        .filter((payment) => within(payment.paymentDate, input.from, input.toExclusive))
        .map((payment) => payment.amount)));
      const open = currencyInvoices.map((invoice) => ({ invoice, balance: balanceOf(invoice) })).filter((item) => item.balance.gt(0));
      const activity = activityByCompany.get(company.id);
      return {
        id: company.id, name: company.name, currencyCode,
        operations: activity?._count._all ?? 0,
        postedDocuments: documentsByCompany.get(company.id) ?? 0,
        billed: fixed(decimalSum(currentInvoices.map((invoice) => invoice.totalAmount))),
        collected: fixed(collected),
        outstanding: fixed(decimalSum(open.map((item) => item.balance))),
        overdue: fixed(decimalSum(open.filter((item) => item.invoice.dueDate < today).map((item) => item.balance))),
        lastActivityAt: activity?._max.createdAt?.toISOString() ?? null,
      };
    }).sort((left, right) =>
      right.operations - left.operations
      || decimal(right.billed).comparedTo(decimal(left.billed))
      || left.name.localeCompare(right.name, "ar"),
    ).slice(0, 12);

    const openInvoices = invoices.map((invoice) => ({ invoice, balance: balanceOf(invoice) })).filter((item) => item.balance.gt(0));
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
      financials,
      modules: currentModules.map((module, index) => ({
        code: module.code,
        current: module.recent,
        previous: previousModules?.[index]?.recent ?? null,
        changePercent: changePercent(module.recent, previousModules?.[index]?.recent ?? null),
      })),
      companies,
      alerts: {
        overdueInvoices: openInvoices.filter((item) => item.invoice.dueDate < today).length,
        dueSoonInvoices: openInvoices.filter((item) => item.invoice.dueDate >= today && item.invoice.dueDate < dueSoonCutoff).length,
        unacknowledgedSecurity,
        pendingOutbox,
        failedOutbox,
        staleCompanies: [...activeReferenceIds].filter((id) => !activityByCompany.has(id)).length,
      },
    };
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
          by: ["companyId"], where: { companyId: { in: ids }, isActive: true }, _count: { _all: true },
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
      this.prisma.userCompany.count({ where: { companyId: input.companyId, isActive: true } }),
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
      this.prisma.userCompany.count({ where: { companyId: input.companyId, isActive: true } }),
      this.prisma.employee.count({ where: { companyId: input.companyId, status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
      this.prisma.accountingDocument.count({ where: { companyId: input.companyId, postedAt: range } }),
      this.prisma.auditLog.count({ where: { companyId: input.companyId, createdAt: range } }),
    ]);
    return { users, employees, postedDocuments, operations };
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
