import type { Prisma, PrismaClient, SecuritySeverity } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import type { SecurityActor, SecurityIdentityQueryPort } from "./security-identity-port.js";

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: SecurityIdentityQueryPort,
    private readonly audit: AuditAppendPort,
  ) {}

  private async where(context: ActorContext, query: Omit<SecurityEventQuery, "page" | "pageSize">): Promise<Prisma.SecurityEventWhereInput> {
    const matchingActorIds = query.search
      ? await this.identity.findMatchingActorIds(await this.actorIds(context.companyId), query.search)
      : [];
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
        ...(matchingActorIds.length ? [{ userId: { in: matchingActorIds } }] : []),
      ] } : {}),
    };
  }

  async list(context: ActorContext, query: SecurityEventQuery) {
    const where = await this.where(context, query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return { data: await this.withActors(data), total };
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
    const users = await this.identity.findActorsByIds(actors.flatMap((item) => item.userId == null ? [] : [item.userId]));
    return { eventTypes: eventTypes.map((item) => item.eventType), users };
  }

  private async acknowledgeRecord(context: ActorContext, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.securityEvent.findFirst({ where: { id, companyId: context.companyId }, select: { id: true, acknowledgedAt: true } });
      if (!found) return null;
      if (!found.acknowledgedAt) {
        const now = new Date();
        await tx.securityEvent.update({ where: { id }, data: { acknowledgedAt: now, acknowledgedById: context.userId } });
        await this.audit.append(tx, { companyId: context.companyId, actorUserId: context.userId, action: "SECURITY_EVENT_ACKNOWLEDGED", entityType: "SECURITY_EVENT", entityId: id.toString(), details: { acknowledgedAt: now.toISOString() } });
      }
      return tx.securityEvent.findUnique({ where: { id } });
    });
  }

  async acknowledge(context: ActorContext, id: bigint) {
    const row = await this.acknowledgeRecord(context, id);
    return row ? (await this.withActors([row]))[0] ?? null : null;
  }

  private async actorIds(companyId: bigint) {
    const actors = await this.prisma.securityEvent.groupBy({
      by: ["userId"],
      where: { companyId, userId: { not: null } },
    });
    return actors.flatMap(({ userId }) => userId == null ? [] : [userId]);
  }

  private async withActors<T extends { userId: bigint | null; acknowledgedById: bigint | null }>(rows: readonly T[]): Promise<Array<T & { user: SecurityActor | null; acknowledgedBy: SecurityActor | null }>> {
    const ids = [...new Set(rows.flatMap(({ userId, acknowledgedById }) => [userId, acknowledgedById].filter((id): id is bigint => id !== null)))];
    const actors = await this.identity.findActorsByIds(ids);
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return rows.map((row) => ({
      ...row,
      user: row.userId === null ? null : byId.get(row.userId) ?? { id: row.userId, displayName: "مستخدم غير متاح", emailNormalized: "" },
      acknowledgedBy: row.acknowledgedById === null ? null : byId.get(row.acknowledgedById) ?? { id: row.acknowledgedById, displayName: "مستخدم غير متاح", emailNormalized: "" },
    }));
  }
}
