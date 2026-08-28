import type { Prisma } from "@prisma/client";
import type { AuditAppendInput, AuditAppendPort } from "../platform/audit-append-port.js";

type AuditWriteClient = Pick<Prisma.TransactionClient, "auditLog">;

export async function appendAudit(client: AuditWriteClient, args: { data: AuditAppendInput }) {
  const input = args.data;
  await client.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
  });
}

export class PrismaAuditAppendAdapter implements AuditAppendPort {
  async append(tx: Prisma.TransactionClient, input: AuditAppendInput) {
    await appendAudit(tx, { data: input });
  }
}
