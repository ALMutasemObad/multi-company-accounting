import { describe, expect, it } from "vitest";
import { allows } from "./authorization";
import { inventoryPermissionPolicies } from "./inventory-permission-policies";

describe("inventory permission policies", () => {
  it("matches the write permissions enforced by the inventory API", () => {
    expect(inventoryPermissionPolicies).toEqual({
      manageWarehouses: { permission: "warehouses.manage" },
      manageCatalog: { permission: "inventory_catalog.manage" },
      createMovement: { permission: "inventory_movements.create" },
      reverseMovement: { permission: "inventory_movements.reverse" },
    });
  });

  it("does not derive write access from inventory view permissions", () => {
    const viewOnly = new Set([
      "warehouses.view",
      "inventory_catalog.view",
      "inventory_movements.view",
    ]);

    expect(Object.values(inventoryPermissionPolicies).some((policy) => allows(viewOnly, policy))).toBe(false);
  });

  it.each([
    ["warehouses.manage", "manageWarehouses"],
    ["inventory_catalog.manage", "manageCatalog"],
    ["inventory_movements.create", "createMovement"],
    ["inventory_movements.reverse", "reverseMovement"],
  ] as const)("keeps %s independent", (permission, policyName) => {
    const granted = new Set([permission]);

    for (const [name, policy] of Object.entries(inventoryPermissionPolicies)) {
      expect(allows(granted, policy), name).toBe(name === policyName);
    }
  });

  it("uses movement creation for valuation initialization without granting reversal", () => {
    const creator = new Set(["inventory_movements.create"]);

    expect(allows(creator, inventoryPermissionPolicies.createMovement)).toBe(true);
    expect(allows(creator, inventoryPermissionPolicies.reverseMovement)).toBe(false);
  });
});
