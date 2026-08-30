export type PlatformPaymentProviderEnvironment = "DEVELOPMENT" | "SANDBOX" | "LIVE";

export type PlatformPaymentProviderEventType =
  | "PAYMENT_PENDING"
  | "PAYMENT_PAID"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "PAYMENT_REFUNDED";

export type CreateProviderCheckoutInput = {
  merchantReference: string;
  amountMinor: bigint;
  currencyCode: string;
  description: string;
  returnUrl: string;
  signal?: AbortSignal | undefined;
};

export type ProviderCheckoutResult = {
  providerCheckoutId: string;
  checkoutUrl: string;
  expiresAt: Date;
};

export type VerifiedPlatformPaymentWebhook = {
  providerEventId: string;
  eventType: PlatformPaymentProviderEventType;
  environment: PlatformPaymentProviderEnvironment;
  providerCheckoutId: string;
  providerPaymentId: string | null;
  providerRefundId: string | null;
  amountMinor: bigint;
  currencyCode: string;
  occurredAt: Date;
  signatureTimestamp: Date;
};

export type PlatformPaymentWebhookVerificationFailure =
  | "MISSING_SIGNATURE"
  | "INVALID_SIGNATURE_FORMAT"
  | "INVALID_SIGNATURE"
  | "STALE_SIGNATURE"
  | "INVALID_PAYLOAD"
  | "WRONG_ENVIRONMENT";

export class PlatformPaymentWebhookVerificationError extends Error {
  constructor(public readonly reason: PlatformPaymentWebhookVerificationFailure) {
    super(reason);
  }
}

export interface PlatformPaymentProviderPort {
  readonly enabled: boolean;
  readonly providerCode: string;
  readonly environment: PlatformPaymentProviderEnvironment;

  createCheckout(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutResult>;

  cancelCheckout(input: {
    providerCheckoutId: string;
    merchantReference: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ accepted: boolean }>;

  requestFullRefund(input: {
    providerPaymentId: string;
    merchantReference: string;
    amountMinor: bigint;
    currencyCode: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ providerRefundId: string }>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    signature: string | undefined;
    receivedAt: Date;
  }): VerifiedPlatformPaymentWebhook;
}

export interface PlatformPaymentDevelopmentSimulatorPort {
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
  }): { rawBody: Uint8Array; signature: string };
}
