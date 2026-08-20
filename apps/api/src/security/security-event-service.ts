import type { Prisma, PrismaClient, SecuritySeverity } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";

export type SecurityEventQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  eventType?: string | undefined;
  severity?: SecuritySeverity | undefined;
  userId?: bigint | undefined;
  unacknowledgedOnly?: boolean | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nextDay = (value: string) => new Date(startOfDay(value).getTime() + 86_400_000);

export class SecurityEventService {
  constructor(private readonly prisma: PrismaClient) {}

  private where(context: ActorContext, query: Omit<SecurityEventQuery, "page" | "pageSize">): Prisma.SecurityEventWhereInput {
    return {
      companyId: context.companyId,
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(!query.unacknowledgedOnly && query.severity ? { severity: query.severity } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.unacknowledgedOnly ? { severity: query.severity && ["HIGH", "CRITICAL"].includes(query.severity) ? query.severity : { in: ["HIGH", "CRITICAL"] }, acknowledgedAt: null } : {}),
      ...(query.dateFrom || query.dateTo ? { createdAt: { ...(query.dateFrom ? { gte: startOfDay(query.dateFrom) } : {}), ...(query.dateTo ? { lt: nextDay(query.dateTo) } : {}) } } : {}),
      ...(query.search ? { OR: [
        { eventType: { contains: query.search } },
        { emailSnapshot: { contains: query.search } },
        { ipAddress: { contains: query.search } },
        { user: { displayName: { contains: query.search } } },
      ] } : {}),
    };
  }

  async list(context: ActorContext, query: SecurityEventQuery) {
    const where = this.where(context, query);
    const include = {
      user: { select: { id: true, displayName: true, emailNormalized: true } },
      acknowledgedBy: { select: { id: true, displayName: true } },
    } satisfies Prisma.SecurityEventInclude;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return { data, total };
  }

  async summary(context: ActorContext) {
    const since = new Date(Date.now() - 86_400_000);
    const base = { companyId: context.companyId, createdAt: { gte: since } } as const;
    const [info, warning, high, critical, unacknowledgedAlerts, latestCritical] = await this.prisma.$transaction([
      this.prisma.securityEvent.count({ where: { ...base, severity: "INFO" } }),
      this.prisma.securityEvent.count({ where: { ...base, severity: "WARNING" } }),
      this.prisma.securityEvent.count({ where: { ...base, severity: "HIGH" } }),
      this.prisma.securityEvent.count({ where: { ...base, severity: "CRITICAL" } }),
      this.prisma.securityEvent.count({ where: { companyId: context.companyId, severity: { in: ["HIGH", "CRITICAL"] }, acknowledgedAt: null } }),
      this.prisma.securityEvent.findFirst({ where: { companyId: context.companyId, severity: "CRITICAL" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    return { last24Hours: { info, warning, high, critical }, unacknowledgedAlerts, latestCriticalAt: latestCritical?.createdAt ?? null };
  }

  async options(context: ActorContext) {
    const eventTypes = await this.prisma.securityEvent.groupBy({ by: ["eventType"], where: { companyId: context.companyId }, orderBy: { eventType: "asc" } });
    const actors = await this.prisma.securityEvent.groupBy({ by: ["userId"], where: { companyId: context.companyId, userId: { not: null } }, orderBy: { userId: "asc" } });
    const users = await this.prisma.user.findMany({ where: { id: { in: actors.flatMap((item) => item.userId == null ? [] : [item.userId]) } }, select: { id: true, displayName: true, emailNormalized: true }, orderBy: { displayName: "asc" } });
    return { eventTypes: eventTypes.map((item) => item.eventType), users };
  }

  async acknowledge(context: ActorContext, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.securityEvent.findFirst({ where: { id, companyId: context.companyId }, select: { id: true, acknowledgedAt: true } });
      if (!found) return null;
      if (!found.acknowledgedAt) {
        const now = new Date();
        await tx.securityEvent.update({ where: { id }, data: { acknowledgedAt: now, acknowledgedById: context.userId } });
        await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "SECURITY_EVENT_ACKNOWLEDGED", entityType: "SECURITY_EVENT", entityId: id.toString(), details: { acknowledgedAt: now.toISOString() } } });
      }
      return tx.securityEvent.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true, emailNormalized: true } }, acknowledgedBy: { select: { id: true, displayName: true } } } });
    });
  }
}
