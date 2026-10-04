import { Prisma, type PrismaClient, type ServiceCategory, type ServiceOffering } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { transitionServiceCategory, type ServiceCategoryStatus } from "./service-offering-policy.js";

export type ServiceCatalogFailureReason = "NOT_FOUND" | "VERSION_CONFLICT" | "CATEGORY_RETIRED"
  | "CATEGORY_NOT_ACTIVE" | "OFFERING_RETIRED"
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
function changedCatalogFields(before: object | null, after: object, fields: readonly string[]) {
  const next = after as Record<string, unknown>;
  const previous = before as Record<string, unknown> | null;
  return fields.filter(field => previous === null ? next[field] !== null && next[field] !== undefined : previous[field] !== next[field]);
}
const offeringJson = (row: ServiceOffering, category: ServiceCategory | null, variantCount: number) => ({
  id: row.publicId, code: row.code,
  nameAr: row.nameAr, nameEn: row.nameEn, description: row.description,
  category: category ? { id: category.publicId, nameAr: category.nameAr, nameEn: category.nameEn, status: category.status } : null,
  status: row.status, variantCount, version: row.version,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

type CategoryCreate = { nameAr: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryTransition = { expectedVersion: number; to: ServiceCategoryStatus; reason: string; idempotencyKey: string };
type OfferingCreate = { nameAr: string; nameEn?: string | null; description?: string | null; categoryId?: string | null; idempotencyKey: string };
type OfferingPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null; description?: string | null; categoryId?: string | null; idempotencyKey: string };

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
      await this.audit(tx, context, "SERVICE_CATEGORY_CREATED", row.publicId, {
        beforeVersion: null, afterVersion: row.version,
        changedFields: changedCatalogFields(null, row, ["nameAr", "nameEn", "description", "status"]),
      });
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
      await this.audit(tx, context, "SERVICE_CATEGORY_UPDATED", row.publicId, {
        beforeVersion: current.version, afterVersion: row.version,
        changedFields: changedCatalogFields(current, row, ["nameAr", "nameEn", "description"]),
      });
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
      await this.audit(tx, context, "SERVICE_CATEGORY_TRANSITIONED", row.publicId, {
        beforeVersion: current.version, afterVersion: row.version,
        changedFields: ["status"], from: current.status, to: next, reason: input.reason.trim(),
      });
      return { category: categoryJson(row) };
    });
  }

  async listOfferings(context: ActorContext, input: { page: number; pageSize: number; search?: string | undefined; status?: ServiceOffering["status"] | undefined }) {
    const where: Prisma.ServiceOfferingWhereInput = {
      companyId: context.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { OR: [{ code: { contains: input.search } }, { nameAr: { contains: input.search } }, { nameEn: { contains: input.search } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceOffering.findMany({
        where, include: { category: true, _count: { select: { variants: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      }),
      this.prisma.serviceOffering.count({ where }),
    ]);
    return { data: rows.map(row => offeringJson(row, row.category, row._count.variants)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  async getOffering(context: ActorContext, publicId: string) {
    const row = await this.prisma.serviceOffering.findFirst({
      where: { companyId: context.companyId, publicId },
      include: { category: true, _count: { select: { variants: true } } },
    });
    if (!row) throw new ServiceCatalogError("NOT_FOUND");
    return { offering: offeringJson(row, row.category, row._count.variants) };
  }

  createOffering(context: ActorContext, input: OfferingCreate) {
    return this.execute(context, "CREATE_SERVICE_OFFERING", input.idempotencyKey, input, 201, async (tx) => {
      const categoryId = await this.resolveActiveCategory(tx, context.companyId, input.categoryId ?? null);
      const row = await tx.serviceOffering.create({ data: {
        companyId: context.companyId, categoryId,
        code: await reserveMasterDataCode(tx, context.companyId, "SERVICE_OFFERING"),
        nameAr: input.nameAr, nameEn: input.nameEn ?? null, description: input.description ?? null,
        createdById: context.userId, updatedById: context.userId,
      }, include: { category: true, _count: { select: { variants: true } } } });
      await this.audit(tx, context, "SERVICE_OFFERING_CREATED", row.publicId, {
        beforeVersion: null, afterVersion: row.version,
        changedFields: changedCatalogFields(null, row, ["categoryId", "code", "nameAr", "nameEn", "description", "status"]),
      }, "SERVICE_OFFERING");
      return { offering: offeringJson(row, row.category, row._count.variants) };
    });
  }

  updateOffering(context: ActorContext, publicId: string, input: OfferingPatch) {
    return this.execute(context, "UPDATE_SERVICE_OFFERING", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const current = await tx.serviceOffering.findFirst({ where: { companyId: context.companyId, publicId } });
      if (!current) throw new ServiceCatalogError("NOT_FOUND");
      if (current.status === "RETIRED") throw new ServiceCatalogError("OFFERING_RETIRED");
      if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
      const categoryId = input.categoryId === undefined ? undefined
        : await this.resolveActiveCategory(tx, context.companyId, input.categoryId);
      const changed = await tx.serviceOffering.updateMany({
        where: { id: current.id, companyId: context.companyId, version: input.expectedVersion, status: { not: "RETIRED" } },
        data: {
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          version: { increment: 1 }, updatedById: context.userId,
        },
      });
      if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
      const row = await tx.serviceOffering.findUniqueOrThrow({
        where: { id: current.id }, include: { category: true, _count: { select: { variants: true } } },
      });
      await this.audit(tx, context, "SERVICE_OFFERING_UPDATED", row.publicId, {
        beforeVersion: current.version, afterVersion: row.version,
        changedFields: changedCatalogFields(current, row, ["categoryId", "nameAr", "nameEn", "description"]),
      }, "SERVICE_OFFERING");
      return { offering: offeringJson(row, row.category, row._count.variants) };
    });
  }

  private async resolveActiveCategory(tx: Prisma.TransactionClient, companyId: bigint, publicId: string | null) {
    if (publicId === null) return null;
    // Lock the owning category so a concurrent retire cannot pass this check
    // while a new offering is assigned to it.
    const rows = await tx.$queryRaw<Array<{ id: bigint; status: ServiceCategoryStatus }>>`
      SELECT id, status FROM service_categories
      WHERE company_id = ${companyId} AND public_id = ${publicId}
      FOR UPDATE
    `;
    if (rows[0]?.status !== "ACTIVE") throw new ServiceCatalogError("CATEGORY_NOT_ACTIVE");
    return rows[0].id;
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

  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, entityId: string, details?: Prisma.InputJsonObject,
    entityType = "SERVICE_CATEGORY") {
    return appendAudit(tx, { data: {
      companyId: context.companyId, actorUserId: context.userId,
      action, entityType, entityId,
      ...(details ? { details } : {}),
    } });
  }
}
