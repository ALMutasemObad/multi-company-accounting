import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PayableItemService } from "../src/payables/payable-item-service.js";
import { ReceivableItemService } from "../src/receivables/receivable-item-service.js";

const errors = () => ({
  invalid: () => new Error("INVALID"),
  overAllocation: () => new Error("OVER_ALLOCATION"),
  conflict: () => new Error("CONFLICT"),
});

describe("settlement item application ports", () => {
  it("rejects receivable and payable targets outside the selected company", async () => {
    const receivableTx = {
      receivableItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const payableTx = {
      payableItem: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await expect(new ReceivableItemService().validateDraftTargets(
      receivableTx as unknown as Prisma.TransactionClient,
      {
        companyId: 1n,
        customerId: 2n,
        currencyId: 3n,
        allocations: [{ receivableItemId: 99n, allocatedAmount: "10.0000" }],
        errors: errors(),
      },
    )).rejects.toThrow("INVALID");
    await expect(new PayableItemService().validateDraftTargets(
      payableTx as unknown as Prisma.TransactionClient,
      {
        companyId: 1n,
        supplierId: 2n,
        currencyId: 3n,
        allocations: [{ payableItemId: 99n, allocatedAmount: "10.0000" }],
        errors: errors(),
      },
    )).rejects.toThrow("INVALID");

    expect(receivableTx.receivableItem.findMany).toHaveBeenCalledWith({
      where: { companyId: 1n, id: { in: [99n] } },
      orderBy: { id: "asc" },
    });
    expect(payableTx.payableItem.findMany).toHaveBeenCalledWith({
      where: { companyId: 1n, id: { in: [99n] } },
      orderBy: { id: "asc" },
    });
  });

  it("materializes receipt settlement with optimistic versioning", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 10n }]),
      receivableItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 10n,
          companyId: 1n,
          customerId: 2n,
          currencyId: 3n,
          originalAmount: new Prisma.Decimal("100.0000"),
          outstandingAmount: new Prisma.Decimal("100.0000"),
          originalBaseAmount: new Prisma.Decimal("130.0000"),
          outstandingBaseAmount: new Prisma.Decimal("130.0000"),
          status: "OPEN",
          version: 0,
        }]),
        updateMany,
      },
    };

    const allocations = await new ReceivableItemService().applyReceipt(
      tx as unknown as Prisma.TransactionClient,
      {
        companyId: 1n,
        customerId: 2n,
        currencyId: 3n,
        allocations: [{ receivableItemId: 10n, allocatedAmount: "40.0000" }],
        errors: errors(),
      },
    );

    const call = updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 10n, companyId: 1n, version: 0, status: "OPEN" });
    expect(call.data.outstandingAmount.toFixed(4)).toBe("60.0000");
    expect(call.data.outstandingBaseAmount.toFixed(4)).toBe("78.0000");
    expect(call.data.status).toBe("PARTIAL");
    expect(call.data.version).toEqual({ increment: 1 });
    expect(allocations[0]!.carryingBaseAmount.toFixed(4)).toBe("52.0000");
  });

  it("consumes and restores the exact payable carrying-value residual", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn()
      .mockResolvedValueOnce([{
        id: 20n,
        companyId: 1n,
        supplierId: 2n,
        currencyId: 3n,
        originalAmount: new Prisma.Decimal("100.0000"),
        outstandingAmount: new Prisma.Decimal("60.0000"),
        originalBaseAmount: new Prisma.Decimal("130.0000"),
        outstandingBaseAmount: new Prisma.Decimal("77.9999"),
        status: "PARTIAL",
        version: 4,
      }])
      .mockResolvedValueOnce([{
        id: 20n,
        companyId: 1n,
        supplierId: 2n,
        currencyId: 3n,
        originalAmount: new Prisma.Decimal("100.0000"),
        outstandingAmount: new Prisma.Decimal("0.0000"),
        originalBaseAmount: new Prisma.Decimal("130.0000"),
        outstandingBaseAmount: new Prisma.Decimal("0.0000"),
        status: "SETTLED",
        version: 5,
      }]);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 20n }]),
      payableItem: { findMany, updateMany },
    };
    const service = new PayableItemService();
    const command = {
      companyId: 1n,
      supplierId: 2n,
      currencyId: 3n,
      allocations: [{ payableItemId: 20n, allocatedAmount: "60.0000" }],
      errors: errors(),
    };

    const applied = await service.applyPayment(
      tx as unknown as Prisma.TransactionClient,
      command,
    );
    expect(applied[0]!.carryingBaseAmount.toFixed(4)).toBe("77.9999");
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({ status: "SETTLED" });
    expect(updateMany.mock.calls[0]![0].data.outstandingBaseAmount.toFixed(4)).toBe("0.0000");

    await service.reversePayment(
      tx as unknown as Prisma.TransactionClient,
      {
        ...command,
        allocations: [{
          ...command.allocations[0]!,
          carryingBaseAmount: applied[0]!.carryingBaseAmount,
        }],
      },
    );
    expect(updateMany.mock.calls[1]![0].data.outstandingAmount.toFixed(4)).toBe("60.0000");
    expect(updateMany.mock.calls[1]![0].data.outstandingBaseAmount.toFixed(4)).toBe("77.9999");
    expect(updateMany.mock.calls[1]![0].data.status).toBe("PARTIAL");
  });

  it("initializes rolling-upgrade settlement sentinels under the owner row lock", async () => {
    const receivableUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const receivableTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 30n }]),
      salesInvoice: {
        findFirst: vi.fn().mockResolvedValue({ baseTotal: new Prisma.Decimal("130.0000") }),
      },
      receivableItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 30n,
          companyId: 1n,
          salesInvoiceId: 300n,
          customerId: 2n,
          currencyId: 3n,
          originalAmount: new Prisma.Decimal("100.0000"),
          outstandingAmount: new Prisma.Decimal("40.0000"),
          originalBaseAmount: new Prisma.Decimal("0.0000"),
          outstandingBaseAmount: new Prisma.Decimal("0.0000"),
          status: "PARTIAL",
          version: 3,
        }]),
        updateMany: receivableUpdate,
      },
    };
    const receipt = await new ReceivableItemService().applyReceipt(
      receivableTx as unknown as Prisma.TransactionClient,
      {
        companyId: 1n,
        customerId: 2n,
        currencyId: 3n,
        allocations: [{ receivableItemId: 30n, allocatedAmount: "10.0000" }],
        errors: errors(),
      },
    );
    expect(receivableUpdate.mock.calls[0]![0].where).toMatchObject({
      id: 30n,
      version: 3,
    });
    expect(receivableUpdate.mock.calls[0]![0].data.originalBaseAmount.toFixed(4)).toBe("130.0000");
    expect(receivableUpdate.mock.calls[0]![0].data.outstandingBaseAmount.toFixed(4)).toBe("52.0000");
    expect(receivableUpdate.mock.calls[1]![0].where).toMatchObject({ version: 4, status: "PARTIAL" });
    expect(receivableUpdate.mock.calls[1]![0].data.outstandingBaseAmount.toFixed(4)).toBe("39.0000");
    expect(receipt[0]!.carryingBaseAmount.toFixed(4)).toBe("13.0000");

    const payableUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const payableTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 40n }]),
      purchaseInvoice: {
        findFirst: vi.fn().mockResolvedValue({ baseTotal: new Prisma.Decimal("120.0000") }),
      },
      payableItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 40n,
          companyId: 1n,
          purchaseInvoiceId: 400n,
          supplierId: 2n,
          currencyId: 3n,
          originalAmount: new Prisma.Decimal("100.0000"),
          outstandingAmount: new Prisma.Decimal("25.0000"),
          originalBaseAmount: new Prisma.Decimal("0.0000"),
          outstandingBaseAmount: new Prisma.Decimal("0.0000"),
          status: "PARTIAL",
          version: 7,
        }]),
        updateMany: payableUpdate,
      },
    };
    const payment = await new PayableItemService().applyPayment(
      payableTx as unknown as Prisma.TransactionClient,
      {
        companyId: 1n,
        supplierId: 2n,
        currencyId: 3n,
        allocations: [{ payableItemId: 40n, allocatedAmount: "5.0000" }],
        errors: errors(),
      },
    );
    expect(payableUpdate.mock.calls[0]![0].data.originalBaseAmount.toFixed(4)).toBe("120.0000");
    expect(payableUpdate.mock.calls[0]![0].data.outstandingBaseAmount.toFixed(4)).toBe("30.0000");
    expect(payableUpdate.mock.calls[1]![0].where).toMatchObject({ version: 8, status: "PARTIAL" });
    expect(payableUpdate.mock.calls[1]![0].data.outstandingBaseAmount.toFixed(4)).toBe("24.0000");
    expect(payment[0]!.carryingBaseAmount.toFixed(4)).toBe("6.0000");
  });
});
