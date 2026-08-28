import type { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit-service.js';
import { AuditIdentityAdapter } from '../users/audit-identity-adapter.js';

export function createAuditService(prisma: PrismaClient) {
  return new AuditService(prisma, new AuditIdentityAdapter(prisma));
}
