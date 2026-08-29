import { Prisma, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import {
  BarcodeCodecError,
  encodeBarcode,
  normalizeBarcodeLookup,
  type BarcodeCodecErrorReason,
  type InventoryBarcodeSymbology,
} from "./barcode-codec.js";

export type InventoryBarcodeErrorReason =
  | BarcodeCodecErrorReason
  | "INVENTORY_ITEM_NOT_FOUND"
  | "INVENTORY_ITEM_INACTIVE"
  | "BARCODE_NOT_FOUND"
  | "BARCODE_INACTIVE"
  | "BARCODE_ALREADY_EXISTS"
  | "VERSION_CONFLICT"
  | "INVALID_PAGINATION"
  | "INVALID_BATCH_SIZE"
  | "INVALID_DEACTIVATION_REASON";

export class InventoryBarcodeError extends Error {
  constructor(public readonly reason: InventoryBarcodeErrorReason) {
    super(reason);
  }
}

export type CreateInventoryBarcodeInput = {
  symbology: InventoryBarcodeSymbology;
  value: string;
  isPrimary?: boolean | undefined;
};

export type UpdateInventoryBarcodeInput = {
  version: number;
  symbology?: InventoryBarcodeSymbology | undefined;
  value?: string | undefined;
};

export type ResolveInventoryBarcodeInput = {
  value: string;
  symbology?: InventoryBarcodeSymbology | undefined;
};

export type ResolveInventoryBarcodeBatchEntry = ResolveInventoryBarcodeInput & {
  clientReference?: string | undefined;
};

const resolutionSelect = {
  id: true,
  symbology: true,
  normalizedValue: true,
  isPrimary: true,
  isActive: true,
  inventoryItem: {
    select: {
      id: true,
      code: true,
      nameAr: true,
      nameEn: true,
      description: true,
      isActive: true,
      unitOfMeasure: {
        select: {
          id: true,
          code: true,
          nameAr: true,
          decimalPlaces: true,
        },
      },
    },
  },
} satisfies Prisma.InventoryItemBarcodeSelect;

type ResolutionRecord = Prisma.InventoryItemBarcodeGetPayload<{
  select: typeof resolutionSelect;
}>;

export type ResolvedInventoryBarcode = ReturnType<
  typeof InventoryBarcodeService.resolutionJson
>;

export type ResolveInventoryBarcodeBatchResult =
  | {
      index: number;
      clientReference?: string | undefined;
      status: "RESOLVED";
      data: ResolvedInventoryBarcode;
    }
  | {
      index: number;
      clientReference?: string | undefined;
      status: "UNRESOLVED";
      reason:
        | BarcodeCodecErrorReason
        | "BARCODE_NOT_FOUND"
        | "BARCODE_INACTIVE"
        | "INVENTORY_ITEM_INACTIVE";
    };

export interface InventoryBarcodeResolverPort {
  resolveBarcode(
    context: ActorContext,
    input: ResolveInventoryBarcodeInput,
  ): Promise<ResolvedInventoryBarcode>;
  resolveBarcodeBatch(
    context: ActorContext,
    entries: ResolveInventoryBarcodeBatchEntry[],
  ): Promise<ResolveInventoryBarcodeBatchResult[]>;
}

type LockedRow = { id: bigint };

const isUniqueConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

function mapCodecError(error: unknown): never {
  if (error instanceof BarcodeCodecError) {
    throw new InventoryBarcodeError(error.reason);
  }
  throw error;
}

function normalizedForLookup(input: ResolveInventoryBarcodeInput) {
  try {
    return normalizeBarcodeLookup(input.value, input.symbology);
  } catch (error) {
    return mapCodecError(error);
  }
}

export class InventoryBarcodeService implements InventoryBarcodeResolverPort {
  static readonly MAX_BATCH_SIZE = 100;
  private readonly transactions: TransactionExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
  }

  async listBarcodes(
    context: ActorContext,
    inventoryItemId: bigint,
    input: {
      page: number;
      pageSize: number;
      active?: boolean | undefined;
    },
  ) {
    if (
      !Number.isInteger(input.page)
      || input.page < 1
      || !Number.isInteger(input.pageSize)
      || input.pageSize < 1
      || input.pageSize > 100
    ) {
      throw new InventoryBarcodeError("INVALID_PAGINATION");
    }
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, companyId: context.companyId },
      select: { id: true },
    });
    if (!item) throw new InventoryBarcodeError("INVENTORY_ITEM_NOT_FOUND");
    const where: Prisma.InventoryItemBarcodeWhereInput = {
      companyId: context.companyId,
      inventoryItemId,
      ...(input.active === undefined ? {} : { isActive: input.active }),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.inventoryItemBarcode.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.inventoryItemBarcode.count({ where }),
    }));
  }

  async createBarcode(
    context: ActorContext,
    inventoryItemId: bigint,
    input: CreateInventoryBarcodeInput,
  ) {
    let encoded: ReturnType<typeof encodeBarcode>;
    try {
      encoded = encodeBarcode(input.symbology, input.value);
    } catch (error) {
      return mapCodecError(error);
    }
    return await this.runUniqueMapped(
      this.transactions.execute(
        { operation: "CREATE_INVENTORY_ITEM_BARCODE", companyId: context.companyId },
        async (tx) => {
          await this.requireActiveItem(tx, context.companyId, inventoryItemId);
          const priorPrimary = input.isPrimary
            ? await tx.inventoryItemBarcode.findFirst({
                where: {
                  companyId: context.companyId,
                  inventoryItemId,
                  isPrimary: true,
                },
                select: { id: true },
              })
            : null;
          if (priorPrimary) {
            await this.lockBarcodeIds(
              tx,
              context.companyId,
              inventoryItemId,
              [priorPrimary.id],
            );
            await tx.inventoryItemBarcode.updateMany({
              where: {
                id: priorPrimary.id,
                companyId: context.companyId,
                inventoryItemId,
                isPrimary: true,
              },
              data: {
                isPrimary: false,
                primaryInventoryItemId: null,
                version: { increment: 1 },
              },
            });
          }
          const value = await tx.inventoryItemBarcode.create({
            data: {
              companyId: context.companyId,
              inventoryItemId,
              symbology: encoded.symbology,
              value: encoded.value,
              normalizedValue: encoded.normalizedValue,
              isPrimary: input.isPrimary ?? false,
              primaryInventoryItemId: input.isPrimary ? inventoryItemId : null,
            },
          });
          await this.audit(tx, context, "INVENTORY_ITEM_BARCODE_CREATED", value.id, {
            inventoryItemId: inventoryItemId.toString(),
            symbology: value.symbology,
            isPrimary: value.isPrimary,
            version: value.version,
          });
          if (input.isPrimary) {
            await this.audit(
              tx,
              context,
              "INVENTORY_ITEM_BARCODE_PRIMARY_CHANGED",
              value.id,
              {
                inventoryItemId: inventoryItemId.toString(),
                previousPrimaryBarcodeId: priorPrimary?.id.toString() ?? null,
                fromVersion: null,
                toVersion: value.version,
              },
            );
          }
          return value;
        },
      ),
    );
  }

  updateBarcode(
    context: ActorContext,
    inventoryItemId: bigint,
    barcodeId: bigint,
    input: UpdateInventoryBarcodeInput,
  ) {
    return this.runUniqueMapped(
      this.transactions.execute(
        { operation: "UPDATE_INVENTORY_ITEM_BARCODE", companyId: context.companyId },
        async (tx) => {
          await this.requireActiveItem(tx, context.companyId, inventoryItemId);
          await this.lockBarcodeIds(tx, context.companyId, inventoryItemId, [barcodeId]);
          const current = await tx.inventoryItemBarcode.findFirst({
            where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
          });
          if (!current) throw new InventoryBarcodeError("BARCODE_NOT_FOUND");
          if (!current.isActive) throw new InventoryBarcodeError("BARCODE_INACTIVE");
          let encoded: ReturnType<typeof encodeBarcode>;
          try {
            encoded = encodeBarcode(
              input.symbology ?? current.symbology,
              input.value ?? current.value,
            );
          } catch (error) {
            return mapCodecError(error);
          }
          const changed = await tx.inventoryItemBarcode.updateMany({
            where: {
              id: barcodeId,
              companyId: context.companyId,
              inventoryItemId,
              isActive: true,
              version: input.version,
            },
            data: {
              symbology: encoded.symbology,
              value: encoded.value,
              normalizedValue: encoded.normalizedValue,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new InventoryBarcodeError("VERSION_CONFLICT");
          const value = await tx.inventoryItemBarcode.findFirstOrThrow({
            where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
          });
          await this.audit(tx, context, "INVENTORY_ITEM_BARCODE_UPDATED", barcodeId, {
            inventoryItemId: inventoryItemId.toString(),
            symbology: value.symbology,
            fromVersion: input.version,
            toVersion: value.version,
          });
          return value;
        },
      ),
    );
  }

  setPrimaryBarcode(
    context: ActorContext,
    inventoryItemId: bigint,
    barcodeId: bigint,
    input: { version: number },
  ) {
    return this.runUniqueMapped(
      this.transactions.execute(
        { operation: "SET_PRIMARY_INVENTORY_ITEM_BARCODE", companyId: context.companyId },
        async (tx) => {
          await this.requireActiveItem(tx, context.companyId, inventoryItemId);
          const target = await tx.inventoryItemBarcode.findFirst({
            where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
          });
          const priorPrimary = await tx.inventoryItemBarcode.findFirst({
            where: { companyId: context.companyId, inventoryItemId, isPrimary: true },
            select: { id: true },
          });
          if (!target) throw new InventoryBarcodeError("BARCODE_NOT_FOUND");
          await this.lockBarcodeIds(
            tx,
            context.companyId,
            inventoryItemId,
            [target.id, ...(priorPrimary ? [priorPrimary.id] : [])],
          );
          const lockedTarget = await tx.inventoryItemBarcode.findFirst({
            where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
          });
          if (!lockedTarget) throw new InventoryBarcodeError("BARCODE_NOT_FOUND");
          if (!lockedTarget.isActive) throw new InventoryBarcodeError("BARCODE_INACTIVE");
          if (lockedTarget.version !== input.version) {
            throw new InventoryBarcodeError("VERSION_CONFLICT");
          }
          if (lockedTarget.isPrimary) return lockedTarget;
          if (priorPrimary && priorPrimary.id !== lockedTarget.id) {
            await tx.inventoryItemBarcode.updateMany({
              where: {
                id: priorPrimary.id,
                companyId: context.companyId,
                inventoryItemId,
                isPrimary: true,
              },
              data: {
                isPrimary: false,
                primaryInventoryItemId: null,
                version: { increment: 1 },
              },
            });
          }
          const changed = await tx.inventoryItemBarcode.updateMany({
            where: {
              id: lockedTarget.id,
              companyId: context.companyId,
              inventoryItemId,
              isActive: true,
              isPrimary: false,
              version: input.version,
            },
            data: {
              isPrimary: true,
              primaryInventoryItemId: inventoryItemId,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new InventoryBarcodeError("VERSION_CONFLICT");
          const value = await tx.inventoryItemBarcode.findFirstOrThrow({
            where: { id: lockedTarget.id, companyId: context.companyId, inventoryItemId },
          });
          await this.audit(
            tx,
            context,
            "INVENTORY_ITEM_BARCODE_PRIMARY_CHANGED",
            lockedTarget.id,
            {
              inventoryItemId: inventoryItemId.toString(),
              previousPrimaryBarcodeId: priorPrimary?.id.toString() ?? null,
              fromVersion: input.version,
              toVersion: value.version,
            },
          );
          return value;
        },
      ),
    );
  }

  deactivateBarcode(
    context: ActorContext,
    inventoryItemId: bigint,
    barcodeId: bigint,
    input: { version: number; reason: string },
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      return Promise.reject(new InventoryBarcodeError("INVALID_DEACTIVATION_REASON"));
    }
    return this.transactions.execute(
      { operation: "DEACTIVATE_INVENTORY_ITEM_BARCODE", companyId: context.companyId },
      async (tx) => {
        await this.requireActiveItem(tx, context.companyId, inventoryItemId);
        await this.lockBarcodeIds(tx, context.companyId, inventoryItemId, [barcodeId]);
        const current = await tx.inventoryItemBarcode.findFirst({
          where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
        });
        if (!current) throw new InventoryBarcodeError("BARCODE_NOT_FOUND");
        if (!current.isActive) throw new InventoryBarcodeError("BARCODE_INACTIVE");
        const changed = await tx.inventoryItemBarcode.updateMany({
          where: {
            id: barcodeId,
            companyId: context.companyId,
            inventoryItemId,
            isActive: true,
            version: input.version,
          },
          data: {
            isActive: false,
            isPrimary: false,
            primaryInventoryItemId: null,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new InventoryBarcodeError("VERSION_CONFLICT");
        const value = await tx.inventoryItemBarcode.findFirstOrThrow({
          where: { id: barcodeId, companyId: context.companyId, inventoryItemId },
        });
        await this.audit(tx, context, "INVENTORY_ITEM_BARCODE_DEACTIVATED", barcodeId, {
          inventoryItemId: inventoryItemId.toString(),
          symbology: value.symbology,
          wasPrimary: current.isPrimary,
          reason,
          fromVersion: input.version,
          toVersion: value.version,
        });
        return value;
      },
    );
  }

  async resolveBarcode(
    context: ActorContext,
    input: ResolveInventoryBarcodeInput,
  ): Promise<ResolvedInventoryBarcode> {
    const normalizedValue = normalizedForLookup(input);
    const value = await this.prisma.inventoryItemBarcode.findFirst({
      where: { companyId: context.companyId, normalizedValue },
      select: resolutionSelect,
    });
    if (!value) throw new InventoryBarcodeError("BARCODE_NOT_FOUND");
    return this.requireResolvable(value);
  }

  async resolveBarcodeBatch(
    context: ActorContext,
    entries: ResolveInventoryBarcodeBatchEntry[],
  ): Promise<ResolveInventoryBarcodeBatchResult[]> {
    if (entries.length < 1 || entries.length > InventoryBarcodeService.MAX_BATCH_SIZE) {
      throw new InventoryBarcodeError("INVALID_BATCH_SIZE");
    }
    const prepared = entries.map((entry, index) => {
      try {
        return {
          index,
          clientReference: entry.clientReference,
          normalizedValue: normalizeBarcodeLookup(entry.value, entry.symbology),
        } as const;
      } catch (error) {
        if (!(error instanceof BarcodeCodecError)) throw error;
        return {
          index,
          clientReference: entry.clientReference,
          reason: error.reason,
        } as const;
      }
    });
    const normalizedValues = [...new Set(
      prepared.flatMap((entry) => "normalizedValue" in entry ? [entry.normalizedValue] : []),
    )];
    const values = normalizedValues.length === 0
      ? []
      : await this.prisma.inventoryItemBarcode.findMany({
          where: {
            companyId: context.companyId,
            normalizedValue: { in: normalizedValues },
          },
          select: resolutionSelect,
        });
    const byNormalizedValue = new Map(
      values.map((value) => [value.normalizedValue, value]),
    );
    return prepared.map((entry): ResolveInventoryBarcodeBatchResult => {
      const identity = {
        index: entry.index,
        ...(entry.clientReference === undefined
          ? {}
          : { clientReference: entry.clientReference }),
      };
      if ("reason" in entry) {
        return { ...identity, status: "UNRESOLVED", reason: entry.reason };
      }
      const value = byNormalizedValue.get(entry.normalizedValue);
      if (!value) {
        return { ...identity, status: "UNRESOLVED", reason: "BARCODE_NOT_FOUND" };
      }
      if (!value.isActive) {
        return { ...identity, status: "UNRESOLVED", reason: "BARCODE_INACTIVE" };
      }
      if (!value.inventoryItem.isActive) {
        return { ...identity, status: "UNRESOLVED", reason: "INVENTORY_ITEM_INACTIVE" };
      }
      return { ...identity, status: "RESOLVED", data: InventoryBarcodeService.resolutionJson(value) };
    });
  }

  static barcodeJson(value: {
    id: bigint;
    inventoryItemId: bigint;
    symbology: InventoryBarcodeSymbology;
    value: string;
    isPrimary: boolean;
    isActive: boolean;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      inventoryItemId: value.inventoryItemId.toString(),
      symbology: value.symbology,
      value: value.value,
      isPrimary: value.isPrimary,
      isActive: value.isActive,
      version: value.version,
    };
  }

  static resolutionJson(value: ResolutionRecord) {
    return {
      barcode: {
        id: value.id.toString(),
        symbology: value.symbology,
        isPrimary: value.isPrimary,
      },
      inventoryItem: {
        id: value.inventoryItem.id.toString(),
        code: value.inventoryItem.code,
        nameAr: value.inventoryItem.nameAr,
        nameEn: value.inventoryItem.nameEn,
        description: value.inventoryItem.description,
        unitOfMeasure: {
          id: value.inventoryItem.unitOfMeasure.id.toString(),
          code: value.inventoryItem.unitOfMeasure.code,
          nameAr: value.inventoryItem.unitOfMeasure.nameAr,
          decimalPlaces: value.inventoryItem.unitOfMeasure.decimalPlaces,
        },
      },
    };
  }

  private requireResolvable(value: ResolutionRecord) {
    if (!value.isActive) throw new InventoryBarcodeError("BARCODE_INACTIVE");
    if (!value.inventoryItem.isActive) {
      throw new InventoryBarcodeError("INVENTORY_ITEM_INACTIVE");
    }
    return InventoryBarcodeService.resolutionJson(value);
  }

  private async requireActiveItem(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    inventoryItemId: bigint,
  ) {
    const locked = await tx.$queryRaw<LockedRow[]>`
      SELECT id
      FROM inventory_items
      WHERE id = ${inventoryItemId}
        AND company_id = ${companyId}
      FOR UPDATE
    `;
    if (!locked[0]) throw new InventoryBarcodeError("INVENTORY_ITEM_NOT_FOUND");
    const item = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, companyId },
      select: { isActive: true },
    });
    if (!item) throw new InventoryBarcodeError("INVENTORY_ITEM_NOT_FOUND");
    if (!item.isActive) throw new InventoryBarcodeError("INVENTORY_ITEM_INACTIVE");
  }

  private async lockBarcodeIds(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    inventoryItemId: bigint,
    ids: bigint[],
  ) {
    const orderedIds = [...new Set(ids)].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    if (orderedIds.length === 0) return;
    await tx.$queryRaw<LockedRow[]>(Prisma.sql`
      SELECT id
      FROM inventory_item_barcodes
      WHERE company_id = ${companyId}
        AND inventory_item_id = ${inventoryItemId}
        AND id IN (${Prisma.join(orderedIds)})
      ORDER BY id
      FOR UPDATE
    `);
  }

  private async runUniqueMapped<T>(work: Promise<T>) {
    try {
      return await work;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new InventoryBarcodeError("BARCODE_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    id: bigint,
    details: Prisma.InputJsonObject,
  ) {
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "INVENTORY_ITEM_BARCODE",
        entityId: id.toString(),
        details,
      },
    });
  }
}
