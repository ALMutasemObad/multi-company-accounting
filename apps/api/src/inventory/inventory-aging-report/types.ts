export type InventoryAgingClassification =
  | "ACTIVE"
  | "SLOW_MOVING"
  | "STAGNANT"
  | "NO_MOVEMENT";

export type InventoryAgingPolicy = {
  slowMovingDays: number;
  stagnantDays: number;
};

export type InventoryAgingBalance = {
  balanceId: bigint;
  inventoryItemId: bigint;
  itemCode: string;
  itemName: string;
  unitOfMeasureCode: string;
  warehouseId: bigint;
  warehouseCode: string;
  warehouseName: string;
  onHand: string;
  averageUnitCostBase: string;
  inventoryValueBase: string;
  isValuationInitialized: boolean;
};

export type InventoryAgingMovementFact = {
  inventoryItemId: bigint;
  fromWarehouseId: bigint | null;
  toWarehouseId: bigint | null;
  movementDate: Date;
};

export interface InventoryAgingReportPort {
  listPositiveBalances(companyId: bigint): Promise<InventoryAgingBalance[]>;
  listMovementFacts(
    companyId: bigint,
    asOf: Date,
    balances: ReadonlyArray<Pick<InventoryAgingBalance, "inventoryItemId" | "warehouseId">>,
  ): Promise<InventoryAgingMovementFact[]>;
}

export type InventoryAgingRow = Omit<
  InventoryAgingBalance,
  "balanceId" | "inventoryItemId" | "warehouseId" | "averageUnitCostBase" | "inventoryValueBase"
> & {
  balanceId: string;
  inventoryItemId: string;
  warehouseId: string;
  lastMovementDate: string | null;
  ageDays: number | null;
  classification: InventoryAgingClassification;
  averageUnitCostBase: string | null;
  inventoryValueBase: string | null;
  valuationWarning: "UNVALUED_BALANCE_EXCLUDED_FROM_TOTALS" | null;
};

