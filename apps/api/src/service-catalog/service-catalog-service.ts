import { Prisma, type PrismaClient, type ServiceCategory, type ServiceOffering, type ServiceOfferingVariant } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import { transitionServiceCategory, transitionServiceOffering, transitionServiceVariant,
  validateAvailabilityWindow, validateServiceVariantEdit, type ServiceAvailabilityWindow, type ServiceCategoryStatus,
  type ServiceOfferingStatus, type ServicePricingUnit } from "./service-offering-policy.js";

export type ServiceCatalogFailureReason = "NOT_FOUND" | "VERSION_CONFLICT" | "CATEGORY_RETIRED"
  | "CATEGORY_NOT_ACTIVE" | "OFFERING_RETIRED" | "VARIANT_RETIRED"
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
const variantJson = (row: ServiceOfferingVariant) => ({
  id: row.publicId, nameAr: row.nameAr, nameEn: row.nameEn,
  pricingUnit: row.pricingUnit,
  availableFrom: row.availableFrom?.toISOString().slice(0, 10) ?? null,
  availableUntil: row.availableUntil?.toISOString().slice(0, 10) ?? null,
  defaultRevenueAccountId: row.defaultRevenueAccountId?.toString() ?? null,
  defaultOutputTaxRateId: row.defaultOutputTaxRateId?.toString() ?? null,
  status: row.status, version: row.version,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

type CategoryCreate = { nameAr: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null; description?: string | null; idempotencyKey: string };
type CategoryTransition = { expectedVersion: number; to: ServiceCategoryStatus; reason: string; idempotencyKey: string };
type OfferingCreate = { nameAr: string; nameEn?: string | null; description?: string | null; categoryId?: string | null; idempotencyKey: string };
type OfferingPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null; description?: string | null; categoryId?: string | null; idempotencyKey: string };
type StatusTransition = { expectedVersion: number; to: ServiceOfferingStatus; reason: string; idempotencyKey: string };
type VariantCreate = { nameAr: string; nameEn?: string | null; pricingUnit: ServicePricingUnit;
  availableFrom?: string | null; availableUntil?: string | null; idempotencyKey: string };
type VariantPatch = { expectedVersion: number; nameAr?: string; nameEn?: string | null;
  pricingUnit?: ServicePricingUnit; availableFrom?: string | null; availableUntil?: string | null; idempotencyKey: string };
const dbDate = (value: string | null) => value === null ? null : new Date(`${value}T00:00:00.000Z`);
function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const field = (name: string) => parts.find(part => part.type === name)?.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

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

  transitionOffering(context: ActorContext, publicId: string, input: StatusTransition) {
    return this.execute(context, "TRANSITION_SERVICE_OFFERING", input.idempotencyKey, { publicId, ...input }, 200, async (tx) => {
      const current = await this.lockOffering(tx, context.companyId, publicId);
      if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
      const variants = await tx.serviceOfferingVariant.findMany({
        where: { companyId: context.companyId, offeringId: current.id }, select: { status: true },
      });
      const next = transitionServiceOffering({ from: current.status, to: input.to,
        variantStatuses: variants.map(row => row.status), reason: input.reason });
      const changed = await tx.serviceOffering.updateMany({
        where: { id: current.id, companyId: context.companyId, version: input.expectedVersion, status: current.status },
        data: { status: next, version: { increment: 1 }, updatedById: context.userId },
      });
      if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
      const row = await tx.serviceOffering.findUniqueOrThrow({
        where: { id: current.id }, include: { category: true, _count: { select: { variants: true } } },
      });
      await this.audit(tx, context, "SERVICE_OFFERING_TRANSITIONED", row.publicId, {
        beforeVersion: current.version, afterVersion: row.version,
        changedFields: ["status"], from: current.status, to: next, reason: input.reason.trim(),
      }, "SERVICE_OFFERING");
      return { offering: offeringJson(row, row.category, row._count.variants) };
    });
  }

  async listVariants(context: ActorContext, offeringPublicId: string, input: { page: number; pageSize: number }) {
    const offering = await this.prisma.serviceOffering.findFirst({
      where: { companyId: context.companyId, publicId: offeringPublicId }, select: { id: true },
    });
    if (!offering) throw new ServiceCatalogError("NOT_FOUND");
    const where: Prisma.ServiceOfferingVariantWhereInput = { companyId: context.companyId, offeringId: offering.id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceOfferingVariant.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.serviceOfferingVariant.count({ where }),
    ]);
    return { data: rows.map(variantJson), meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  createVariant(context: ActorContext, offeringPublicId: string, input: VariantCreate) {
    return this.execute(context, "CREATE_SERVICE_VARIANT", input.idempotencyKey, { offeringPublicId, ...input }, 201, async (tx) => {
      const offering = await this.lockOffering(tx, context.companyId, offeringPublicId);
      if (offering.status === "RETIRED") throw new ServiceCatalogError("OFFERING_RETIRED");
      const availability: ServiceAvailabilityWindow = {
        availableFrom: input.availableFrom ?? null, availableUntil: input.availableUntil ?? null,
      };
      validateAvailabilityWindow(availability);
      const row = await tx.serviceOfferingVariant.create({ data: {
        companyId: context.companyId, offeringId: offering.id,
        nameAr: input.nameAr, nameEn: input.nameEn ?? null, pricingUnit: input.pricingUnit,
        availableFrom: dbDate(availability.availableFrom), availableUntil: dbDate(availability.availableUntil),
        createdById: context.userId, updatedById: context.userId,
      } });
      await this.audit(tx, context, "SERVICE_VARIANT_CREATED", row.publicId, {
        beforeVersion: null, afterVersion: row.version,
        changedFields: changedCatalogFields(null, row, ["nameAr", "nameEn", "pricingUnit", "availableFrom", "availableUntil", "status"]),
      }, "SERVICE_OFFERING_VARIANT");
      return { variant: variantJson(row) };
    });
  }

  updateVariant(context: ActorContext, offeringPublicId: string, variantPublicId: string, input: VariantPatch) {
    return this.execute(context, "UPDATE_SERVICE_VARIANT", input.idempotencyKey,
      { offeringPublicId, variantPublicId, ...input }, 200, async (tx) => {
        const offering = await this.lockOffering(tx, context.companyId, offeringPublicId);
        if (offering.status === "RETIRED") throw new ServiceCatalogError("OFFERING_RETIRED");
        const current = await tx.serviceOfferingVariant.findFirst({
          where: { companyId: context.companyId, offeringId: offering.id, publicId: variantPublicId },
        });
        if (!current) throw new ServiceCatalogError("NOT_FOUND");
        if (current.status === "RETIRED") throw new ServiceCatalogError("VARIANT_RETIRED");
        if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
        const company = await tx.company.findUniqueOrThrow({ where: { id: context.companyId }, select: { timezone: true } });
        const previousAvailability = { availableFrom: current.availableFrom?.toISOString().slice(0, 10) ?? null,
          availableUntil: current.availableUntil?.toISOString().slice(0, 10) ?? null };
        const nextAvailability = { availableFrom: input.availableFrom === undefined ? previousAvailability.availableFrom : input.availableFrom,
          availableUntil: input.availableUntil === undefined ? previousAvailability.availableUntil : input.availableUntil };
        validateServiceVariantEdit({ everActivated: current.firstActivatedAt !== null,
          previousUnit: current.pricingUnit, nextUnit: input.pricingUnit ?? current.pricingUnit,
          previousAvailability, nextAvailability, asOf: localDate(new Date(), company.timezone) });
        const changed = await tx.serviceOfferingVariant.updateMany({
          where: { id: current.id, companyId: context.companyId, offeringId: offering.id,
            version: input.expectedVersion, status: { not: "RETIRED" } },
          data: {
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.pricingUnit !== undefined ? { pricingUnit: input.pricingUnit } : {}),
            ...(input.availableFrom !== undefined ? { availableFrom: dbDate(input.availableFrom) } : {}),
            ...(input.availableUntil !== undefined ? { availableUntil: dbDate(input.availableUntil) } : {}),
            version: { increment: 1 }, updatedById: context.userId,
          },
        });
        if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
        const row = await tx.serviceOfferingVariant.findUniqueOrThrow({ where: { id: current.id } });
        await this.audit(tx, context, "SERVICE_VARIANT_UPDATED", row.publicId, {
          beforeVersion: current.version, afterVersion: row.version,
          changedFields: changedCatalogFields(current, row, ["nameAr", "nameEn", "pricingUnit", "availableFrom", "availableUntil"]),
        }, "SERVICE_OFFERING_VARIANT");
        return { variant: variantJson(row) };
      });
  }

  transitionVariant(context: ActorContext, offeringPublicId: string, variantPublicId: string, input: StatusTransition) {
    return this.execute(context, "TRANSITION_SERVICE_VARIANT", input.idempotencyKey,
      { offeringPublicId, variantPublicId, ...input }, 200, async (tx) => {
        const offering = await this.lockOffering(tx, context.companyId, offeringPublicId);
        const current = await tx.serviceOfferingVariant.findFirst({
          where: { companyId: context.companyId, offeringId: offering.id, publicId: variantPublicId },
        });
        if (!current) throw new ServiceCatalogError("NOT_FOUND");
        if (current.version !== input.expectedVersion) throw new ServiceCatalogError("VERSION_CONFLICT");
        const next = transitionServiceVariant({
          from: current.status, to: input.to, offeringStatus: offering.status,
          availability: { availableFrom: current.availableFrom?.toISOString().slice(0, 10) ?? null,
            availableUntil: current.availableUntil?.toISOString().slice(0, 10) ?? null },
          reason: input.reason,
        });
        const changed = await tx.serviceOfferingVariant.updateMany({
          where: { id: current.id, companyId: context.companyId, offeringId: offering.id,
            version: input.expectedVersion, status: current.status },
          data: { status: next, version: { increment: 1 }, updatedById: context.userId,
            ...(next === "ACTIVE" && current.firstActivatedAt === null ? { firstActivatedAt: new Date() } : {}) },
        });
        if (changed.count !== 1) throw new ServiceCatalogError("VERSION_CONFLICT");
        const row = await tx.serviceOfferingVariant.findUniqueOrThrow({ where: { id: current.id } });
        await this.audit(tx, context, "SERVICE_VARIANT_TRANSITIONED", row.publicId, {
          beforeVersion: current.version, afterVersion: row.version,
          changedFields: ["status"], from: current.status, to: next, reason: input.reason.trim(),
        }, "SERVICE_OFFERING_VARIANT");
        return { variant: variantJson(row) };
      });
  }

  private async lockOffering(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const rows = await tx.$queryRaw<Array<{ id: bigint; status: ServiceOfferingStatus; version: number }>>`
      SELECT id, status, version FROM service_offerings
      WHERE company_id = ${companyId} AND public_id = ${publicId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new ServiceCatalogError("NOT_FOUND");
    return row;
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
