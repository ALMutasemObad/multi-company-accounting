import type { InventoryAgingClassification, InventoryAgingPolicy } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDateOnly(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function validateInventoryAgingPolicy(policy: InventoryAgingPolicy) {
  if (
    !Number.isInteger(policy.slowMovingDays) ||
    !Number.isInteger(policy.stagnantDays) ||
    policy.slowMovingDays < 1 ||
    policy.stagnantDays <= policy.slowMovingDays
  ) {
    throw new Error("INVALID_INVENTORY_AGING_POLICY");
  }
}

export function inventoryAgeDays(asOf: Date, lastMovementDate: Date) {
  return Math.max(0, Math.floor((utcDateOnly(asOf) - utcDateOnly(lastMovementDate)) / DAY_MS));
}

export function classifyInventoryAge(
  ageDays: number | null,
  policy: InventoryAgingPolicy,
): InventoryAgingClassification {
  validateInventoryAgingPolicy(policy);
  if (ageDays === null) return "NO_MOVEMENT";
  if (ageDays >= policy.stagnantDays) return "STAGNANT";
  if (ageDays >= policy.slowMovingDays) return "SLOW_MOVING";
  return "ACTIVE";
}

