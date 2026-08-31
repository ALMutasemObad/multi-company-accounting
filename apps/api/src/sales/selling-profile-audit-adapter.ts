import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { SellingProfileAuditPort } from "./selling-profile-ports.js";

export class SellingProfileAuditAdapter implements SellingProfileAuditPort {
  append(tx: Prisma.TransactionClient, context: ActorContext, input: Parameters<SellingProfileAuditPort["append"]>[2]) {
    return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId,
      action: input.action, entityType: "SALES_ITEM_SELLING_PROFILE", entityId: String(input.profileId),
      details: { inventoryItemId: String(input.inventoryItemId), fromVersion: input.fromVersion, toVersion: input.toVersion } } });
  }
}
