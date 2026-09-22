import { Prisma } from "@prisma/client";
import type { ActorContext } from "../../platform/actor-context.js";
import {
  classifyInventoryAge,
  inventoryAgeDays,
  validateInventoryAgingPolicy,
} from "./inventory-aging-calculator.js";
import type {
  InventoryAgingPolicy,
  InventoryAgingReportPort,
  InventoryAgingRow,
} from "./types.js";

const key = (itemId: bigint, warehouseId: bigint) => `${itemId}:${warehouseId}`;
const dateDay = (value: Date) => value.toISOString().slice(0, 10);

export class InventoryAgingReportService {
  constructor(private readonly port: InventoryAgingReportPort) {}

  async generate(
    context: ActorContext,
    input: InventoryAgingPolicy & { asOf: Date },
  ) {
    validateInventoryAgingPolicy(input);
    if (Number.isNaN(input.asOf.getTime())) throw new Error("INVALID_INVENTORY_AGING_AS_OF");

    const balances = await this.port.listPositiveBalances(context.companyId);
    const movementFacts = await this.port.listMovementFacts(context.companyId, input.asOf, balances);
    const latestMovementByBalance = new Map<string, Date>();

    for (const fact of movementFacts) {
      for (const warehouseId of [fact.fromWarehouseId, fact.toWarehouseId]) {
        if (warehouseId === null) continue;
        const balanceKey = key(fact.inventoryItemId, warehouseId);
        const current = latestMovementByBalance.get(balanceKey);
        if (!current || fact.movementDate > current) {
          latestMovementByBalance.set(balanceKey, fact.movementDate);
        }
      }
    }

    let valuedInventoryTotalBase = new Prisma.Decimal(0);
    let unvaluedBalanceCount = 0;
    const classificationTotals = {
      ACTIVE: { balanceCount: 0, valuedInventoryValueBase: new Prisma.Decimal(0) },
      SLOW_MOVING: { balanceCount: 0, valuedInventoryValueBase: new Prisma.Decimal(0) },
      STAGNANT: { balanceCount: 0, valuedInventoryValueBase: new Prisma.Decimal(0) },
      NO_MOVEMENT: { balanceCount: 0, valuedInventoryValueBase: new Prisma.Decimal(0) },
    };
    const rows: InventoryAgingRow[] = balances.map((balance) => {
      const lastMovementDate = latestMovementByBalance.get(
        key(balance.inventoryItemId, balance.warehouseId),
      ) ?? null;
      const ageDays = lastMovementDate ? inventoryAgeDays(input.asOf, lastMovementDate) : null;
      const isValued = balance.isValuationInitialized;
      const classification = classifyInventoryAge(ageDays, input);
      classificationTotals[classification].balanceCount += 1;
      if (isValued) {
        valuedInventoryTotalBase = valuedInventoryTotalBase.plus(balance.inventoryValueBase);
        classificationTotals[classification].valuedInventoryValueBase = classificationTotals[classification].valuedInventoryValueBase.plus(balance.inventoryValueBase);
      } else {
        unvaluedBalanceCount += 1;
      }

      return {
        ...balance,
        onHand: new Prisma.Decimal(balance.onHand).toFixed(6),
        balanceId: balance.balanceId.toString(),
        inventoryItemId: balance.inventoryItemId.toString(),
        warehouseId: balance.warehouseId.toString(),
        lastMovementDate: lastMovementDate ? dateDay(lastMovementDate) : null,
        ageDays,
        classification,
        averageUnitCostBase: isValued ? new Prisma.Decimal(balance.averageUnitCostBase).toFixed(8) : null,
        inventoryValueBase: isValued ? new Prisma.Decimal(balance.inventoryValueBase).toFixed(4) : null,
        valuationWarning: isValued ? null : "UNVALUED_BALANCE_EXCLUDED_FROM_TOTALS",
      };
    });

    return {
      asOf: dateDay(input.asOf),
      policy: {
        slowMovingDays: input.slowMovingDays,
        stagnantDays: input.stagnantDays,
      },
      rows,
      summary: {
        balanceCount: rows.length,
        unvaluedBalanceCount,
        valuedInventoryTotalBase: valuedInventoryTotalBase.toFixed(4),
        classificationTotals: {
          ACTIVE: { balanceCount: classificationTotals.ACTIVE.balanceCount, valuedInventoryValueBase: classificationTotals.ACTIVE.valuedInventoryValueBase.toFixed(4) },
          SLOW_MOVING: { balanceCount: classificationTotals.SLOW_MOVING.balanceCount, valuedInventoryValueBase: classificationTotals.SLOW_MOVING.valuedInventoryValueBase.toFixed(4) },
          STAGNANT: { balanceCount: classificationTotals.STAGNANT.balanceCount, valuedInventoryValueBase: classificationTotals.STAGNANT.valuedInventoryValueBase.toFixed(4) },
          NO_MOVEMENT: { balanceCount: classificationTotals.NO_MOVEMENT.balanceCount, valuedInventoryValueBase: classificationTotals.NO_MOVEMENT.valuedInventoryValueBase.toFixed(4) },
        },
      },
    };
  }
}
