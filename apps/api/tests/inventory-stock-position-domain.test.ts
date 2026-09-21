import { describe, expect, it } from "vitest";
import {
  applyExternalStockEvent,
  buildExternalStockReversal,
  externalStockPositionKeyHash,
  validateExternalStockPositionDimensions,
  type ExternalStockProjection,
} from "../src/inventory/stock-position/stock-position-domain.js";

const heldByUs: ExternalStockProjection = {
  companyId: 1n,
  inventoryItemId: 10n,
  custodyPartyId: 20n,
  positionType: "THIRD_PARTY_HELD_BY_US",
  warehouseId: 30n,
  externalLocation: null,
  transitOrigin: null,
  transitDestination: null,
  quantity: "0.000000",
  inventoryValueBase: null,
};

const heldByThirdParty: ExternalStockProjection = {
  ...heldByUs,
  positionType: "OWNED_HELD_BY_THIRD_PARTY",
  warehouseId: null,
  externalLocation: "مستودع المتعهد - الرياض",
  quantity: "10.000000",
  inventoryValueBase: "250.0000",
};

describe("external stock position invariants", () => {
  it("keeps third-party stock out of owned valuation", () => {
    const next = applyExternalStockEvent(heldByUs, {
      eventType: "INCREASE",
      positionTypeSnapshot: "THIRD_PARTY_HELD_BY_US",
      idempotencyKey: "receipt-1",
      quantityDelta: "5",
      inventoryValueBaseDelta: null,
      sourceTypeSnapshot: "CUSTODY_RECEIPT",
      sourceReferenceSnapshot: "CR-001",
      reversalOfEventId: null,
    });

    expect(next.quantity).toBe("5.000000");
    expect(next.inventoryValueBase).toBeNull();
    expect(() =>
      applyExternalStockEvent(heldByUs, {
        eventType: "INCREASE",
        positionTypeSnapshot: "THIRD_PARTY_HELD_BY_US",
        idempotencyKey: "receipt-valued",
        quantityDelta: "1",
        inventoryValueBaseDelta: "10",
        sourceTypeSnapshot: "CUSTODY_RECEIPT",
        sourceReferenceSnapshot: "CR-002",
        reversalOfEventId: null,
      }),
    ).toThrow(/must not carry owned inventory value/);
  });

  it("requires explicit, non-conflicting dimensions for every position type", () => {
    expect(() =>
      validateExternalStockPositionDimensions({
        ...heldByUs,
        positionType: "OWNED_IN_TRANSIT",
        warehouseId: null,
        transitOrigin: "جدة",
        transitDestination: "جدة",
      }),
    ).toThrow(/must differ/);

    expect(() =>
      validateExternalStockPositionDimensions({
        ...heldByThirdParty,
        warehouseId: 30n,
      }),
    ).toThrow(/cannot reference our warehouse/);
  });

  it("uses a stable company-local dimension hash without including quantity", () => {
    const first = externalStockPositionKeyHash(heldByThirdParty);
    const { quantity: _quantity, inventoryValueBase: _inventoryValueBase, ...dimensions } = heldByThirdParty;
    const sameDimensions = externalStockPositionKeyHash(dimensions);
    const anotherParty = externalStockPositionKeyHash({ ...heldByThirdParty, custodyPartyId: 21n });

    expect(first).toHaveLength(64);
    expect(sameDimensions).toBe(first);
    expect(anotherParty).not.toBe(first);
  });

  it("applies owned quantity and value deltas exactly and rejects negative totals", () => {
    const next = applyExternalStockEvent(heldByThirdParty, {
      eventType: "DECREASE",
      positionTypeSnapshot: "OWNED_HELD_BY_THIRD_PARTY",
      idempotencyKey: "release-1",
      quantityDelta: "-2.5",
      inventoryValueBaseDelta: "-62.5",
      sourceTypeSnapshot: "CUSTODY_RELEASE",
      sourceReferenceSnapshot: "REL-001",
      reversalOfEventId: null,
    });

    expect(next.quantity).toBe("7.500000");
    expect(next.inventoryValueBase).toBe("187.5000");
    expect(() =>
      applyExternalStockEvent(heldByThirdParty, {
        eventType: "DECREASE",
        positionTypeSnapshot: "OWNED_HELD_BY_THIRD_PARTY",
        idempotencyKey: "release-too-much",
        quantityDelta: "-11",
        inventoryValueBaseDelta: "-251",
        sourceTypeSnapshot: "CUSTODY_RELEASE",
        sourceReferenceSnapshot: "REL-002",
        reversalOfEventId: null,
      }),
    ).toThrow(/quantity cannot become negative/);
  });

  it("creates an opposite append-only reversal event", () => {
    const reversal = buildExternalStockReversal(
      99n,
      {
        positionTypeSnapshot: "OWNED_HELD_BY_THIRD_PARTY",
        quantityDelta: "2.500000",
        inventoryValueBaseDelta: "62.5000",
      },
      {
        idempotencyKey: "reverse-99",
        sourceTypeSnapshot: "CORRECTION",
        sourceReferenceSnapshot: "COR-099",
      },
    );

    expect(reversal).toMatchObject({
      eventType: "REVERSAL",
      reversalOfEventId: 99n,
      quantityDelta: "-2.500000",
      inventoryValueBaseDelta: "-62.5000",
    });
  });
});
