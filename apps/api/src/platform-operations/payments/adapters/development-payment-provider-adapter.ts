import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type {
  CreateProviderCheckoutInput,
  PlatformPaymentDevelopmentSimulatorPort,
  PlatformPaymentProviderEventType,
  PlatformPaymentProviderPort,
  VerifiedPlatformPaymentWebhook,
} from "../platform-payment-provider-port.js";
import { PlatformPaymentWebhookVerificationError } from "../platform-payment-provider-port.js";

const EVENT_TYPE_TO_WIRE: Record<PlatformPaymentProviderEventType, string> = {
  PAYMENT_PENDING: "payment.pending",
  PAYMENT_PAID: "payment.paid",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_CANCELLED: "payment.cancelled",
  PAYMENT_REFUNDED: "payment.refunded",
};

const WIRE_TO_EVENT_TYPE = new Map(
  Object.entries(EVENT_TYPE_TO_WIRE).map(([eventType, wire]) => [wire, eventType as PlatformPaymentProviderEventType]),
);

const developmentEventSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum([
    "payment.pending",
    "payment.paid",
    "payment.failed",
    "payment.cancelled",
    "payment.refunded",
  ]),
  environment: z.string().min(1).max(32),
  occurredAt: z.string().datetime({ offset: true }),
  data: z.object({
    providerCheckoutId: z.string().min(1).max(160),
    providerPaymentId: z.string().min(1).max(160).nullable().optional(),
    providerRefundId: z.string().min(1).max(160).nullable().optional(),
    amountMinor: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  }).strict(),
}).strict();

const identifier = (prefix: string, merchantReference: string) =>
  `${prefix}_${createHash("sha256").update(merchantReference).digest("hex").slice(0, 40)}`;

export class DevelopmentPaymentProviderAdapter implements
  PlatformPaymentProviderPort,
  PlatformPaymentDevelopmentSimulatorPort {
  readonly enabled = true;
  readonly providerCode = "DEVELOPMENT_SIMULATOR";
  readonly environment = "DEVELOPMENT" as const;

  constructor(
    private readonly webhookSecret: string,
    private readonly publicAppUrl: string,
    private readonly signatureToleranceSeconds = 300,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (webhookSecret.length < 32) {
      throw new Error("Development payment webhook secret must contain at least 32 characters");
    }
  }

  async createCheckout(input: CreateProviderCheckoutInput) {
    input.signal?.throwIfAborted();
    const providerCheckoutId = identifier("dev_checkout", input.merchantReference);
    return {
      providerCheckoutId,
      checkoutUrl: `${this.publicAppUrl}/#subscription?developmentCheckout=${encodeURIComponent(input.merchantReference)}`,
      expiresAt: new Date(this.now().getTime() + 30 * 60_000),
    };
  }

  async cancelCheckout(input: {
    providerCheckoutId: string;
    merchantReference: string;
    signal?: AbortSignal | undefined;
  }) {
    input.signal?.throwIfAborted();
    return { accepted: true };
  }

  async requestFullRefund(input: {
    providerPaymentId: string;
    merchantReference: string;
    amountMinor: bigint;
    currencyCode: string;
    signal?: AbortSignal | undefined;
  }) {
    input.signal?.throwIfAborted();
    return { providerRefundId: identifier("dev_refund", input.merchantReference) };
  }

  verifyWebhook(input: {
    rawBody: Uint8Array;
    signature: string | undefined;
    receivedAt: Date;
  }): VerifiedPlatformPaymentWebhook {
    if (!input.signature) throw new PlatformPaymentWebhookVerificationError("MISSING_SIGNATURE");
    const match = /^t=([0-9]{1,12}),v1=([a-f0-9]{64})$/u.exec(input.signature);
    if (!match) throw new PlatformPaymentWebhookVerificationError("INVALID_SIGNATURE_FORMAT");
    const timestampSeconds = Number(match[1]);
    if (!Number.isSafeInteger(timestampSeconds)) {
      throw new PlatformPaymentWebhookVerificationError("INVALID_SIGNATURE_FORMAT");
    }
    const signatureTimestamp = new Date(timestampSeconds * 1_000);
    if (Math.abs(input.receivedAt.getTime() - signatureTimestamp.getTime()) > this.signatureToleranceSeconds * 1_000) {
      throw new PlatformPaymentWebhookVerificationError("STALE_SIGNATURE");
    }
    const expected = this.sign(timestampSeconds, input.rawBody);
    const supplied = Buffer.from(match[2]!, "hex");
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      throw new PlatformPaymentWebhookVerificationError("INVALID_SIGNATURE");
    }

    let parsed: z.infer<typeof developmentEventSchema>;
    try {
      parsed = developmentEventSchema.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8")));
    } catch {
      throw new PlatformPaymentWebhookVerificationError("INVALID_PAYLOAD");
    }
    if (parsed.environment !== "development") {
      throw new PlatformPaymentWebhookVerificationError("WRONG_ENVIRONMENT");
    }
    const eventType = WIRE_TO_EVENT_TYPE.get(parsed.type);
    if (!eventType) throw new PlatformPaymentWebhookVerificationError("INVALID_PAYLOAD");
    return {
      providerEventId: parsed.id,
      eventType,
      environment: this.environment,
      providerCheckoutId: parsed.data.providerCheckoutId,
      providerPaymentId: parsed.data.providerPaymentId ?? null,
      providerRefundId: parsed.data.providerRefundId ?? null,
      amountMinor: BigInt(parsed.data.amountMinor),
      currencyCode: parsed.data.currencyCode,
      occurredAt: new Date(parsed.occurredAt),
      signatureTimestamp,
    };
  }

  createSignedWebhook(input: {
    providerEventId: string;
    eventType: PlatformPaymentProviderEventType;
    providerCheckoutId: string;
    providerPaymentId?: string | null | undefined;
    providerRefundId?: string | null | undefined;
    amountMinor: bigint;
    currencyCode: string;
    occurredAt: Date;
    signatureTimestamp: Date;
  }) {
    const rawBody = Buffer.from(JSON.stringify({
      id: input.providerEventId,
      type: EVENT_TYPE_TO_WIRE[input.eventType],
      environment: "development",
      occurredAt: input.occurredAt.toISOString(),
      data: {
        providerCheckoutId: input.providerCheckoutId,
        providerPaymentId: input.providerPaymentId ?? null,
        providerRefundId: input.providerRefundId ?? null,
        amountMinor: input.amountMinor.toString(),
        currencyCode: input.currencyCode,
      },
    }));
    const timestampSeconds = Math.floor(input.signatureTimestamp.getTime() / 1_000);
    return {
      rawBody,
      signature: `t=${timestampSeconds},v1=${this.sign(timestampSeconds, rawBody).toString("hex")}`,
    };
  }

  private sign(timestampSeconds: number, rawBody: Uint8Array) {
    return createHmac("sha256", this.webhookSecret)
      .update(`${timestampSeconds}.`)
      .update(rawBody)
      .digest();
  }
}
