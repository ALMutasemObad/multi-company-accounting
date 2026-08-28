import type { Prisma } from "@prisma/client";

export type AuditAppendInput = {
  companyId: bigint;
  actorUserId: bigint;
  action: string;
  entityType: string;
  entityId: string;
  details?: Prisma.InputJsonValue | undefined;
};

export interface AuditAppendPort {
  append(tx: Prisma.TransactionClient, input: AuditAppendInput): Promise<void>;
}
