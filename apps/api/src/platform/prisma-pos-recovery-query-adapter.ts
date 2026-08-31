import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { PosRecoveryLookup, PosRecoveryQueryPort } from "../pos/recovery-types.js";

/** Infrastructure owns this read. Never fall back to a company/key-only lookup. */
export class PrismaPosRecoveryQueryAdapter implements PosRecoveryQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  find(input: PosRecoveryLookup) {
    return this.prisma.idempotencyRecord.findUnique({
      where: {
        companyId_userId_operation_keyHash: {
          companyId: input.companyId,
          userId: input.userId,
          operation: input.operation,
          keyHash: new Uint8Array(createHash("sha256").update(input.attemptKey).digest()),
        },
      },
      select: { companyId: true, userId: true, operation: true, status: true,
        responseStatus: true, expiresAt: true, responseBody: true },
    });
  }
}
