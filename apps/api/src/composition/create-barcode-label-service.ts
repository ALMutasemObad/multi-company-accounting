import type { PrismaClient } from "@prisma/client";
import { PrismaBarcodeLabelAuditAdapter } from "../audit/prisma-barcode-label-audit-adapter.js";
import { PrismaInventoryBarcodeLabelQueryAdapter } from "../inventory/prisma-inventory-barcode-label-query-adapter.js";
import { BarcodeLabelService } from "../printing/barcode-label-service.js";
import { BwipJsBarcodeLabelRenderer } from "../printing/bwip-js-barcode-label-renderer.js";
import { PrismaBarcodeLabelSettingsAdapter } from "../printing/prisma-barcode-label-settings-adapter.js";

export function createBarcodeLabelService(prisma: PrismaClient) {
  return new BarcodeLabelService(
    new PrismaInventoryBarcodeLabelQueryAdapter(prisma),
    new BwipJsBarcodeLabelRenderer(),
    new PrismaBarcodeLabelAuditAdapter(prisma),
    new PrismaBarcodeLabelSettingsAdapter(prisma),
  );
}
