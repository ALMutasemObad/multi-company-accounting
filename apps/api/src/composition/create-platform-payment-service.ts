import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import type { PlatformAnalyticsQueryPort } from "../platform-operations/platform-operations-ports.js";
import type { PlatformOperationsService } from "../platform-operations/platform-operations-service.js";
import { DevelopmentPaymentProviderAdapter } from "../platform-operations/payments/adapters/development-payment-provider-adapter.js";
import {
  PlatformPaymentWebhookVerificationError,
  type CreateProviderCheckoutInput,
  type PlatformPaymentProviderPort,
} from "../platform-operations/payments/platform-payment-provider-port.js";
import { PlatformPaymentService } from "../platform-operations/payments/platform-payment-service.js";

class DisabledPlatformPaymentProvider implements PlatformPaymentProviderPort {
  readonly enabled = false;
  readonly providerCode = "DISABLED";
  readonly environment = "DEVELOPMENT" as const;

  createCheckout(_input: CreateProviderCheckoutInput): Promise<never> {
    return Promise.reject(new Error("Platform payment provider is disabled"));
  }

  cancelCheckout(): Promise<never> {
    return Promise.reject(new Error("Platform payment provider is disabled"));
  }

  requestFullRefund(): Promise<never> {
    return Promise.reject(new Error("Platform payment provider is disabled"));
  }

  verifyWebhook(): never {
    throw new PlatformPaymentWebhookVerificationError("INVALID_SIGNATURE");
  }
}

export function createPlatformPaymentService(
  prisma: PrismaClient,
  operators: Pick<PlatformOperationsService, "requireOperator">,
  analytics: Pick<PlatformAnalyticsQueryPort, "companyReferences">,
  audit: AuditAppendPort,
  config: AppConfig,
) {
  if (config.PLATFORM_PAYMENT_PROVIDER_MODE === "development") {
    const provider = new DevelopmentPaymentProviderAdapter(
      config.PLATFORM_PAYMENT_DEVELOPMENT_WEBHOOK_SECRET!,
      config.WEB_ORIGIN,
      config.PLATFORM_PAYMENT_WEBHOOK_TOLERANCE_SECONDS ?? 300,
    );
    return new PlatformPaymentService(prisma, provider, operators, analytics, audit, provider);
  }
  return new PlatformPaymentService(
    prisma,
    new DisabledPlatformPaymentProvider(),
    operators,
    analytics,
    audit,
  );
}
