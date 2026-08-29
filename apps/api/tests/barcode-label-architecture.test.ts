import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return absolute.endsWith(".ts") ? [absolute] : [];
  });
}

describe("inventory barcode label B2 architecture", () => {
  it("keeps Inventory reads behind its owner port and Printing free of Prisma reads", () => {
    const service = read("apps/api/src/printing/barcode-label-service.ts");
    const port = read("apps/api/src/inventory/inventory-barcode-label-query-port.ts");
    const adapter = read("apps/api/src/inventory/prisma-inventory-barcode-label-query-adapter.ts");

    expect(service).toContain("InventoryBarcodeLabelQueryPort");
    expect(service).not.toMatch(/inventoryItemBarcode|PrismaClient|@prisma\/client/u);
    expect(port).toContain("interface InventoryBarcodeLabelQueryPort");
    expect(adapter).toContain("implements InventoryBarcodeLabelQueryPort");
    expect(adapter).toContain("companyId,");
    expect(adapter).toContain("inventoryItemId,");
    expect(adapter).toContain("isActive: true");
    expect(adapter).toContain("inventoryItem: { isActive: true }");
  });

  it("isolates the open-source encoder behind one Printing adapter", () => {
    const sources = sourceFiles(resolve(root, "apps/api/src"));
    const imports = sources
      .filter((file) => readFileSync(file, "utf8").includes('from "@bwip-js/node"'))
      .map((file) => relative(root, file).replaceAll("\\", "/"));
    const renderer = read("apps/api/src/printing/bwip-js-barcode-label-renderer.ts");

    expect(imports).toEqual([
      "apps/api/src/printing/bwip-js-barcode-label-renderer.ts",
    ]);
    expect(renderer).toContain("EAN_13: \"ean13\"");
    expect(renderer).toContain("QR: \"qrcode\"");
    expect(renderer).not.toMatch(/GS1|gs1/u);
    expect(renderer).toContain("MAX_LABEL_BYTES");
  });

  it("ships print as a separate least-privilege migration and safe GET contract", () => {
    const migration = read(
      "apps/api/prisma/migrations/20260829121000_inventory_barcode_print_permission/migration.sql",
    );
    const rollback = read(
      "apps/api/prisma/migrations/20260829121000_inventory_barcode_print_permission/rollback.sql",
    );
    const b1Migration = read(
      "apps/api/prisma/migrations/20260829120000_inventory_item_barcodes/migration.sql",
    );
    for (const path of [
      "apps/api/prisma/seed.ts",
      "apps/api/src/platform/reference-data.ts",
    ]) {
      expect(read(path)).toContain("inventory_barcodes.print");
    }
    expect(migration).toContain("inventory_barcodes.print");
    expect(rollback).toContain("DESTRUCTIVE");
    expect(b1Migration).not.toContain("inventory_barcodes.print");

    const openapi = read("packages/contracts/openapi.yaml");
    const operation = openapi.slice(
      openapi.indexOf("/inventory-items/{inventoryItemId}/barcodes/{barcodeId}/label.png:"),
      openapi.indexOf("/inventory-barcodes/resolve:"),
    );
    expect(operation).toContain("operationId: printInventoryBarcodeLabel");
    expect(operation).toContain("x-permission: inventory_barcodes.print");
    expect(operation).toContain("image/png");
    expect(operation).toContain("enum: [no-store]");
    expect(operation).not.toContain("in: query");
  });

  it("does not place the raw barcode in the filename, headers, or audit metadata", () => {
    const service = read("apps/api/src/printing/barcode-label-service.ts");
    const router = read("apps/api/src/printing/barcode-label-router.ts");
    const audit = read("apps/api/src/audit/prisma-barcode-label-audit-adapter.ts");
    const auditDetails = audit.slice(audit.indexOf("details:"));

    expect(service).toContain("inventory-item-${barcode.inventoryItemId}-barcode-${barcode.barcodeId}.png");
    expect(router).not.toMatch(/Content-Disposition[\s\S]{0,300}(?:barcode\.value|rawValue)/u);
    expect(auditDetails).not.toMatch(/value|normalizedValue/iu);
    expect(audit).toContain("INVENTORY_BARCODE_LABEL_DOWNLOADED");
  });

  it("pins the reviewed renderer release and integrity in the lockfile", () => {
    expect(read("apps/api/package.json")).toContain('"@bwip-js/node": "4.11.2"');
    expect(read("package-lock.json")).toContain(
      "sha512-5Us0cTcMFZZsDi+GKkruRrsnjiaZ3dzeTJBawDCQ6Ux7ebERMhyuM/EOnB0B9vm3wS7Tgtbhpv2h37wZog+lPw==",
    );
  });
});
