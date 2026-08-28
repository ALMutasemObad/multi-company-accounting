import type { Prisma, SecuritySeverity } from '@prisma/client';

export type SecurityEventAppendInput = {
  companyId: bigint;
  userId?: bigint | null;
  sessionId?: bigint | null;
  eventType: string;
  severity: SecuritySeverity;
  emailSnapshot?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Prisma.InputJsonValue;
};

export interface SecurityEventAppendPort {
  append(tx: Prisma.TransactionClient, input: SecurityEventAppendInput): Promise<void>;
  appendMany(tx: Prisma.TransactionClient, inputs: readonly SecurityEventAppendInput[]): Promise<void>;
}
