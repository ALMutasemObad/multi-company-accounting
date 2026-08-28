import type { Prisma, PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { AuditActor, AuditIdentityQueryPort } from "./audit-identity-port.js";

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identity: AuditIdentityQueryPort,
  ) {}

  private async where(context: ActorContext, query: Omit<AuditQuery, "page" | "pageSize">): Promise<Prisma.AuditLogWhereInput> {
    const matchingActorIds = query.search
      ? await this.identity.findMatchingActorIds(await this.actorIds(context.companyId), query.search)
      : [];
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
        ...(matchingActorIds.length ? [{ actorUserId: { in: matchingActorIds } }] : []),
      ] } : {}),
    };
  }

  async list(context: ActorContext, query: AuditQuery) {
    const where = await this.where(context, query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data: await this.withActors(data), total };
  }

  async get(context: ActorContext, id: bigint) {
    const row = await this.prisma.auditLog.findFirst({ where: { id, companyId: context.companyId } });
    return row ? (await this.withActors([row]))[0] ?? null : null;
  }

  async options(context: ActorContext) {
    const [actions, entityTypes, actors] = await this.prisma.$transaction([
      this.prisma.auditLog.groupBy({ by: ["action"], where: { companyId: context.companyId }, orderBy: { action: "asc" } }),
      this.prisma.auditLog.groupBy({ by: ["entityType"], where: { companyId: context.companyId }, orderBy: { entityType: "asc" } }),
      this.prisma.auditLog.groupBy({ by: ["actorUserId"], where: { companyId: context.companyId }, orderBy: { actorUserId: "asc" } }),
    ]);
    const users = await this.identity.findActorsByIds(actors.map((item) => item.actorUserId));
    return { actions: actions.map((item) => item.action), entityTypes: entityTypes.map((item) => item.entityType), users };
  }

  async exportCsv(context: ActorContext, query: Omit<AuditQuery, "page" | "pageSize">) {
    const rows = await this.withActors(await this.prisma.auditLog.findMany({ where: await this.where(context, query), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10_000 }));
    const csv = this.toCsv(rows);
    await this.prisma.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "AUDIT_LOG_EXPORTED", entityType: "AUDIT_LOG", entityId: "export", details: { count: rows.length, filters: { ...query, userId: query.userId?.toString() } } } });
    return { csv, count: rows.length, truncated: rows.length === 10_000 };
  }

  private async actorIds(companyId: bigint) {
    const actors = await this.prisma.auditLog.groupBy({ by: ["actorUserId"], where: { companyId } });
    return actors.map(({ actorUserId }) => actorUserId);
  }

  private async withActors<T extends { actorUserId: bigint }>(rows: readonly T[]): Promise<Array<T & { actor: AuditActor }>> {
    const actors = await this.identity.findActorsByIds([...new Set(rows.map(({ actorUserId }) => actorUserId))]);
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return rows.map((row) => ({
      ...row,
      actor: byId.get(row.actorUserId) ?? { id: row.actorUserId, displayName: "مستخدم غير متاح", emailNormalized: "" },
    }));
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
