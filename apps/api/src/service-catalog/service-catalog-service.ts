import { Prisma, type PrismaClient, type ServiceCategory } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { transitionServiceCategory, type ServiceCategoryStatus } from "./service-offering-policy.js";

export type ServiceCatalogFailureReason = "NOT_FOUND" | "VERSION_CONFLICT" | "CATEGORY_RETIRED"
  | "IDEMPOTENCY_MISMATCH" | "IDEMPOTENCY_IN_PROGRESS";

export class ServiceCatalogError extends Error {
  constructor(readonly reason: ServiceCatalogFailureReason) { super(reason); }
}

const categoryJson = (row: ServiceCategory) => ({
  id: row.publicId,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  description: row.description,
  status: row.status,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

type CategoryCreate = { nameAr: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryTransition = { expectedVersion: number; to: ServiceCategoryStatus; reason: string; idempotencyKey: string };

export class ServiceCatalogService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.commands = new IdempotentCommandExecutor(prisma, new TransactionExecutor(prisma));
  }

  async listCategories(context: ActorContext, input: { page: number; pageSize: number; search?: string | undefined; status?: ServiceCategoryStatus | undefined }) {
    const where: Prisma.ServiceCategoryWhereInput = {
      companyId: context.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { OR: [{ nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceCategory.findMany({
        where, orderBy: [{ nameAr: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      }),
      this.prisma.serviceCategory.count({ where }),
    ]);
    return { data: rows.map(categoryJson), meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  async getCategory(context: ActorContext, publicId: string) {
    const row = await this.prisma.serviceCategory.findFirst({ where: { companyId: context.companyId, publicId } });
    if (!row) throw new ServiceCatalogError("NOT_FOUND");
    return { category: categoryJson(row) };
  }

  createCategory(context: ActorContext, input: CategoryCreate) {
    return this.execute(context, "CREATE_SERVICE_CATEGORY", input.idempotencyKey, input, 201, async (tx) => {
      const row = await tx.serviceCategory.create({ data: {
        companyId: context.companyId,
        nameAr: input.nameAr, nameEn: input.nameEn ?? null, description: input.description ?? null,
        createdById: context.userId, updatedById: context.userId,
      } });
      await this.audit(tx, context, "SERVICE_CATEGORY_CREATED", row.publicId);
      return { category: categoryJson(row) };
    });
  }

  updateCategory(context: ActorContext, publicId: string, input: CategoryPatch) {
    return this.execute(context, "UPDATE_SERVICE_CATEGORY", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const current = await tx.serviceCategory.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!current) throw new ServiceCatalogError("NOT_FOUND");
      if (current.status === "RETIRED") throw new ServiceCatalogError("CATEGORY_RETIRED");
      if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
      const changed = await tx.serviceCategory.updateMany({
        where: { id: current.id, companyId: context.companyId, version: input.expectedVersion, status: { not: "RETIRED" } },
        data: {
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 }, updatedById: context.userId,
        },
      });
      if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
      const row = await tx.serviceCategory.findUniqueOrThrow({ where: { id: current.id } });
      await this.audit(tx, context, "SERVICE_CATEGORY_UPDATED", row.publicId);
      return { category: categoryJson(row) };
    });
  }

  transitionCategory(context: ActorContext, publicId: string, input: CategoryTransition) {
    return this.execute(context, "TRANSITION_SERVICE_CATEGORY", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const current = await tx.serviceCategory.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!current) throw new ServiceCatalogError("NOT_FOUND");
      if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
      const next = transitionServiceCategory({ from: current.status, to: input.to, reason: input.reason });
      const changed = await tx.serviceCategory.updateMany({
        where: { id: current.id, companyId: context.companyId, version: input.expectedVersion, status: current.status },
        data: { status: next, version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
      const row = await tx.serviceCategory.findUniqueOrThrow({ where: { id: current.id } });
      await this.audit(tx, context, "SERVICE_CATEGORY_TRANSITIONED", row.publicId, { from: current.status, to: next, reason: input.reason.trim() });
      return { category: categoryJson(row) };
    });
  }

  private execute<T>(context: ActorContext, operation: string, key: string, body: Record<string, unknown>, responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.commands.execute({
      context, operation, key, responseStatus,
      fingerprint: JSON.stringify(body),
      errors: {
        mismatch: () => new ServiceCatalogError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ServiceCatalogError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityId: string, details?: Prisma.InputJsonObject) {
    return appendAudit(tx, { data: {
      companyId: context.companyId, actorUserId: context.userId,
      action, entityType: "SERVICE_CATEGORY", entityId,
      ...(details ? { details } : {}),
    } });
  }
}
