import { createHash } from "node:crypto";

export const EXTERNAL_STOCK_POSITION_TYPES = [
  "THIRD_PARTY_HELD_BY_US",
  "OWNED_HELD_BY_THIRD_PARTY",
  "OWNED_IN_TRANSIT",
] as const;

export type ExternalStockPositionType = (typeof EXTERNAL_STOCK_POSITION_TYPES)[number];

export type ExternalStockPositionDimensions = {
  companyId: bigint;
  inventoryItemId: bigint;
  custodyPartyId: bigint;
  positionType: ExternalStockPositionType;
  warehouseId: bigint | null;
  externalLocation: string | null;
  transitOrigin: string | null;
  transitDestination: string | null;
};

export type ExternalStockProjection = ExternalStockPositionDimensions & {
  quantity: string;
  inventoryValueBase: string | null;
};

export type ExternalStockEventInput = {
  eventType: "INCREASE" | "DECREASE" | "REVALUATION" | "REVERSAL";
  positionTypeSnapshot: ExternalStockPositionType;
  idempotencyKey: string;
  quantityDelta: string;
  inventoryValueBaseDelta: string | null;
  sourceTypeSnapshot: string;
  sourceReferenceSnapshot: string;
  reversalOfEventId: bigint | null;
};

const QUANTITY_SCALE = 6;
const VALUE_SCALE = 4;

function requiredText(value: string | null, field: string): string {
  const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function absent(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function parseDecimal(value: string, scale: number, field: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`${field} must be a decimal number`);
  const fraction = match[3] ?? "";
  if (fraction.length > scale) throw new Error(`${field} exceeds ${scale} decimal places`);
  const magnitude = BigInt(match[2]!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = magnitude / factor;
  const fraction = (magnitude % factor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function validateExternalStockPositionDimensions(
  dimensions: ExternalStockPositionDimensions,
): ExternalStockPositionDimensions {
  if (dimensions.companyId <= 0n || dimensions.inventoryItemId <= 0n || dimensions.custodyPartyId <= 0n) {
    throw new Error("company, item and custody party identifiers must be positive");
  }

  if (dimensions.positionType === "THIRD_PARTY_HELD_BY_US") {
    if (!dimensions.warehouseId || dimensions.warehouseId <= 0n) throw new Error("warehouse is required");
    if (!absent(dimensions.externalLocation) || !absent(dimensions.transitOrigin) || !absent(dimensions.transitDestination)) {
      throw new Error("third-party stock held by us cannot have an external or transit location");
    }
  } else if (dimensions.positionType === "OWNED_HELD_BY_THIRD_PARTY") {
    if (dimensions.warehouseId !== null) throw new Error("owned stock held by a third party cannot reference our warehouse");
    requiredText(dimensions.externalLocation, "externalLocation");
    if (!absent(dimensions.transitOrigin) || !absent(dimensions.transitDestination)) {
      throw new Error("owned stock held by a third party cannot have a transit route");
    }
  } else {
    if (dimensions.warehouseId !== null || !absent(dimensions.externalLocation)) {
      throw new Error("stock in transit cannot reference a warehouse or external holding location");
    }
    const origin = requiredText(dimensions.transitOrigin, "transitOrigin");
    const destination = requiredText(dimensions.transitDestination, "transitDestination");
    if (origin.localeCompare(destination, undefined, { sensitivity: "accent" }) === 0) {
      throw new Error("transit origin and destination must differ");
    }
  }

  return dimensions;
}

export function externalStockPositionKeyHash(dimensions: ExternalStockPositionDimensions): string {
  validateExternalStockPositionDimensions(dimensions);
  const parts = [
    dimensions.positionType,
    dimensions.inventoryItemId.toString(),
    dimensions.custodyPartyId.toString(),
    dimensions.warehouseId?.toString() ?? "-",
    dimensions.externalLocation ? requiredText(dimensions.externalLocation, "externalLocation").toLocaleLowerCase() : "-",
    dimensions.transitOrigin ? requiredText(dimensions.transitOrigin, "transitOrigin").toLocaleLowerCase() : "-",
    dimensions.transitDestination
      ? requiredText(dimensions.transitDestination, "transitDestination").toLocaleLowerCase()
      : "-",
  ];
  return createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
}

export function applyExternalStockEvent(
  current: ExternalStockProjection,
  event: ExternalStockEventInput,
): ExternalStockProjection {
  validateExternalStockPositionDimensions(current);
  if (event.positionTypeSnapshot !== current.positionType) throw new Error("event position type does not match projection");
  requiredText(event.idempotencyKey, "idempotencyKey");
  requiredText(event.sourceTypeSnapshot, "sourceTypeSnapshot");
  requiredText(event.sourceReferenceSnapshot, "sourceReferenceSnapshot");

  const quantity = parseDecimal(current.quantity, QUANTITY_SCALE, "quantity");
  const quantityDelta = parseDecimal(event.quantityDelta, QUANTITY_SCALE, "quantityDelta");
  const isThirdPartyOwned = current.positionType === "THIRD_PARTY_HELD_BY_US";
  const value = current.inventoryValueBase === null ? null : parseDecimal(current.inventoryValueBase, VALUE_SCALE, "inventoryValueBase");
  const valueDelta =
    event.inventoryValueBaseDelta === null
      ? null
      : parseDecimal(event.inventoryValueBaseDelta, VALUE_SCALE, "inventoryValueBaseDelta");

  if (isThirdPartyOwned) {
    if (value !== null || valueDelta !== null) throw new Error("third-party owned stock must not carry owned inventory value");
  } else if (value === null || valueDelta === null) {
    throw new Error("owned external stock requires base inventory value and value delta");
  }

  if (event.eventType === "INCREASE" && (quantityDelta <= 0n || (valueDelta !== null && valueDelta < 0n))) {
    throw new Error("increase requires a positive quantity and non-negative value delta");
  }
  if (event.eventType === "DECREASE" && (quantityDelta >= 0n || (valueDelta !== null && valueDelta > 0n))) {
    throw new Error("decrease requires a negative quantity and non-positive value delta");
  }
  if (event.eventType === "REVALUATION" && (quantityDelta !== 0n || valueDelta === null || valueDelta === 0n)) {
    throw new Error("revaluation requires only a non-zero value delta");
  }
  if (event.eventType === "REVERSAL") {
    if (event.reversalOfEventId === null || (quantityDelta === 0n && (valueDelta === null || valueDelta === 0n))) {
      throw new Error("reversal requires an original event and a non-zero delta");
    }
  } else if (event.reversalOfEventId !== null) {
    throw new Error("only a reversal may reference an original event");
  }

  const nextQuantity = quantity + quantityDelta;
  if (nextQuantity < 0n) throw new Error("external stock quantity cannot become negative");
  const nextValue = value === null ? null : value + (valueDelta ?? 0n);
  if (nextValue !== null && nextValue < 0n) throw new Error("external stock value cannot become negative");

  return {
    ...current,
    quantity: formatDecimal(nextQuantity, QUANTITY_SCALE),
    inventoryValueBase: nextValue === null ? null : formatDecimal(nextValue, VALUE_SCALE),
  };
}

export function buildExternalStockReversal(
  originalEventId: bigint,
  original: Omit<ExternalStockEventInput, "eventType" | "reversalOfEventId" | "idempotencyKey" | "sourceTypeSnapshot" | "sourceReferenceSnapshot">,
  audit: Pick<ExternalStockEventInput, "idempotencyKey" | "sourceTypeSnapshot" | "sourceReferenceSnapshot">,
): ExternalStockEventInput {
  if (originalEventId <= 0n) throw new Error("original event identifier must be positive");
  const quantityDelta = -parseDecimal(original.quantityDelta, QUANTITY_SCALE, "quantityDelta");
  const valueDelta =
    original.inventoryValueBaseDelta === null
      ? null
      : -parseDecimal(original.inventoryValueBaseDelta, VALUE_SCALE, "inventoryValueBaseDelta");
  return {
    ...audit,
    eventType: "REVERSAL",
    positionTypeSnapshot: original.positionTypeSnapshot,
    quantityDelta: formatDecimal(quantityDelta, QUANTITY_SCALE),
    inventoryValueBaseDelta: valueDelta === null ? null : formatDecimal(valueDelta, VALUE_SCALE),
    reversalOfEventId: originalEventId,
  };
}
