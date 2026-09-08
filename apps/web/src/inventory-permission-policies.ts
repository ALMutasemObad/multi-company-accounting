import type { PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const inventoryPermissionPolicies = {
  manageWarehouses: permission("warehouses.manage"),
  manageCatalog: permission("inventory_catalog.manage"),
  createMovement: permission("inventory_movements.create"),
  reverseMovement: permission("inventory_movements.reverse"),
} as const satisfies Record<string, PermissionPolicy>;
