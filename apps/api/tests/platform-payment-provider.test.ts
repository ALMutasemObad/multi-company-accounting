import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DevelopmentPaymentProviderAdapter } from "../src/platform-operations/payments/adapters/development-payment-provider-adapter.js";
import {
  fromPlatformPaymentMinorUnits,
  PlatformPaymentMoneyError,
  toPlatformPaymentMinorUnits,
} from "../src/platform-operations/payments/platform-payment-money.js";
import {
  PlatformPaymentWebhookVerificationError,
  type PlatformPaymentProviderEventType,
  type PlatformPaymentProviderPort,
  type PlatformPaymentWebhookVerificationFailure,
} from "../src/platform-operations/payments/platform-payment-provider-port.js";

const WEBHOOK_SECRET = "development-payment-webhook-secret-for-tests";
const NOW = new Date("2026-08-30T12:00:00.000Z");

const adapter = () => new DevelopmentPaymentProviderAdapter(
  WEBHOOK_SECRET,
  "https://app.example.test",
  300,
  () => NOW,
);

function signedBody(value: unknown, signatureTimestamp = NOW) {
  const rawBody = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  const timestampSeconds = Math.floor(signatureTimestamp.getTime() / 1_000);
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest("hex");
  return { rawBody, signature: `t=${timestampSeconds},v1=${signature}` };
}

function expectWebhookFailure(
  work: () => unknown,
  reason: PlatformPaymentWebhookVerificationFailure,
) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(PlatformPaymentWebhookVerificationError);
    expect((error as PlatformPaymentWebhookVerificationError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected webhook verification to fail with ${reason}`);
}

describe("platform payment minor-unit policy", () => {
  it.each([
    ["SAR", "1234.56", 123456n],
    ["USD", "9999999999999999.99", 999999999999999999n],
    ["YER", "42.07", 4207n],
  ] as const)("converts %s exactly without Number coercion or rounding", (currencyCode, amount, amountMinor) => {
    const converted = toPlatformPaymentMinorUnits(amount, currencyCode);

    expect(converted).toMatchObject({ currencyCode, exponent: 2, amountMinor });
    expect(converted.amount.toFixed(4)).toBe(`${amount}00`.slice(0, amount.includes(".") ? amount.indexOf(".") + 5 : undefined));
    expect(fromPlatformPaymentMinorUnits(amountMinor, currencyCode).toFixed(4))
      .toBe(converted.amount.toFixed(4));
  });

  it("normalizes supported currency codes while preserving exact minor units", () => {
    expect(toPlatformPaymentMinorUnits("1.23", "sar")).toMatchObject({
      currencyCode: "SAR",
      exponent: 2,
      amountMinor: 123n,
    });
  });

  it.each([
    ["1.00", "EUR", "UNSUPPORTED_CURRENCY"],
    ["1.001", "SAR", "AMOUNT_NOT_REPRESENTABLE_IN_MINOR_UNITS"],
    ["0", "SAR", "INVALID_AMOUNT"],
    ["-0.01", "USD", "INVALID_AMOUNT"],
    ["NaN", "YER", "INVALID_AMOUNT"],
    ["Infinity", "SAR", "INVALID_AMOUNT"],
  ] as const)("rejects amount %s in %s as %s", (amount, currencyCode, reason) => {
    try {
      toPlatformPaymentMinorUnits(amount, currencyCode);
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformPaymentMoneyError);
      expect((error as PlatformPaymentMoneyError).reason).toBe(reason);
      return;
    }
    throw new Error(`Expected ${reason}`);
  });
});

describe("development payment provider checkout", () => {
  it("identifies itself as a development-only provider", () => {
    expect(adapter()).toMatchObject({
      providerCode: "DEVELOPMENT_SIMULATOR",
      environment: "DEVELOPMENT",
    });
  });

  it("requires a non-trivial webhook secret", () => {
    expect(() => new DevelopmentPaymentProviderAdapter("too-short", "https://app.example.test"))
      .toThrow("at least 32 characters");
  });

  it("creates deterministic checkout identifiers and a bounded hosted URL without card data", async () => {
    const provider = adapter();
    const input = {
      merchantReference: "checkout/company 7/invoice?42",
      amountMinor: 12345n,
      currencyCode: "SAR",
      description: "Platform subscription invoice",
      returnUrl: "https://app.example.test/#subscription",
    };

    const first = await provider.createCheckout(input);
    const repeated = await provider.createCheckout(input);
    const other = await provider.createCheckout({ ...input, merchantReference: "checkout/company-7/invoice-43" });

    expect(repeated).toEqual(first);
    expect(first.providerCheckoutId).toMatch(/^dev_checkout_[a-f0-9]{40}$/u);
    expect(other.providerCheckoutId).not.toBe(first.providerCheckoutId);
    expect(first.checkoutUrl).toBe(
      "https://app.example.test/#subscription?developmentCheckout=checkout%2Fcompany%207%2Finvoice%3F42",
    );
    expect(first.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(first.checkoutUrl).not.toMatch(/(?:card|pan|cvv)=/iu);
  });

  it("returns deterministic development cancellation and refund behavior", async () => {
    const provider: PlatformPaymentProviderPort = adapter();
    await expect(provider.cancelCheckout({
      providerCheckoutId: "dev_checkout_123",
      merchantReference: "merchant-123",
    })).resolves.toEqual({ accepted: true });
    await expect(provider.requestFullRefund({
      providerPaymentId: "dev_payment_123",
      merchantReference: "merchant-123",
      amountMinor: 5000n,
      currencyCode: "SAR",
    })).resolves.toMatchObject({ providerRefundId: expect.stringMatching(/^dev_refund_[a-f0-9]{40}$/u) });
  });

  it("honors an aborted request before creating, cancelling, or refunding provider state", async () => {
    const provider = adapter();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.createCheckout({
      merchantReference: "merchant-aborted",
      amountMinor: 100n,
      currencyCode: "SAR",
      description: "Aborted checkout",
      returnUrl: "https://app.example.test/#subscription",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(provider.cancelCheckout({
      providerCheckoutId: "dev_checkout_aborted",
      merchantReference: "merchant-aborted",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(provider.requestFullRefund({
      providerPaymentId: "dev_payment_aborted",
      merchantReference: "merchant-aborted",
      amountMinor: 100n,
      currencyCode: "SAR",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("development payment provider webhook verification", () => {
  const occurredAt = new Date("2026-08-30T11:59:00.000Z");

  it.each([
    "PAYMENT_PENDING",
    "PAYMENT_PAID",
    "PAYMENT_FAILED",
    "PAYMENT_CANCELLED",
    "PAYMENT_REFUNDED",
  ] as const)("round-trips the signed %s event in the development environment", (eventType) => {
    const provider = adapter();
    const signed = provider.createSignedWebhook({
      providerEventId: `evt-${eventType}`,
      eventType,
      providerCheckoutId: "dev_checkout_123",
      providerPaymentId: eventType === "PAYMENT_PAID" || eventType === "PAYMENT_REFUNDED"
        ? "dev_payment_123"
        : null,
      providerRefundId: eventType === "PAYMENT_REFUNDED" ? "dev_refund_123" : null,
      amountMinor: 12345n,
      currencyCode: "SAR",
      occurredAt,
      signatureTimestamp: NOW,
    });

    expect(provider.verifyWebhook({ ...signed, receivedAt: NOW })).toEqual({
      providerEventId: `evt-${eventType}`,
      eventType,
      environment: "DEVELOPMENT",
      providerCheckoutId: "dev_checkout_123",
      providerPaymentId: eventType === "PAYMENT_PAID" || eventType === "PAYMENT_REFUNDED"
        ? "dev_payment_123"
        : null,
      providerRefundId: eventType === "PAYMENT_REFUNDED" ? "dev_refund_123" : null,
      amountMinor: 12345n,
      currencyCode: "SAR",
      occurredAt,
      signatureTimestamp: NOW,
    });
  });

  it("rejects a missing signature before parsing the payload", () => {
    expectWebhookFailure(() => adapter().verifyWebhook({
      rawBody: Buffer.from("not-json"),
      signature: undefined,
      receivedAt: NOW,
    }), "MISSING_SIGNATURE");
  });

  it.each([
    "",
    "v1=abc",
    "t=not-a-number,v1=0000000000000000000000000000000000000000000000000000000000000000",
    "t=1234567890123,v1=0000000000000000000000000000000000000000000000000000000000000000",
    "t=1788091200,v1=xyz",
  ])("rejects malformed signature %j", (signature) => {
    expectWebhookFailure(() => adapter().verifyWebhook({
      rawBody: Buffer.from("{}"),
      signature,
      receivedAt: NOW,
    }), signature ? "INVALID_SIGNATURE_FORMAT" : "MISSING_SIGNATURE");
  });

  it("rejects a well-formed but incorrect signature", () => {
    expectWebhookFailure(() => adapter().verifyWebhook({
      rawBody: Buffer.from("{}"),
      signature: `t=${Math.floor(NOW.getTime() / 1_000)},v1=${"0".repeat(64)}`,
      receivedAt: NOW,
    }), "INVALID_SIGNATURE");
  });

  it("rejects signatures outside the tolerance in either time direction", () => {
    for (const offsetSeconds of [-301, 301]) {
      const signatureTimestamp = new Date(NOW.getTime() + offsetSeconds * 1_000);
      const signed = adapter().createSignedWebhook({
        providerEventId: `evt-stale-${offsetSeconds}`,
        eventType: "PAYMENT_PENDING",
        providerCheckoutId: "dev_checkout_123",
        amountMinor: 100n,
        currencyCode: "SAR",
        occurredAt,
        signatureTimestamp,
      });
      expectWebhookFailure(() => adapter().verifyWebhook({ ...signed, receivedAt: NOW }), "STALE_SIGNATURE");
    }
  });

  it("rejects a tampered raw payload even when the original signature is valid", () => {
    const signed = adapter().createSignedWebhook({
      providerEventId: "evt-tampered",
      eventType: "PAYMENT_PAID",
      providerCheckoutId: "dev_checkout_123",
      providerPaymentId: "dev_payment_123",
      amountMinor: 100n,
      currencyCode: "SAR",
      occurredAt,
      signatureTimestamp: NOW,
    });
    const tampered = Buffer.from(Buffer.from(signed.rawBody).toString("utf8").replace('"100"', '"101"'));

    expectWebhookFailure(() => adapter().verifyWebhook({
      rawBody: tampered,
      signature: signed.signature,
      receivedAt: NOW,
    }), "INVALID_SIGNATURE");
  });

  it.each([
    "not-json",
    JSON.stringify({ environment: "development" }),
    JSON.stringify({
      id: "evt-invalid-amount",
      type: "payment.paid",
      environment: "development",
      occurredAt: occurredAt.toISOString(),
      data: {
        providerCheckoutId: "dev_checkout_123",
        amountMinor: "-1",
        currencyCode: "SAR",
      },
    }),
  ])("rejects a correctly signed invalid payload", (payload) => {
    const signed = signedBody(payload);
    expectWebhookFailure(() => adapter().verifyWebhook({ ...signed, receivedAt: NOW }), "INVALID_PAYLOAD");
  });

  it("distinguishes a correctly signed event from the wrong provider environment", () => {
    const signed = signedBody({
      id: "evt-live",
      type: "payment.paid",
      environment: "live",
      occurredAt: occurredAt.toISOString(),
      data: {
        providerCheckoutId: "live_checkout_123",
        providerPaymentId: "live_payment_123",
        providerRefundId: null,
        amountMinor: "100",
        currencyCode: "SAR",
      },
    });

    expectWebhookFailure(() => adapter().verifyWebhook({ ...signed, receivedAt: NOW }), "WRONG_ENVIRONMENT");
  });

  it("preserves null provider references when they are omitted", () => {
    const eventType: PlatformPaymentProviderEventType = "PAYMENT_PENDING";
    const provider = adapter();
    const signed = provider.createSignedWebhook({
      providerEventId: "evt-null-references",
      eventType,
      providerCheckoutId: "dev_checkout_123",
      amountMinor: 1n,
      currencyCode: "USD",
      occurredAt,
      signatureTimestamp: NOW,
    });

    expect(provider.verifyWebhook({ ...signed, receivedAt: NOW })).toMatchObject({
      eventType,
      environment: "DEVELOPMENT",
      providerPaymentId: null,
      providerRefundId: null,
    });
  });
});
