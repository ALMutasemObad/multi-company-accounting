import { describe, expect, it } from "vitest";
import {
  canRefundElectronicPayment,
  isNavigableCheckoutUrl,
  ownerPaymentActions,
  paymentFromCommandResult,
  type ElectronicPayment,
} from "./electronic-payments";

const payment = (state: ElectronicPayment["state"], checkoutUrl: string | null = null): ElectronicPayment => ({
  id: "00000000-0000-4000-8000-000000000001",
  invoiceId: "00000000-0000-4000-8000-000000000002",
  invoiceNumber: "PLT-2026-1",
  state,
  provider: "LOCAL_SIGNED_DEV",
  environment: "TEST",
  currencyCode: "SAR",
  amount: "100.0000",
  amountMinor: "10000",
  checkoutUrl,
  version: 0,
  lastFailureCode: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
});

describe("electronic payment UI policy", () => {
  it("offers only safe owner actions for each lifecycle state", () => {
    expect(ownerPaymentActions(payment("CHECKOUT", "https://checkout.test/session"))).toEqual(["OPEN_CHECKOUT", "CANCEL"]);
    expect(ownerPaymentActions(payment("CHECKOUT"))).toEqual(["CANCEL"]);
    expect(ownerPaymentActions(payment("PENDING"))).toEqual(["CANCEL"]);
    expect(ownerPaymentActions(payment("FAILED"))).toEqual(["RETRY"]);
    expect(ownerPaymentActions(payment("CANCELLED"))).toEqual(["RETRY"]);
    expect(ownerPaymentActions(payment("PAID"))).toEqual([]);
    expect(ownerPaymentActions(payment("REFUNDED"))).toEqual([]);
  });

  it("keeps refund operator-only and limited to a settled payment", () => {
    expect(canRefundElectronicPayment("PAID")).toBe(true);
    expect(canRefundElectronicPayment("PENDING")).toBe(false);
    expect(canRefundElectronicPayment("REFUNDED")).toBe(false);
  });

  it("unwraps direct and enveloped command responses", () => {
    const settled = payment("PAID");
    expect(paymentFromCommandResult(settled)).toBe(settled);
    expect(paymentFromCommandResult({ payment: settled })).toBe(settled);
  });

  it("allows only HTTP checkout destinations", () => {
    expect(isNavigableCheckoutUrl("https://checkout.test/session")).toBe(true);
    expect(isNavigableCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isNavigableCheckoutUrl(null)).toBe(false);
  });
});
