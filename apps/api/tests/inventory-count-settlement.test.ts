import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  InventoryMovementError,
  InventoryMovementService,
  type InventoryMovementInput,
} from "../src/inventory/inventory-movement-service.js";

const context = { companyId: 7n, userId: 11n };

type SessionFixture = {
  id: bigint;
  companyId: bigint;
  warehouseId: bigint;
  status: "APPROVED" | "DRAFT";
  version: number;
  snapshotAt: Date;
  lines: Array<{
    inventoryItemId: bigint;
    countedQuantity: Prisma.Decimal | null;
    varianceQuantity: Prisma.Decimal;
    varianceReason: string | null;
    bookUnitCostBase: Prisma.Decimal;
  }>;
};

const approvedSession = (overrides: Partial<SessionFixture> = {}): SessionFixture => ({
  id: 90n,
  companyId: context.companyId,
  warehouseId: 3n,
  status: "APPROVED",
  version: 2,
  snapshotAt: new Date("2026-09-22T08:00:00.000Z"),
  lines: [
    {
      inventoryItemId: 101n,
      countedQuantity: new Prisma.Decimal(15),
      varianceQuantity: new Prisma.Decimal(5),
      varianceReason: "UNRECORDED_RECEIPT",
      bookUnitCostBase: new Prisma.Decimal(2.5),
    },
    {
      inventoryItemId: 102n,
      countedQuantity: new Prisma.Decimal(7),
      varianceQuantity: new Prisma.Decimal(-3),
      varianceReason: "DAMAGED",
      bookUnitCostBase: new Prisma.Decimal(4),
    },
  ],
  ...overrides,
});

const movementRecord = (id: bigint, input: InventoryMovementInput) => ({
  id,
  movementNumber: `IMV-${id.toString()}`,
  movementType: input.movementType,
  movementDate: new Date(`${input.movementDate}T00:00:00.000Z`),
  description: input.description,
  externalReference: input.externalReference ?? null,
  sourceType: null,
  sourceId: null,
  sourceEvent: null,
  sourceDocumentNumberSnapshot: null,
  status: "POSTED" as const,
  version: 0,
  createdAt: new Date("2026-09-22T09:00:00.000Z"),
  createdBy: { displayName: "مختص المخزون" },
  accountingDocument: null,
  offsetAccount: null,
  reversalOfMovement: null,
  reversedByMovement: null,
  lines: [],
});

function fixture(session: SessionFixture, laterMovement: { id: bigint } | null = null) {
  const createdInputs: InventoryMovementInput[] = [];
  const update = vi.fn().mockResolvedValue({
    id: session.id,
    status: "SETTLED",
    version: session.version + 1,
    settlementDate: new Date("2026-09-22T00:00:00.000Z"),
  });
  const auditCreate = vi.fn().mockResolvedValue({ id: 1n });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: session.id }]),
    stockCountSession: {
      findFirst: vi.fn().mockResolvedValue(session),
      update,
    },
    inventoryMovement: { findFirst: vi.fn().mockResolvedValue(laterMovement) },
    auditLog: { create: auditCreate },
    organizationAuditLog: { create: vi.fn() },
  };
  const service = Object.create(InventoryMovementService.prototype) as InventoryMovementService;
  Object.assign(service as unknown as Record<string, unknown>, {
    commands: {
      execute: vi.fn(async (_options: unknown, work: (value: typeof tx) => unknown) => work(tx)),
    },
    createAccountedManualMovement: vi.fn(async (
      _tx: typeof tx,
      _context: typeof context,
      input: InventoryMovementInput,
    ) => {
      createdInputs.push(input);
      return movementRecord(BigInt(700 + createdInputs.length), input);
    }),
  });
  return { service, tx, createdInputs, update, auditCreate };
}

describe("inventory count settlement", () => {
  it("posts one inbound and one outbound adjustment, then marks the count settled", async () => {
    const setup = fixture(approvedSession());

    const result = await setup.service.settleApprovedCount(context, 90n, {
      expectedVersion: 2,
      settlementDate: "2026-09-22",
    }, "settle-count-90");

    expect(setup.createdInputs).toEqual([
      {
        movementType: "ADJUSTMENT_IN",
        movementDate: "2026-09-22",
        description: "تسوية فروقات جلسة الجرد 90",
        externalReference: "STOCK_COUNT:90:SURPLUS",
        lines: [{
          inventoryItemId: 101n,
          toWarehouseId: 3n,
          quantity: "5.000000",
          unitCostBase: "2.50000000",
        }],
      },
      {
        movementType: "ADJUSTMENT_OUT",
        movementDate: "2026-09-22",
        description: "تسوية فروقات جلسة الجرد 90",
        externalReference: "STOCK_COUNT:90:SHORTAGE",
        lines: [{ inventoryItemId: 102n, fromWarehouseId: 3n, quantity: "3.000000" }],
      },
    ]);
    expect(setup.update).toHaveBeenCalledWith({
      where: { id: 90n },
      data: expect.objectContaining({
        status: "SETTLED",
        surplusMovementId: 701n,
        shortageMovementId: 702n,
        settledById: context.userId,
        version: { increment: 1 },
      }),
    });
    expect(setup.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: context.companyId,
      action: "STOCK_COUNT_SETTLED",
      entityId: "90",
      details: { surplusMovementId: "701", shortageMovementId: "702" },
    }) });
    expect(result).toMatchObject({
      sessionId: "90",
      status: "SETTLED",
      version: 3,
      surplusMovement: { id: "701", movementType: "ADJUSTMENT_IN" },
      shortageMovement: { id: "702", movementType: "ADJUSTMENT_OUT" },
    });
  });

  it("uses an explicitly supplied surplus cost when the snapshot has no valued cost", async () => {
    const session = approvedSession({
      lines: [{
        inventoryItemId: 103n,
        countedQuantity: new Prisma.Decimal(2),
        varianceQuantity: new Prisma.Decimal(2),
        varianceReason: "BOOK_ERROR",
        bookUnitCostBase: new Prisma.Decimal(0),
      }],
    });
    const setup = fixture(session);

    await setup.service.settleApprovedCount(context, 90n, {
      expectedVersion: 2,
      settlementDate: "2026-09-22",
      surplusUnitCosts: { "103": "8.75000000" },
    }, "settle-count-90-cost");

    expect(setup.createdInputs[0]?.lines[0]).toMatchObject({
      inventoryItemId: 103n,
      quantity: "2.000000",
      unitCostBase: "8.75000000",
    });
  });

  it("does not finalize the session when either accounting movement fails", async () => {
    const setup = fixture(approvedSession());
    const failingCreator = vi.fn(async (
      _tx: typeof setup.tx,
      _context: typeof context,
      input: InventoryMovementInput,
    ) => {
      setup.createdInputs.push(input);
      if (input.movementType === "ADJUSTMENT_OUT") throw new Error("posting failed");
      return movementRecord(701n, input);
    });
    Object.assign(setup.service as unknown as Record<string, unknown>, {
      createAccountedManualMovement: failingCreator,
    });

    await expect(setup.service.settleApprovedCount(context, 90n, {
      expectedVersion: 2,
      settlementDate: "2026-09-22",
    }, "settle-count-90-failed-posting")).rejects.toThrow("posting failed");

    expect(failingCreator).toHaveBeenCalledTimes(2);
    expect(failingCreator.mock.calls[0]?.[0]).toBe(setup.tx);
    expect(failingCreator.mock.calls[1]?.[0]).toBe(setup.tx);
    expect(setup.update).not.toHaveBeenCalled();
    expect(setup.auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["rejects a non-approved session", approvedSession({ status: "DRAFT" }), null, 2, "INVALID_STATE"],
    ["rejects a stale session version", approvedSession(), null, 1, "VERSION_CONFLICT"],
    ["rejects settlement after later stock movement", approvedSession(), { id: 999n }, 2, "COUNT_MOVED_SINCE_SNAPSHOT"],
    ["requires a cost for an unvalued surplus", approvedSession({
      lines: [{
        inventoryItemId: 103n,
        countedQuantity: new Prisma.Decimal(2),
        varianceQuantity: new Prisma.Decimal(2),
        varianceReason: "BOOK_ERROR",
        bookUnitCostBase: new Prisma.Decimal(0),
      }],
    }), null, 2, "MISSING_SURPLUS_COST"],
    ["rejects an unexplained variance", approvedSession({
      lines: [{
        inventoryItemId: 103n,
        countedQuantity: new Prisma.Decimal(2),
        varianceQuantity: new Prisma.Decimal(2),
        varianceReason: null,
        bookUnitCostBase: new Prisma.Decimal(1),
      }],
    }), null, 2, "INVALID_STATE"],
  ] as const)("%s without partially posting a movement", async (_name, session, laterMovement, expectedVersion, reason) => {
    const setup = fixture(session, laterMovement);

    await expect(setup.service.settleApprovedCount(context, 90n, {
      expectedVersion,
      settlementDate: "2026-09-22",
    }, `rejected-${reason}`)).rejects.toEqual(new InventoryMovementError(reason));

    expect(setup.createdInputs).toEqual([]);
    expect(setup.update).not.toHaveBeenCalled();
    expect(setup.auditCreate).not.toHaveBeenCalled();
  });
});
