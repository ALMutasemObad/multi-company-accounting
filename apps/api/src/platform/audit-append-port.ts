import type { Prisma } from "@prisma/client";

type AuditAppendBase = {
  actorUserId: bigint;
  action: string;
  entityType: string;
  entityId: string;
  details?: Prisma.InputJsonValue | undefined;
};

export type AuditAppendInput = AuditAppendBase & (
  | { companyId: bigint; organizationId?: never }
  | { organizationId: bigint; companyId?: never }
);

export interface AuditAppendPort {
  append(tx: Prisma.TransactionClient, input: AuditAppendInput): Promise<void>;
}
