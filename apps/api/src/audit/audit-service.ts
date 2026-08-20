import type { Prisma, PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";

export type AuditQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
  userId?: bigint | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nextDay = (value: string) => new Date(startOfDay(value).getTime() + 86_400_000);

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  private where(context: ActorContext, query: Omit<AuditQuery, "page" | "pageSize">): Prisma.AuditLogWhereInput {
    return {
      companyId: context.companyId,
      ...(query.userId ? { actorUserId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.dateFrom || query.dateTo ? { createdAt: { ...(query.dateFrom ? { gte: startOfDay(query.dateFrom) } : {}), ...(query.dateTo ? { lt: nextDay(query.dateTo) } : {}) } } : {}),
      ...(query.search ? { OR: [
        { action: { contains: query.search } },
        { entityType: { contains: query.search } },
        { entityId: { contains: query.search } },
        { actor: { displayName: { contains: query.search } } },
        { actor: { emailNormalized: { contains: query.search } } },
      ] } : {}),
    };
  }

  async list(context: ActorContext, query: AuditQuery) {
    const where = this.where(context, query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, include: { actor: { select: { id: true, displayName: true, emailNormalized: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total };
  }

  get(context: ActorContext, id: bigint) {
    return this.prisma.auditLog.findFirst({ where: { id, companyId: context.companyId }, include: { actor: { select: { id: true, displayName: true, emailNormalized: true } } } });
  }

  async options(context: ActorContext) {
    const [actions, entityTypes, actors] = await this.prisma.$transaction([
      this.prisma.auditLog.groupBy({ by: ["action"], where: { companyId: context.companyId }, orderBy: { action: "asc" } }),
      this.prisma.auditLog.groupBy({ by: ["entityType"], where: { companyId: context.companyId }, orderBy: { entityType: "asc" } }),
      this.prisma.auditLog.groupBy({ by: ["actorUserId"], where: { companyId: context.companyId }, orderBy: { actorUserId: "asc" } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: actors.map((item) => item.actorUserId) } }, select: { id: true, displayName: true, emailNormalized: true }, orderBy: { displayName: "asc" } });
    return { actions: actions.map((item) => item.action), entityTypes: entityTypes.map((item) => item.entityType), users };
  }

  async exportCsv(context: ActorContext, query: Omit<AuditQuery, "page" | "pageSize">) {
    const rows = await this.prisma.auditLog.findMany({ where: this.where(context, query), include: { actor: { select: { displayName: true, emailNormalized: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10_000 });
    const csv = this.toCsv(rows);
    await this.prisma.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "AUDIT_LOG_EXPORTED", entityType: "AUDIT_LOG", entityId: "export", details: { count: rows.length, filters: { ...query, userId: query.userId?.toString() } } } });
    return { csv, count: rows.length, truncated: rows.length === 10_000 };
  }

  private toCsv(rows: Array<{ id: bigint; action: string; entityType: string; entityId: string; details: Prisma.JsonValue | null; createdAt: Date; actor: { displayName: string; emailNormalized: string } }>) {
    const safe = (value: unknown) => {
      const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const header = ["id", "createdAt", "actorName", "actorEmail", "action", "entityType", "entityId", "details"];
    return `\uFEFF${header.map(safe).join(",")}\r\n${rows.map((row) => [row.id.toString(), row.createdAt.toISOString(), row.actor.displayName, row.actor.emailNormalized, row.action, row.entityType, row.entityId, row.details].map(safe).join(",")).join("\r\n")}`;
  }
}
