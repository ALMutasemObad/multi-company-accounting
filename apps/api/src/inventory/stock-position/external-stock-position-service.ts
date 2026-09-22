import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../../platform/actor-context.js";
import {
  applyExternalStockEvent,
  buildExternalStockReversal,
  externalStockPositionKeyHash,
  validateExternalStockPositionDimensions,
  type ExternalStockPositionDimensions,
  type ExternalStockPositionType,
} from "./stock-position-domain.js";

export type ExternalStockPositionErrorReason =
  | "NOT_FOUND"
  | "INVALID_REFERENCE"
  | "INVALID_INPUT"
  | "DUPLICATE_CODE"
  | "IDEMPOTENCY_MISMATCH"
  | "ALREADY_REVERSED"
  | "NOT_LATEST_EVENT"
  | "VERSION_CONFLICT";

export class ExternalStockPositionError extends Error {
  constructor(public readonly reason: ExternalStockPositionErrorReason) {
    super(reason);
  }
}

export type RecordExternalStockInput = {
  positionId?: bigint | undefined;
  positionType?: ExternalStockPositionType | undefined;
  inventoryItemId?: bigint | undefined;
  custodyPartyId?: bigint | undefined;
  warehouseId?: bigint | null | undefined;
  externalLocation?: string | null | undefined;
  transitOrigin?: string | null | undefined;
  transitDestination?: string | null | undefined;
  eventType: "INCREASE" | "DECREASE";
  quantity: string;
  inventoryValueBase: string | null;
  sourceReference: string;
  effectiveDate: string;
};

const positionInclude = {
  inventoryItem: {
    include: {
      unitOfMeasure: true,
      barcodes: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }], take: 1 },
    },
  },
  custodyParty: true,
  warehouse: true,
  events: {
    orderBy: [{ id: "desc" as const }],
    take: 1,
    include: { reversedByEvent: { select: { id: true } } },
  },
} satisfies Prisma.ExternalStockPositionInclude;

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
  return normalized || null;
}

function dateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new ExternalStockPositionError("INVALID_INPUT");
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new ExternalStockPositionError("INVALID_INPUT");
  }
  return result;
}

function eventJson(event: {
  id: bigint;
  eventType: string;
  effectiveDate: Date;
  sourceReferenceSnapshot: string;
  reversedByEvent?: { id: bigint } | null;
}) {
  return {
    id: event.id.toString(),
    eventType: event.eventType,
    effectiveDate: event.effectiveDate.toISOString().slice(0, 10),
    sourceReference: event.sourceReferenceSnapshot,
    reversed: Boolean(event.reversedByEvent),
  };
}

function positionJson(position: Prisma.ExternalStockPositionGetPayload<{ include: typeof positionInclude }>) {
  return {
    id: position.id.toString(),
    positionType: position.positionType,
    quantity: position.quantity.toFixed(6),
    inventoryValueBase: position.inventoryValueBase?.toFixed(4) ?? null,
    version: position.version,
    externalLocation: position.externalLocation,
    transitOrigin: position.transitOrigin,
    transitDestination: position.transitDestination,
    item: {
      id: position.inventoryItem.id.toString(),
      code: position.inventoryItem.barcodes[0]?.value ?? "—",
      nameAr: position.inventoryItem.nameAr,
      nameEn: position.inventoryItem.nameEn,
      unitCode: position.inventoryItem.unitOfMeasure.code,
    },
    party: {
      id: position.custodyParty.id.toString(),
      code: position.custodyParty.code,
      nameAr: position.custodyParty.nameAr,
      nameEn: position.custodyParty.nameEn,
      isActive: position.custodyParty.isActive,
    },
    warehouse: position.warehouse
      ? { id: position.warehouse.id.toString(), code: position.warehouse.code, nameAr: position.warehouse.nameAr }
      : null,
    lastEvent: position.events[0] ? eventJson(position.events[0]) : null,
  };
}

export class ExternalStockPositionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listParties(context: ActorContext) {
    const rows = await this.prisma.externalInventoryParty.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ isActive: "desc" }, { nameAr: "asc" }],
    });
    return rows.map((party) => ({
      id: party.id.toString(),
      code: party.code,
      nameAr: party.nameAr,
      nameEn: party.nameEn,
      isActive: party.isActive,
    }));
  }

  async createParty(context: ActorContext, input: { code: string; nameAr: string; nameEn?: string | null | undefined }) {
    const code = input.code.trim().toUpperCase();
    const nameAr = normalizedText(input.nameAr);
    if (!code || !nameAr) throw new ExternalStockPositionError("INVALID_INPUT");
    try {
      const party = await this.prisma.externalInventoryParty.create({
        data: {
          companyId: context.companyId,
          code,
          nameAr,
          nameEn: normalizedText(input.nameEn),
        },
      });
      return { id: party.id.toString(), code: party.code, nameAr: party.nameAr, nameEn: party.nameEn, isActive: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ExternalStockPositionError("DUPLICATE_CODE");
      }
      throw error;
    }
  }

  async listPositions(context: ActorContext, input: { positionType?: ExternalStockPositionType | undefined; includeZero?: boolean | undefined }) {
    const rows = await this.prisma.externalStockPosition.findMany({
      where: {
        companyId: context.companyId,
        ...(input.positionType ? { positionType: input.positionType } : {}),
        ...(!input.includeZero ? { quantity: { gt: 0 } } : {}),
      },
      include: positionInclude,
      orderBy: [{ positionType: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(positionJson);
  }

  async recordEvent(context: ActorContext, input: RecordExternalStockInput, idempotencyKey: string) {
    const key = idempotencyKey.trim();
    const sourceReference = normalizedText(input.sourceReference);
    if (key.length < 8 || key.length > 100 || !sourceReference) throw new ExternalStockPositionError("INVALID_INPUT");
    const effectiveDate = dateOnly(input.effectiveDate);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.externalStockPositionEvent.findFirst({
          where: { companyId: context.companyId, idempotencyKey: key },
          include: { externalStockPosition: { include: positionInclude } },
        });
        if (replay) {
          const expectedQuantity = input.eventType === "DECREASE" ? new Prisma.Decimal(input.quantity).negated() : new Prisma.Decimal(input.quantity);
          const expectedValue = input.inventoryValueBase === null
            ? null
            : input.eventType === "DECREASE"
              ? new Prisma.Decimal(input.inventoryValueBase).negated()
              : new Prisma.Decimal(input.inventoryValueBase);
          if (
            replay.eventType !== input.eventType ||
            !replay.quantityDelta.equals(expectedQuantity) ||
            (replay.inventoryValueBaseDelta === null) !== (expectedValue === null) ||
            (replay.inventoryValueBaseDelta && expectedValue && !replay.inventoryValueBaseDelta.equals(expectedValue)) ||
            replay.sourceReferenceSnapshot !== sourceReference ||
            replay.effectiveDate.toISOString().slice(0, 10) !== input.effectiveDate
          ) throw new ExternalStockPositionError("IDEMPOTENCY_MISMATCH");
          return positionJson(replay.externalStockPosition);
        }

        let position = input.positionId
          ? await tx.externalStockPosition.findFirst({ where: { id: input.positionId, companyId: context.companyId } })
          : null;
        if (!position) {
          if (input.positionId || input.eventType !== "INCREASE" || !input.positionType || !input.inventoryItemId || !input.custodyPartyId) {
            throw new ExternalStockPositionError("NOT_FOUND");
          }
          const dimensions: ExternalStockPositionDimensions = validateExternalStockPositionDimensions({
            companyId: context.companyId,
            inventoryItemId: input.inventoryItemId,
            custodyPartyId: input.custodyPartyId,
            positionType: input.positionType,
            warehouseId: input.warehouseId ?? null,
            externalLocation: normalizedText(input.externalLocation),
            transitOrigin: normalizedText(input.transitOrigin),
            transitDestination: normalizedText(input.transitDestination),
          });
          const [item, party, warehouse] = await Promise.all([
            tx.inventoryItem.findFirst({ where: { id: dimensions.inventoryItemId, companyId: context.companyId, isActive: true }, select: { id: true } }),
            tx.externalInventoryParty.findFirst({ where: { id: dimensions.custodyPartyId, companyId: context.companyId, isActive: true }, select: { id: true } }),
            dimensions.warehouseId
              ? tx.warehouse.findFirst({ where: { id: dimensions.warehouseId, companyId: context.companyId, isActive: true }, select: { id: true } })
              : Promise.resolve({ id: 0n }),
          ]);
          if (!item || !party || !warehouse) throw new ExternalStockPositionError("INVALID_REFERENCE");
          position = await tx.externalStockPosition.upsert({
            where: { companyId_positionKeyHash: { companyId: context.companyId, positionKeyHash: externalStockPositionKeyHash(dimensions) } },
            create: {
              ...dimensions,
              positionKeyHash: externalStockPositionKeyHash(dimensions),
              quantity: new Prisma.Decimal(0),
              inventoryValueBase: dimensions.positionType === "THIRD_PARTY_HELD_BY_US" ? null : new Prisma.Decimal(0),
            },
            update: {},
          });
        }

        const quantityMagnitude = new Prisma.Decimal(input.quantity);
        const valueMagnitude = input.inventoryValueBase === null ? null : new Prisma.Decimal(input.inventoryValueBase);
        const quantityDelta = input.eventType === "DECREASE" ? quantityMagnitude.negated() : quantityMagnitude;
        const valueDelta = valueMagnitude === null ? null : input.eventType === "DECREASE" ? valueMagnitude.negated() : valueMagnitude;
        const next = applyExternalStockEvent({
          companyId: position.companyId,
          inventoryItemId: position.inventoryItemId,
          custodyPartyId: position.custodyPartyId,
          positionType: position.positionType,
          warehouseId: position.warehouseId,
          externalLocation: position.externalLocation,
          transitOrigin: position.transitOrigin,
          transitDestination: position.transitDestination,
          quantity: position.quantity.toFixed(6),
          inventoryValueBase: position.inventoryValueBase?.toFixed(4) ?? null,
        }, {
          eventType: input.eventType,
          positionTypeSnapshot: position.positionType,
          idempotencyKey: key,
          quantityDelta: quantityDelta.toFixed(6),
          inventoryValueBaseDelta: valueDelta?.toFixed(4) ?? null,
          sourceTypeSnapshot: "MANUAL_EXTERNAL_STOCK",
          sourceReferenceSnapshot: sourceReference,
          reversalOfEventId: null,
        });
        const event = await tx.externalStockPositionEvent.create({
          data: {
            companyId: context.companyId,
            externalStockPositionId: position.id,
            eventType: input.eventType,
            positionTypeSnapshot: position.positionType,
            idempotencyKey: key,
            quantityDelta,
            inventoryValueBaseDelta: valueDelta,
            sourceTypeSnapshot: "MANUAL_EXTERNAL_STOCK",
            sourceReferenceSnapshot: sourceReference,
            effectiveDate,
            createdById: context.userId,
          },
        });
        const updated = await tx.externalStockPosition.updateMany({
          where: { id: position.id, companyId: context.companyId, version: position.version },
          data: {
            quantity: new Prisma.Decimal(next.quantity),
            inventoryValueBase: next.inventoryValueBase === null ? null : new Prisma.Decimal(next.inventoryValueBase),
            lastEventAt: event.createdAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new ExternalStockPositionError("VERSION_CONFLICT");
        const result = await tx.externalStockPosition.findFirst({
          where: { id: position.id, companyId: context.companyId },
          include: positionInclude,
        });
        if (!result) throw new ExternalStockPositionError("NOT_FOUND");
        return positionJson(result);
      });
    } catch (error) {
      if (error instanceof ExternalStockPositionError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.prisma.externalStockPositionEvent.findFirst({
          where: { companyId: context.companyId, idempotencyKey: key },
          include: { externalStockPosition: { include: positionInclude } },
        });
        if (replay) return positionJson(replay.externalStockPosition);
      }
      if (error instanceof Error && /decimal|inventory|quantity|value|warehouse|location|transit/iu.test(error.message)) {
        throw new ExternalStockPositionError("INVALID_INPUT");
      }
      throw error;
    }
  }

  async reverseLatestEvent(context: ActorContext, eventId: bigint, idempotencyKey: string) {
    const key = idempotencyKey.trim();
    if (key.length < 8 || key.length > 100) throw new ExternalStockPositionError("INVALID_INPUT");
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.externalStockPositionEvent.findFirst({
        where: { companyId: context.companyId, idempotencyKey: key },
        include: { externalStockPosition: { include: positionInclude } },
      });
      if (replay) {
        if (replay.eventType !== "REVERSAL" || replay.reversalOfEventId !== eventId) {
          throw new ExternalStockPositionError("IDEMPOTENCY_MISMATCH");
        }
        return positionJson(replay.externalStockPosition);
      }
      const original = await tx.externalStockPositionEvent.findFirst({
        where: { id: eventId, companyId: context.companyId },
        include: { reversedByEvent: { select: { id: true } }, externalStockPosition: true },
      });
      if (!original) throw new ExternalStockPositionError("NOT_FOUND");
      if (original.reversedByEvent || original.eventType === "REVERSAL") throw new ExternalStockPositionError("ALREADY_REVERSED");
      const latest = await tx.externalStockPositionEvent.findFirst({
        where: { companyId: context.companyId, externalStockPositionId: original.externalStockPositionId },
        orderBy: [{ id: "desc" }],
        select: { id: true },
      });
      if (latest?.id !== original.id) throw new ExternalStockPositionError("NOT_LATEST_EVENT");
      const position = original.externalStockPosition;
      const reversal = buildExternalStockReversal(original.id, {
        positionTypeSnapshot: original.positionTypeSnapshot,
        quantityDelta: original.quantityDelta.toFixed(6),
        inventoryValueBaseDelta: original.inventoryValueBaseDelta?.toFixed(4) ?? null,
      }, {
        idempotencyKey: key,
        sourceTypeSnapshot: "MANUAL_EXTERNAL_STOCK_REVERSAL",
        sourceReferenceSnapshot: `REV-${original.sourceReferenceSnapshot}`.slice(0, 100),
      });
      const next = applyExternalStockEvent({
        companyId: position.companyId,
        inventoryItemId: position.inventoryItemId,
        custodyPartyId: position.custodyPartyId,
        positionType: position.positionType,
        warehouseId: position.warehouseId,
        externalLocation: position.externalLocation,
        transitOrigin: position.transitOrigin,
        transitDestination: position.transitDestination,
        quantity: position.quantity.toFixed(6),
        inventoryValueBase: position.inventoryValueBase?.toFixed(4) ?? null,
      }, reversal);
      const reversalEvent = await tx.externalStockPositionEvent.create({
        data: {
          companyId: context.companyId,
          externalStockPositionId: position.id,
          eventType: "REVERSAL",
          positionTypeSnapshot: position.positionType,
          idempotencyKey: key,
          quantityDelta: new Prisma.Decimal(reversal.quantityDelta),
          inventoryValueBaseDelta: reversal.inventoryValueBaseDelta === null ? null : new Prisma.Decimal(reversal.inventoryValueBaseDelta),
          sourceTypeSnapshot: reversal.sourceTypeSnapshot,
          sourceReferenceSnapshot: reversal.sourceReferenceSnapshot,
          effectiveDate: original.effectiveDate,
          reversalOfEventId: original.id,
          createdById: context.userId,
        },
      });
      const updated = await tx.externalStockPosition.updateMany({
        where: { id: position.id, companyId: context.companyId, version: position.version },
        data: {
          quantity: new Prisma.Decimal(next.quantity),
          inventoryValueBase: next.inventoryValueBase === null ? null : new Prisma.Decimal(next.inventoryValueBase),
          lastEventAt: reversalEvent.createdAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ExternalStockPositionError("VERSION_CONFLICT");
      const result = await tx.externalStockPosition.findFirst({
        where: { id: position.id, companyId: context.companyId },
        include: positionInclude,
      });
      if (!result) throw new ExternalStockPositionError("NOT_FOUND");
      return positionJson(result);
    });
  }
}
