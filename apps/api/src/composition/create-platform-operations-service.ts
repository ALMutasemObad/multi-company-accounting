import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import {
  initializePlatformOperatorAuthorization,
} from "../platform-operations/platform-operator-authorization.js";
import type { PlatformAnalyticsQueryPort } from "../platform-operations/platform-operations-ports.js";
import { PlatformOperationsService } from "../platform-operations/platform-operations-service.js";
import { PlatformIdentityQueryAdapter } from "../users/platform-identity-query-adapter.js";

const commaSeparated = (value: string | undefined) => (value ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export async function createPlatformOperationsService(
  prisma: PrismaClient,
  analytics: PlatformAnalyticsQueryPort,
  config: Pick<AppConfig, "NODE_ENV" | "PLATFORM_OPERATOR_USER_IDS" | "PLATFORM_OPERATOR_EMAILS">,
) {
  const configuredUserIds = commaSeparated(config.PLATFORM_OPERATOR_USER_IDS).map(BigInt);
  const configuredDevelopmentEmails = commaSeparated(config.PLATFORM_OPERATOR_EMAILS);
  const developmentFallbackEmails = config.NODE_ENV === "development" && configuredUserIds.length === 0
    ? configuredDevelopmentEmails.length ? configuredDevelopmentEmails : ["admin@mcap.local"]
    : [];
  const authorization = await initializePlatformOperatorAuthorization(
    new PlatformIdentityQueryAdapter(prisma),
    { operatorUserIds: configuredUserIds, developmentFallbackEmails },
  );
  return new PlatformOperationsService(authorization, analytics);
}
