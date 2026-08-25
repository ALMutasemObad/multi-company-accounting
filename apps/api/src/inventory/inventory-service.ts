import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";

export type InventoryErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "VERSION_CONFLICT"
  | "WAREHOUSE_INACTIVE"
  | "WAREHOUSE_HAS_STOCK";

export class InventoryError extends Error {
  constructor(public readonly reason: InventoryErrorReason) {
    super(reason);
  }
}

export type WarehouseInput = {
  nameAr: string;
  nameEn?: string | null | undefined;
  address?: string | null | undefined;
};

export type WarehouseUpdate = {
  version: number;
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  address?: string | null | undefined;
};

const nullableTrimmed = (value: string | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
};

const isUniqueConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class InventoryService {
  private readonly transactions: TransactionExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
  }

  listWarehouses(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      active?: boolean | undefined;
    },
  ) {
    const where: Prisma.WarehouseWhereInput = {
      companyId: context.companyId,
      ...(input.active === undefined ? {} : { isActive: input.active }),
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search } },
              { nameAr: { contains: input.search } },
              { nameEn: { contains: input.search } },
              { address: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.warehouse.findMany({
        where,
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.warehouse.count({ where }),
    }));
  }

  async getWarehouse(context: ActorContext, id: bigint) {
    const value = await this.prisma.warehouse.findFirst({
      where: { id, companyId: context.companyId },
    });
    if (!value) throw new InventoryError("NOT_FOUND");
    return value;
  }

  async createWarehouse(context: ActorContext, input: WarehouseInput) {
    try {
      return await this.transactions.execute(
        { operation: "CREATE_WAREHOUSE", companyId: context.companyId },
        async (tx) => {
          const code = await reserveMasterDataCode(tx, context.companyId, "WAREHOUSE");
          const value = await tx.warehouse.create({
            data: {
              companyId: context.companyId,
              code,
              nameAr: input.nameAr.trim(),
              nameEn: nullableTrimmed(input.nameEn) ?? null,
              address: nullableTrimmed(input.address) ?? null,
            },
          });
          await this.audit(tx, context, "WAREHOUSE_CREATED", value.id);
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new InventoryError("CODE_EXISTS");
      throw error;
    }
  }

  updateWarehouse(context: ActorContext, id: bigint, input: WarehouseUpdate) {
    return this.transactions.execute(
      { operation: "UPDATE_WAREHOUSE", companyId: context.companyId },
      async (tx) => {
        const current = await tx.warehouse.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new InventoryError("NOT_FOUND");
        const changed = await tx.warehouse.updateMany({
          where: { id, companyId: context.companyId, version: input.version },
          data: {
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.nameEn === undefined ? {} : { nameEn: nullableTrimmed(input.nameEn) ?? null }),
            ...(input.address === undefined ? {} : { address: nullableTrimmed(input.address) ?? null }),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new InventoryError("VERSION_CONFLICT");
        const value = await tx.warehouse.findFirstOrThrow({
          where: { id, companyId: context.companyId },
        });
        await this.audit(tx, context, "WAREHOUSE_UPDATED", id, {
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  deactivateWarehouse(
    context: ActorContext,
    id: bigint,
    input: { version: number; reason: string },
  ) {
    return this.transactions.execute(
      { operation: "DEACTIVATE_WAREHOUSE", companyId: context.companyId },
      async (tx) => {
        await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM warehouses
          WHERE id = ${id} AND company_id = ${context.companyId}
          FOR UPDATE
        `;
        const current = await tx.warehouse.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new InventoryError("NOT_FOUND");
        if (!current.isActive) throw new InventoryError("WAREHOUSE_INACTIVE");
        const stocked = await tx.inventoryBalance.findFirst({
          where: { companyId: context.companyId, warehouseId: id, onHand: { gt: 0 } },
          select: { id: true },
        });
        if (stocked) throw new InventoryError("WAREHOUSE_HAS_STOCK");
        const changed = await tx.warehouse.updateMany({
          where: { id, companyId: context.companyId, version: input.version, isActive: true },
          data: { isActive: false, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new InventoryError("VERSION_CONFLICT");
        const value = await tx.warehouse.findFirstOrThrow({
          where: { id, companyId: context.companyId },
        });
        await this.audit(tx, context, "WAREHOUSE_DEACTIVATED", id, {
          reason: input.reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  static warehouseJson(value: {
    id: bigint;
    code: string;
    nameAr: string;
    nameEn: string | null;
    address: string | null;
    isActive: boolean;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      address: value.address,
      isActive: value.isActive,
      version: value.version,
    };
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    id: bigint,
    details?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "WAREHOUSE",
        entityId: id.toString(),
        ...(details ? { details } : {}),
      },
    });
  }
}
