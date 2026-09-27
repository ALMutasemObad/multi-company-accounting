import { describe, expect, it, vi } from "vitest";
import { InventoryCountError, InventoryCountService } from "../src/inventory/inventory-count/inventory-count-service.js";

const actor = { companyId: 7n, userId: 11n };
const isbn = "9786038291986";
const item = (id: bigint, issueNumber: string) => ({
  id, code: `ITM-${id}`, nameAr: "مجلة مشتركة", author: null, publisher: null,
  publicationIdentifier: isbn, issueNumber, periodicalYear: "السنة الثانية",
  publicationYear: 2025, unitOfMeasure: { code: "CPY" },
  barcodes: [{ value: `BK-${id}` }],
});

function fixture(exactTotal: number, items: ReturnType<typeof item>[], status: string | null = "DRAFT") {
  const inventoryItem = {
    count: vi.fn().mockResolvedValueOnce(exactTotal).mockResolvedValueOnce(items.length),
    findMany: vi.fn().mockResolvedValue(items),
  };
  const stockCountSession = { findFirst: vi.fn().mockResolvedValue(status ? { status } : null) };
  const stockCountLine = { findMany: vi.fn().mockResolvedValue([
    { inventoryItemId: 10n, countedQuantity: { toString: () => "250" } },
  ]) };
  const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
  Object.assign(service, { prisma: { inventoryItem, stockCountSession, stockCountLine } });
  return { service, inventoryItem, stockCountSession, stockCountLine };
}

describe("inventory count book lookup", () => {
  it("returns every active issue sharing an exact ISBN for the current company, with previous counts", async () => {
    const { service, inventoryItem, stockCountSession, stockCountLine } = fixture(2, [item(10n, "الأول"), item(11n, "الثاني")]);
    const result = await service.lookupItems(actor, 90n, isbn, 1);

    expect(result).toMatchObject({ total: 2, page: 1, data: [
      { id: "10", issueNumber: "الأول", countedQuantity: "250" },
      { id: "11", issueNumber: "الثاني", countedQuantity: null },
    ] });
    expect(stockCountSession.findFirst).toHaveBeenCalledWith({ where: { id: 90n, companyId: 7n }, select: { status: true } });
    const exactWhere = inventoryItem.count.mock.calls[0]?.[0]?.where;
    expect(exactWhere).toMatchObject({ companyId: 7n, isActive: true });
    expect(exactWhere.OR).toContainEqual({ publicationIdentifier: { in: [isbn] } });
    expect(stockCountLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 7n, sessionId: 90n }),
    }));
  });

  it("falls back to title search and keeps the results paginated", async () => {
    const { service, inventoryItem } = fixture(0, [item(11n, "الثاني")]);
    const result = await service.lookupItems(actor, 90n, "مجلة", 2);
    expect(result).toMatchObject({ total: 1, page: 2 });
    expect(inventoryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 7n, isActive: true }),
      skip: 50, take: 50,
    }));
  });

  it("does not search another company or a session that is no longer open", async () => {
    const missing = fixture(0, [], null);
    await expect(missing.service.lookupItems(actor, 90n, isbn, 1)).rejects.toMatchObject({ reason: "NOT_FOUND" } satisfies Partial<InventoryCountError>);
    expect(missing.inventoryItem.count).not.toHaveBeenCalled();
    const closed = fixture(0, [], "SUBMITTED");
    await expect(closed.service.lookupItems(actor, 90n, isbn, 1)).rejects.toMatchObject({ reason: "INVALID_STATE" } satisfies Partial<InventoryCountError>);
    expect(closed.inventoryItem.count).not.toHaveBeenCalled();
  });
});
