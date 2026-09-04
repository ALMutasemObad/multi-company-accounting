import type { Prisma } from "@prisma/client";
import type { AuditAppendInput, AuditAppendPort } from "../platform/audit-append-port.js";

type AuditWriteClient = Pick<Prisma.TransactionClient, "auditLog" | "organizationAuditLog">;

export async function appendAudit(client: AuditWriteClient, args: { data: AuditAppendInput }) {
  const input = args.data;
  const common = {
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ...(input.details !== undefined ? { details: input.details } : {}),
  };
  if (input.companyId !== undefined) {
    await client.auditLog.create({ data: { ...common, companyId: input.companyId } });
  } else {
    await client.organizationAuditLog.create({ data: { ...common, organizationId: input.organizationId } });
  }
}

export class PrismaAuditAppendAdapter implements AuditAppendPort {
  async append(tx: Prisma.TransactionClient, input: AuditAppendInput) {
    await appendAudit(tx, { data: input });
  }
}
