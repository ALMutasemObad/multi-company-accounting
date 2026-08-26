import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";

export type InventoryCatalogErrorReason =
  | "NOT_FOUND"
  | "CODE_EXISTS"
  | "VERSION_CONFLICT"
  | "UNIT_INACTIVE"
  | "UNIT_IN_USE"
  | "ITEM_INACTIVE"
  | "ITEM_HAS_STOCK";

export class InventoryCatalogError extends Error {
  constructor(public readonly reason: InventoryCatalogErrorReason) {
    super(reason);
  }
}

export type UnitOfMeasureInput = {
  code: string;
  nameAr: string;
  nameEn?: string | null | undefined;
  decimalPlaces: number;
};

export type UnitOfMeasureUpdate = {
  version: number;
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  decimalPlaces?: number | undefined;
};

export type InventoryItemInput = {
  unitOfMeasureId: bigint;
  nameAr: string;
  nameEn?: string | null | undefined;
  description?: string | null | undefined;
};

export type InventoryItemUpdate = {
  version: number;
  unitOfMeasureId?: bigint | undefined;
  nameAr?: string | undefined;
  nameEn?: string | null | undefined;
  description?: string | null | undefined;
};

export type InventoryInvoiceSelectionErrorReason =
  | "WAREHOUSE_REQUIRED"
  | "INVALID_WAREHOUSE"
  | "INVALID_INVENTORY_ITEM";

export class InventoryInvoiceSelectionError extends Error {
  constructor(public readonly reason: InventoryInvoiceSelectionErrorReason) {
    super(reason);
  }
}

export type InvoiceWarehouseReference = {
  id: bigint;
  code: string;
  nameAr: string;
};

export type InvoiceInventoryItemReference = {
  id: bigint;
  code: string;
  nameAr: string;
  description: string | null;
  unitOfMeasure: {
    code: string;
    decimalPlaces: number;
  };
};

export type InventoryInvoiceSelection = {
  warehouse: InvoiceWarehouseReference | null;
  items: Map<string, InvoiceInventoryItemReference>;
};

export type ImportedInventoryInvoiceSelection = {
  warehouse: InvoiceWarehouseReference | null;
  itemsByCode: Map<string, InvoiceInventoryItemReference>;
};

export interface InventoryInvoiceCatalogPort {
  resolveInvoiceSelection(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      warehouseId?: bigint | null | undefined;
      inventoryItemIds: bigint[];
    },
  ): Promise<InventoryInvoiceSelection>;
  resolveImportedInvoiceSelection(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      warehouseCode?: string | null | undefined;
      inventoryItemCodes: string[];
    },
  ): Promise<ImportedInventoryInvoiceSelection>;
}

export function inventoryQuantityFitsUnit(
  value: Prisma.Decimal.Value,
  decimalPlaces: number,
) {
  return new Prisma.Decimal(value).decimalPlaces() <= decimalPlaces;
}

type LockedUnit = {
  id: bigint;
};

const nullableTrimmed = (value: string | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
};

const isUniqueConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class InventoryCatalogService implements InventoryInvoiceCatalogPort {
  private readonly transactions: TransactionExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
  }

  listUnitsOfMeasure(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      active?: boolean | undefined;
    },
  ) {
    const where: Prisma.UnitOfMeasureWhereInput = {
      companyId: context.companyId,
      ...(input.active === undefined ? {} : { isActive: input.active }),
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search } },
              { nameAr: { contains: input.search } },
              { nameEn: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.unitOfMeasure.findMany({
        where,
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.unitOfMeasure.count({ where }),
    }));
  }

  async getUnitOfMeasure(context: ActorContext, id: bigint) {
    const value = await this.prisma.unitOfMeasure.findFirst({
      where: { id, companyId: context.companyId },
    });
    if (!value) throw new InventoryCatalogError("NOT_FOUND");
    return value;
  }

  async createUnitOfMeasure(context: ActorContext, input: UnitOfMeasureInput) {
    try {
      return await this.transactions.execute(
        { operation: "CREATE_UNIT_OF_MEASURE", companyId: context.companyId },
        async (tx) => {
          const value = await tx.unitOfMeasure.create({
            data: {
              companyId: context.companyId,
              code: input.code.trim().toUpperCase(),
              nameAr: input.nameAr.trim(),
              nameEn: nullableTrimmed(input.nameEn) ?? null,
              decimalPlaces: input.decimalPlaces,
            },
          });
          await this.audit(tx, context, "UNIT_OF_MEASURE_CREATED", "UNIT_OF_MEASURE", value.id);
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new InventoryCatalogError("CODE_EXISTS");
      throw error;
    }
  }

  updateUnitOfMeasure(
    context: ActorContext,
    id: bigint,
    input: UnitOfMeasureUpdate,
  ) {
    return this.transactions.execute(
      { operation: "UPDATE_UNIT_OF_MEASURE", companyId: context.companyId },
      async (tx) => {
        const current = await tx.unitOfMeasure.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new InventoryCatalogError("NOT_FOUND");
        const changed = await tx.unitOfMeasure.updateMany({
          where: { id, companyId: context.companyId, version: input.version },
          data: {
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.nameEn === undefined
              ? {}
              : { nameEn: nullableTrimmed(input.nameEn) ?? null }),
            ...(input.decimalPlaces === undefined
              ? {}
              : { decimalPlaces: input.decimalPlaces }),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new InventoryCatalogError("VERSION_CONFLICT");
        const value = await tx.unitOfMeasure.findFirstOrThrow({
          where: { id, companyId: context.companyId },
        });
        await this.audit(tx, context, "UNIT_OF_MEASURE_UPDATED", "UNIT_OF_MEASURE", id, {
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  deactivateUnitOfMeasure(
    context: ActorContext,
    id: bigint,
    input: { version: number; reason: string },
  ) {
    return this.transactions.execute(
      { operation: "DEACTIVATE_UNIT_OF_MEASURE", companyId: context.companyId },
      async (tx) => {
        const current = await this.lockUnit(tx, context.companyId, id);
        if (!current) throw new InventoryCatalogError("NOT_FOUND");
        if (!current.isActive) throw new InventoryCatalogError("UNIT_INACTIVE");
        const activeItems = await tx.inventoryItem.count({
          where: { companyId: context.companyId, unitOfMeasureId: id, isActive: true },
        });
        if (activeItems > 0) throw new InventoryCatalogError("UNIT_IN_USE");
        const changed = await tx.unitOfMeasure.updateMany({
          where: { id, companyId: context.companyId, version: input.version, isActive: true },
          data: { isActive: false, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new InventoryCatalogError("VERSION_CONFLICT");
        const value = await tx.unitOfMeasure.findFirstOrThrow({
          where: { id, companyId: context.companyId },
        });
        await this.audit(tx, context, "UNIT_OF_MEASURE_DEACTIVATED", "UNIT_OF_MEASURE", id, {
          reason: input.reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  listItems(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      active?: boolean | undefined;
      unitOfMeasureId?: bigint | undefined;
    },
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      companyId: context.companyId,
      ...(input.active === undefined ? {} : { isActive: input.active }),
      ...(input.unitOfMeasureId === undefined
        ? {}
        : { unitOfMeasureId: input.unitOfMeasureId }),
      ...(input.search
        ? {
            OR: [
              { code: { contains: input.search } },
              { nameAr: { contains: input.search } },
              { nameEn: { contains: input.search } },
              { description: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.inventoryItem.findMany({
        where,
        include: { unitOfMeasure: true },
        orderBy: { code: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.inventoryItem.count({ where }),
    }));
  }

  async getItem(context: ActorContext, id: bigint) {
    const value = await this.prisma.inventoryItem.findFirst({
      where: { id, companyId: context.companyId },
      include: { unitOfMeasure: true },
    });
    if (!value) throw new InventoryCatalogError("NOT_FOUND");
    return value;
  }

  async resolveInvoiceSelection(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      warehouseId?: bigint | null | undefined;
      inventoryItemIds: bigint[];
    },
  ): Promise<InventoryInvoiceSelection> {
    const uniqueItemIds = [...new Set(input.inventoryItemIds.map(String))].map(BigInt);
    if (uniqueItemIds.length > 0 && !input.warehouseId) {
      throw new InventoryInvoiceSelectionError("WAREHOUSE_REQUIRED");
    }

    const warehouse = input.warehouseId
      ? await tx.warehouse.findFirst({
          where: { id: input.warehouseId, companyId: input.companyId, isActive: true },
          select: { id: true, code: true, nameAr: true },
        })
      : null;
    if (input.warehouseId && !warehouse) {
      throw new InventoryInvoiceSelectionError("INVALID_WAREHOUSE");
    }

    const items = uniqueItemIds.length
      ? await tx.inventoryItem.findMany({
          where: {
            companyId: input.companyId,
            id: { in: uniqueItemIds },
            isActive: true,
            unitOfMeasure: { isActive: true },
          },
          select: {
            id: true,
            code: true,
            nameAr: true,
            description: true,
            unitOfMeasure: { select: { code: true, decimalPlaces: true } },
          },
        })
      : [];
    if (items.length !== uniqueItemIds.length) {
      throw new InventoryInvoiceSelectionError("INVALID_INVENTORY_ITEM");
    }

    return {
      warehouse,
      items: new Map(items.map((item) => [item.id.toString(), item])),
    };
  }

  async resolveImportedInvoiceSelection(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      warehouseCode?: string | null | undefined;
      inventoryItemCodes: string[];
    },
  ): Promise<ImportedInventoryInvoiceSelection> {
    const uniqueItemCodes = [...new Set(input.inventoryItemCodes)];
    if (uniqueItemCodes.length > 0 && !input.warehouseCode) {
      throw new InventoryInvoiceSelectionError("WAREHOUSE_REQUIRED");
    }
    const warehouse = input.warehouseCode
      ? await tx.warehouse.findFirst({
          where: { companyId: input.companyId, code: input.warehouseCode, isActive: true },
          select: { id: true, code: true, nameAr: true },
        })
      : null;
    if (input.warehouseCode && !warehouse) {
      throw new InventoryInvoiceSelectionError("INVALID_WAREHOUSE");
    }
    const items = uniqueItemCodes.length === 0
      ? []
      : await tx.inventoryItem.findMany({
          where: {
            companyId: input.companyId,
            code: { in: uniqueItemCodes },
            isActive: true,
            unitOfMeasure: { isActive: true },
          },
          select: {
            id: true,
            code: true,
            nameAr: true,
            description: true,
            unitOfMeasure: { select: { code: true, decimalPlaces: true } },
          },
        });
    if (items.length !== uniqueItemCodes.length) {
      throw new InventoryInvoiceSelectionError("INVALID_INVENTORY_ITEM");
    }
    return {
      warehouse,
      itemsByCode: new Map(items.map((item) => [item.code, item])),
    };
  }

  async createItem(context: ActorContext, input: InventoryItemInput) {
    try {
      return await this.transactions.execute(
        { operation: "CREATE_INVENTORY_ITEM", companyId: context.companyId },
        async (tx) => {
          await this.requireActiveUnit(tx, context.companyId, input.unitOfMeasureId);
          const code = await reserveMasterDataCode(tx, context.companyId, "INVENTORY_ITEM");
          const value = await tx.inventoryItem.create({
            data: {
              companyId: context.companyId,
              unitOfMeasureId: input.unitOfMeasureId,
              code,
              nameAr: input.nameAr.trim(),
              nameEn: nullableTrimmed(input.nameEn) ?? null,
              description: nullableTrimmed(input.description) ?? null,
            },
            include: { unitOfMeasure: true },
          });
          await this.audit(tx, context, "INVENTORY_ITEM_CREATED", "INVENTORY_ITEM", value.id);
          return value;
        },
      );
    } catch (error) {
      if (isUniqueConflict(error)) throw new InventoryCatalogError("CODE_EXISTS");
      throw error;
    }
  }

  updateItem(context: ActorContext, id: bigint, input: InventoryItemUpdate) {
    return this.transactions.execute(
      { operation: "UPDATE_INVENTORY_ITEM", companyId: context.companyId },
      async (tx) => {
        const current = await tx.inventoryItem.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new InventoryCatalogError("NOT_FOUND");
        if (input.unitOfMeasureId !== undefined) {
          await this.requireActiveUnit(tx, context.companyId, input.unitOfMeasureId);
        }
        const changed = await tx.inventoryItem.updateMany({
          where: { id, companyId: context.companyId, version: input.version },
          data: {
            ...(input.unitOfMeasureId === undefined
              ? {}
              : { unitOfMeasureId: input.unitOfMeasureId }),
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.nameEn === undefined
              ? {}
              : { nameEn: nullableTrimmed(input.nameEn) ?? null }),
            ...(input.description === undefined
              ? {}
              : { description: nullableTrimmed(input.description) ?? null }),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new InventoryCatalogError("VERSION_CONFLICT");
        const value = await tx.inventoryItem.findFirstOrThrow({
          where: { id, companyId: context.companyId },
          include: { unitOfMeasure: true },
        });
        await this.audit(tx, context, "INVENTORY_ITEM_UPDATED", "INVENTORY_ITEM", id, {
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  deactivateItem(
    context: ActorContext,
    id: bigint,
    input: { version: number; reason: string },
  ) {
    return this.transactions.execute(
      { operation: "DEACTIVATE_INVENTORY_ITEM", companyId: context.companyId },
      async (tx) => {
        await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM inventory_items
          WHERE id = ${id} AND company_id = ${context.companyId}
          FOR UPDATE
        `;
        const current = await tx.inventoryItem.findFirst({
          where: { id, companyId: context.companyId },
        });
        if (!current) throw new InventoryCatalogError("NOT_FOUND");
        if (!current.isActive) throw new InventoryCatalogError("ITEM_INACTIVE");
        const stocked = await tx.inventoryBalance.findFirst({
          where: { companyId: context.companyId, inventoryItemId: id, onHand: { gt: 0 } },
          select: { id: true },
        });
        if (stocked) throw new InventoryCatalogError("ITEM_HAS_STOCK");
        const changed = await tx.inventoryItem.updateMany({
          where: { id, companyId: context.companyId, version: input.version, isActive: true },
          data: { isActive: false, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new InventoryCatalogError("VERSION_CONFLICT");
        const value = await tx.inventoryItem.findFirstOrThrow({
          where: { id, companyId: context.companyId },
          include: { unitOfMeasure: true },
        });
        await this.audit(tx, context, "INVENTORY_ITEM_DEACTIVATED", "INVENTORY_ITEM", id, {
          reason: input.reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  static unitJson(value: {
    id: bigint;
    code: string;
    nameAr: string;
    nameEn: string | null;
    decimalPlaces: number;
    isActive: boolean;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      decimalPlaces: value.decimalPlaces,
      isActive: value.isActive,
      version: value.version,
    };
  }

  static itemJson(value: {
    id: bigint;
    code: string;
    nameAr: string;
    nameEn: string | null;
    description: string | null;
    isActive: boolean;
    version: number;
    unitOfMeasure: Parameters<typeof InventoryCatalogService.unitJson>[0];
  }) {
    return {
      id: value.id.toString(),
      code: value.code,
      nameAr: value.nameAr,
      nameEn: value.nameEn,
      description: value.description,
      isActive: value.isActive,
      version: value.version,
      unitOfMeasure: InventoryCatalogService.unitJson(value.unitOfMeasure),
    };
  }

  private async requireActiveUnit(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    unitOfMeasureId: bigint,
  ) {
    const unit = await this.lockUnit(tx, companyId, unitOfMeasureId);
    if (!unit?.isActive) {
      throw new InventoryCatalogError("UNIT_INACTIVE");
    }
  }

  private async lockUnit(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    unitOfMeasureId: bigint,
  ) {
    const rows = await tx.$queryRaw<LockedUnit[]>`
      SELECT id
      FROM units_of_measure
      WHERE id = ${unitOfMeasureId}
        AND company_id = ${companyId}
      FOR UPDATE
    `;
    if (!rows[0]) return undefined;
    return tx.unitOfMeasure.findFirst({ where: { id: unitOfMeasureId, companyId } });
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: "UNIT_OF_MEASURE" | "INVENTORY_ITEM",
    id: bigint,
    details?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId: id.toString(),
        ...(details ? { details } : {}),
      },
    });
  }
}
