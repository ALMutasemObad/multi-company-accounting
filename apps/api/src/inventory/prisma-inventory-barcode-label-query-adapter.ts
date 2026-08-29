import type { PrismaClient } from "@prisma/client";
import type {
  InventoryBarcodeLabelQueryPort,
  PrintableInventoryBarcode,
} from "./inventory-barcode-label-query-port.js";

export class PrismaInventoryBarcodeLabelQueryAdapter
implements InventoryBarcodeLabelQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findPrintableBarcode(
    companyId: bigint,
    inventoryItemId: bigint,
    barcodeId: bigint,
  ): Promise<PrintableInventoryBarcode | null> {
    const barcode = await this.prisma.inventoryItemBarcode.findFirst({
      where: {
        id: barcodeId,
        companyId,
        inventoryItemId,
        isActive: true,
        inventoryItem: { isActive: true },
      },
      select: {
        id: true,
        inventoryItemId: true,
        symbology: true,
        value: true,
      },
    });

    return barcode === null
      ? null
      : {
          inventoryItemId: barcode.inventoryItemId,
          barcodeId: barcode.id,
          symbology: barcode.symbology,
          value: barcode.value,
        };
  }
}
