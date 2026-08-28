import type { Prisma } from '@prisma/client';
import type { SecurityEventAppendInput, SecurityEventAppendPort } from '../platform/security-event-append-port.js';

function data(input: SecurityEventAppendInput): Prisma.SecurityEventCreateManyInput {
  return {
    companyId: input.companyId,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    eventType: input.eventType,
    severity: input.severity,
    emailSnapshot: input.emailSnapshot ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    ...(input.details !== undefined ? { details: input.details } : {}),
  };
}

export class PrismaSecurityEventAppendAdapter implements SecurityEventAppendPort {
  async append(tx: Prisma.TransactionClient, input: SecurityEventAppendInput) {
    await tx.securityEvent.create({ data: data(input) });
  }

  async appendMany(tx: Prisma.TransactionClient, inputs: readonly SecurityEventAppendInput[]) {
    if (!inputs.length) return;
    await tx.securityEvent.createMany({ data: inputs.map(data) });
  }
}
