import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { InventoryAccountUsageQueryAdapter } from "../src/inventory/inventory-account-usage-query-adapter.js";

describe("InventoryAccountUsageQueryAdapter", () => {
  it("returns the bounded immutable movement fact with company isolation", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const tx = { inventoryMovement: { count } } as unknown as Prisma.TransactionClient;

    await expect(new InventoryAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "INVENTORY_MOVEMENT_HISTORY", count: 3, hasImmutableHistory: true },
    ]);
    expect(count).toHaveBeenCalledWith({
      where: { companyId: 7n, offsetAccountId: 11n },
    });
  });

  it("reports no immutable history when the company-scoped count is zero", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const tx = { inventoryMovement: { count } } as unknown as Prisma.TransactionClient;

    await expect(new InventoryAccountUsageQueryAdapter().queryAccountUsage(tx, 88n, 11n)).resolves.toEqual([
      { category: "INVENTORY_MOVEMENT_HISTORY", count: 0, hasImmutableHistory: false },
    ]);
    expect(count).toHaveBeenCalledWith({
      where: { companyId: 88n, offsetAccountId: 11n },
    });
  });
});
