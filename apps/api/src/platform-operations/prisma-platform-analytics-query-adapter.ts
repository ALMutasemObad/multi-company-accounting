import type { PrismaClient } from "@prisma/client";
import type {
  PlatformAnalyticsQueryPort,
  PlatformModuleActivity,
  PlatformOverview,
} from "./platform-operations-ports.js";

type CountPair = { total: number; recent: number };

const percentage = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

const monthBuckets = (now: Date, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { month: start.toISOString().slice(0, 7), start, end };
  });

export class PrismaPlatformAnalyticsQueryAdapter implements PlatformAnalyticsQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

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

  private async modulePairs(startsAt: Date, endsAt: Date): Promise<PlatformModuleActivity[]> {
    const recent = { gte: startsAt, lte: endsAt };
    const pairs = await Promise.all<CountPair>([
      Promise.all([
        this.prisma.salesInvoice.count(),
        this.prisma.salesInvoice.count({ where: { accountingDocument: { createdAt: recent } } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.purchaseInvoice.count(),
        this.prisma.purchaseInvoice.count({ where: { accountingDocument: { createdAt: recent } } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.receipt.count().then(async (receipts) => receipts + await this.prisma.payment.count()),
        Promise.all([
          this.prisma.receipt.count({ where: { accountingDocument: { createdAt: recent } } }),
          this.prisma.payment.count({ where: { accountingDocument: { createdAt: recent } } }),
        ]).then(([receipts, payments]) => receipts + payments),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.posSale.count(),
        this.prisma.posSale.count({ where: { completedAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.inventoryMovement.count(),
        this.prisma.inventoryMovement.count({ where: { createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.professionalProject.count(),
        this.prisma.professionalProject.count({ where: { createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.employee.count(),
        this.prisma.employee.count({ where: { createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.approvalRequest.count(),
        this.prisma.approvalRequest.count({ where: { createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
      Promise.all([
        this.prisma.dataImportBatch.count(),
        this.prisma.dataImportBatch.count({ where: { createdAt: recent } }),
      ]).then(([total, count]) => ({ total, recent: count })),
    ]);
    const codes: PlatformModuleActivity["code"][] = [
      "SALES", "PURCHASES", "TREASURY", "POS", "INVENTORY", "PROJECTS", "HR", "APPROVALS", "IMPORTS",
    ];
    return pairs.map((pair, index) => ({ code: codes[index]!, ...pair }));
  }
}
