import type { PrismaClient } from "@prisma/client";
import type {
  BarcodeLabelAuditMetadata,
  BarcodeLabelAuditPort,
} from "../printing/barcode-label-ports.js";
import type { ActorContext } from "../platform/actor-context.js";
import { appendAudit } from "./prisma-audit-append-adapter.js";

export class PrismaBarcodeLabelAuditAdapter implements BarcodeLabelAuditPort {
  constructor(private readonly prisma: PrismaClient) {}

  async recordDownload(
    context: ActorContext,
    metadata: BarcodeLabelAuditMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await appendAudit(tx, {
        data: {
          companyId: context.companyId,
          actorUserId: context.userId,
          action: "INVENTORY_BARCODE_LABEL_DOWNLOADED",
          entityType: "INVENTORY_ITEM_BARCODE",
          entityId: metadata.barcodeId.toString(),
          details: {
            inventoryItemId: metadata.inventoryItemId.toString(),
            symbology: metadata.symbology,
            profile: metadata.profile,
          },
        },
      });
    });
  }
}
