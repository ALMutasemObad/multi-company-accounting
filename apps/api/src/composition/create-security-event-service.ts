import type { PrismaClient } from '@prisma/client';
import { PrismaAuditAppendAdapter } from '../audit/prisma-audit-append-adapter.js';
import { SecurityEventService } from '../security/security-event-service.js';
import { SecurityIdentityAdapter } from '../users/security-identity-adapter.js';

export function createSecurityEventService(prisma: PrismaClient) {
  return new SecurityEventService(
    prisma,
    new SecurityIdentityAdapter(prisma),
    new PrismaAuditAppendAdapter(),
  );
}
