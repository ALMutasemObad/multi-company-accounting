import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { defaultBarcodeLabelSettings, type BarcodeLabelSettings, type BarcodeLabelSettingsPort } from "./barcode-label-settings.js";

export class PrismaBarcodeLabelSettingsAdapter implements BarcodeLabelSettingsPort {
  constructor(private readonly prisma: PrismaClient) {}

  async get(companyId: bigint): Promise<BarcodeLabelSettings> {
    const stored = await this.prisma.inventoryBarcodeSettings.findUnique({ where: { companyId } });
    if (!stored) return { ...defaultBarcodeLabelSettings };
    return {
      labelSize: stored.labelSize === "75x50" ? "75x50" : "50x25",
      defaultSymbology: stored.defaultSymbology,
      showItemName: stored.showItemName,
      showPublicationYear: stored.showPublicationYear,
      showIssueNumber: stored.showIssueNumber,
      showBarcodeText: stored.showBarcodeText,
    };
  }

  async save(context: ActorContext, value: BarcodeLabelSettings): Promise<BarcodeLabelSettings> {
    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryBarcodeSettings.upsert({
        where: { companyId: context.companyId },
        create: { companyId: context.companyId, ...value },
        update: { ...value },
      });
      await appendAudit(tx, { data: {
        companyId: context.companyId, actorUserId: context.userId,
        action: "INVENTORY_BARCODE_SETTINGS_UPDATED", entityType: "COMPANY",
        entityId: context.companyId.toString(), details: value,
      } });
    });
    return value;
  }
}
