import type { Prisma } from "@prisma/client";
import type {
  RegistrationSecurityCompletionInput,
  RegistrationSecurityPort,
} from "../registration/registration-owner-ports.js";

export class RegistrationSecurityAdapter implements RegistrationSecurityPort {
  async recordCompletion(
    tx: Prisma.TransactionClient,
    input: RegistrationSecurityCompletionInput,
  ) {
    await tx.securityEvent.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        eventType: "SELF_REGISTRATION_COMPLETED",
        severity: "INFO",
        emailSnapshot: input.emailNormalized,
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        details: { registrationPublicId: input.registrationPublicId },
      },
    });
  }
}
