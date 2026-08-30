import { allows, type PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const barcodePermissionPolicies = {
  view: permission("inventory_barcodes.view"),
  manage: permission("inventory_barcodes.manage"),
  resolve: permission("inventory_barcodes.resolve"),
  print: permission("inventory_barcodes.print"),
  posScan: {
    allOf: ["pos.checkout", "inventory_barcodes.resolve"],
  } as const satisfies PermissionPolicy,
} as const;

export const inventoryBarcodeSymbologies = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "CODE_128",
  "QR",
] as const;

export const POS_BARCODE_INITIAL_QUANTITY = "1.000000";
export const POS_BARCODE_QUEUE_LIMIT = 20;

export type QueuedBarcodeScan = { value: string; epoch: number };

export type BarcodeQueueAdmission =
  | { status: "enqueued"; queue: QueuedBarcodeScan[] }
  | { status: "empty"; queue: readonly QueuedBarcodeScan[] }
  | { status: "full"; queue: readonly QueuedBarcodeScan[] };

export function canViewInventoryBarcodes(permissions: ReadonlySet<string>) {
  return allows(permissions, barcodePermissionPolicies.view);
}

export function canManageInventoryBarcodes(permissions: ReadonlySet<string>) {
  return allows(permissions, barcodePermissionPolicies.manage);
}

export function canManageInventoryItemBarcodes(
  permissions: ReadonlySet<string>,
  itemIsActive: boolean,
) {
  return itemIsActive && canManageInventoryBarcodes(permissions);
}

export function canUsePosBarcodeScanner(permissions: ReadonlySet<string>) {
  return allows(permissions, barcodePermissionPolicies.posScan);
}

export function canUseInventoryBarcodeScanner(
  permissions: ReadonlySet<string>,
  operationPolicy: PermissionPolicy,
) {
  return allows(permissions, operationPolicy)
    && allows(permissions, barcodePermissionPolicies.resolve);
}

export function canPrintInventoryBarcode(
  permissions: ReadonlySet<string>,
  itemIsActive: boolean,
  barcodeIsActive: boolean,
) {
  return itemIsActive
    && barcodeIsActive
    && allows(permissions, barcodePermissionPolicies.print);
}

export function inventoryBarcodeLabelFilename(itemId: string, barcodeId: string) {
  const safeId = (value: string) => /^[1-9][0-9]*$/u.test(value) ? value : "unknown";
  return `inventory-barcode-${safeId(itemId)}-${safeId(barcodeId)}.png`;
}

export function appendBarcodeScanToQueue(
  current: readonly QueuedBarcodeScan[],
  rawValue: string,
  epoch: number,
  limit = POS_BARCODE_QUEUE_LIMIT,
): BarcodeQueueAdmission {
  const value = rawValue.trim();
  if (!value) return { status: "empty", queue: current };
  if (limit < 1 || current.length >= limit) return { status: "full", queue: current };
  return { status: "enqueued", queue: [...current, { value, epoch }] };
}

export function canApplyQueuedBarcodeScan(
  entry: QueuedBarcodeScan,
  currentEpoch: number,
  checkoutInProgress: boolean,
) {
  return entry.epoch === currentEpoch && !checkoutInProgress;
}

/** Adds one unit without converting the quantity to a floating-point number. */
export function incrementQuantityText(value: string) {
  const match = value.trim().match(/^(\d{1,13})(?:\.(\d{1,6}))?$/u);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const scaledValue = BigInt(match[1]) * scale + BigInt(fraction || "0");
  const incremented = scaledValue + scale;
  const integer = incremented / scale;
  if (integer.toString().length > 13) return null;
  if (!fraction) return integer.toString();
  const remainder = (incremented % scale).toString().padStart(fraction.length, "0");
  return `${integer}.${remainder}`;
}

export type PosBarcodeLine = {
  inventoryItemId: string;
  inventoryItemLabel: string;
  description: string;
  quantity: string;
};

export type PosBarcodeItem = {
  id: string;
  label: string;
  description: string;
};

export type PosBarcodeMergeResult<Line extends PosBarcodeLine> = {
  lines: Line[];
  status: BarcodeLineApplyStatus;
};

export type BarcodeLineApplyStatus =
  | "incremented"
  | "filled"
  | "appended"
  | "invalid-quantity"
  | "line-limit";

export function applyResolvedBarcodeToLines<Line extends PosBarcodeLine>(
  current: readonly Line[],
  item: PosBarcodeItem,
  createBlankLine: () => Line,
  maxLines?: number,
): PosBarcodeMergeResult<Line> {
  const existingIndex = current.findIndex((line) => line.inventoryItemId === item.id);
  if (existingIndex >= 0) {
    const quantity = incrementQuantityText(current[existingIndex].quantity);
    if (quantity === null) return { lines: [...current], status: "invalid-quantity" };
    return {
      lines: current.map((line, index) => index === existingIndex ? { ...line, quantity } : line),
      status: "incremented",
    };
  }

  const emptyIndex = current.findIndex((line) => !line.inventoryItemId);
  if (emptyIndex < 0 && maxLines !== undefined && current.length >= maxLines) {
    return { lines: [...current], status: "line-limit" };
  }
  const nextLine = {
    ...(emptyIndex >= 0 ? current[emptyIndex] : createBlankLine()),
    inventoryItemId: item.id,
    inventoryItemLabel: item.label,
    description: item.description,
    quantity: POS_BARCODE_INITIAL_QUANTITY,
  } as Line;
  if (emptyIndex >= 0) {
    return {
      lines: current.map((line, index) => index === emptyIndex ? nextLine : line),
      status: "filled",
    };
  }
  return { lines: [...current, nextLine], status: "appended" };
}
