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

describe("inventory barcode B1 architecture", () => {
  it("keeps barcode writes inside the Inventory bounded context", () => {
    const src = resolve(root, "apps/api/src");
    const writers = sourceFiles(src)
      .filter((file) => /\.inventoryItemBarcode\.(?:create|update|updateMany|delete|deleteMany|upsert)\s*\(/u
        .test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).replaceAll("\\", "/"))
      .sort();
    expect(writers).toEqual([
      "apps/api/src/inventory/inventory-barcode-service.ts",
      "apps/api/src/inventory/inventory-catalog-service.ts",
    ]);
  });

  it("pins tenant foreign keys, uniqueness, primary state and binary identity collation", () => {
    const schema = read("apps/api/prisma/schema.prisma");
    const migration = read(
      "apps/api/prisma/migrations/20260829120000_inventory_item_barcodes/migration.sql",
    );
    const nullabilityMigration = read(
      "apps/api/prisma/migrations/20260829122000_inventory_barcode_primary_marker_nullability/migration.sql",
    );
    expect(schema).toContain("model InventoryItemBarcode");
    expect(schema).toContain("fields: [inventoryItemId, companyId], references: [id, companyId]");
    expect(schema).toContain(
      'map: "inventory_item_barcodes_inventory_item_id_company_id_fkey"',
    );
    expect(schema).toContain("@@unique([companyId, normalizedValue]");
    expect(schema).toContain("@@unique([companyId, primaryInventoryItemId]");
    expect(schema).toContain(
      '@@index([companyId, inventoryItemId, id], map: "inventory_barcodes_company_item_id_idx")',
    );
    expect(migration).toContain("`normalized_value` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
    expect(migration).toContain("`primary_inventory_item_id` = `inventory_item_id`");
    expect(migration).toContain(
      "CONSTRAINT `inventory_item_barcodes_inventory_item_id_company_id_fkey`",
    );
    expect(migration).toContain("FOREIGN KEY (`inventory_item_id`, `company_id`)");
    expect(migration).toContain(
      "INDEX `inventory_barcodes_company_item_id_idx` (`company_id`, `inventory_item_id`, `id`)",
    );
    expect(migration).toContain(
      "INDEX `inventory_barcodes_company_item_active_id_idx` (`company_id`, `inventory_item_id`, `is_active`, `id`)",
    );
    expect(migration).not.toMatch(/GENERATED\s+ALWAYS|CREATE\s+TRIGGER|CREATE\s+PROCEDURE/iu);
    expect(nullabilityMigration).toContain(
      "CONSTRAINT `inventory_item_barcodes_primary_marker_nullability_chk`",
    );
    expect(nullabilityMigration).toContain(
      "`is_primary` = TRUE AND `primary_inventory_item_id` IS NOT NULL",
    );
    expect(nullabilityMigration).toContain(
      "`is_primary` = FALSE AND `primary_inventory_item_id` IS NULL",
    );
    expect(nullabilityMigration).not.toMatch(/GENERATED\s+ALWAYS|CREATE\s+TRIGGER|CREATE\s+PROCEDURE/iu);
    const indexNames = [...migration.matchAll(/(?:UNIQUE )?INDEX `([^`]+)`/gu)]
      .map((match) => match[1]!);
    expect(indexNames.every((name) => name.length <= 64)).toBe(true);
  });

  it("seeds all three least-privilege permissions in every reference path", () => {
    const paths = [
      "apps/api/src/platform/reference-data.ts",
      "apps/api/prisma/seed.ts",
      "apps/api/prisma/migrations/20260829120000_inventory_item_barcodes/migration.sql",
    ];
    for (const path of paths) {
      const contents = read(path);
      expect(contents).toContain("inventory_barcodes.view");
      expect(contents).toContain("inventory_barcodes.manage");
      expect(contents).toContain("inventory_barcodes.resolve");
    }
  });

  it("ships an explicitly destructive rollback in dependency-safe order", () => {
    const rollback = read(
      "apps/api/prisma/migrations/20260829120000_inventory_item_barcodes/rollback.sql",
    );
    const grantsDelete = rollback.indexOf("DELETE FROM `role_permissions`");
    const permissionsDelete = rollback.indexOf("DELETE FROM `permissions`");
    const tableDrop = rollback.indexOf("DROP TABLE `inventory_item_barcodes`");
    expect(rollback).toContain("DESTRUCTIVE");
    expect(grantsDelete).toBeGreaterThanOrEqual(0);
    expect(permissionsDelete).toBeGreaterThan(grantsDelete);
    expect(tableDrop).toBeGreaterThan(permissionsDelete);
  });

  it("guards database pagination and one-query batch resolution", () => {
    const service = read("apps/api/src/inventory/inventory-barcode-service.ts");
    const list = service.slice(
      service.indexOf("async listBarcodes("),
      service.indexOf("createBarcode("),
    );
    expect(list).toContain("skip: (input.page - 1) * input.pageSize");
    expect(list).toContain("take: input.pageSize");
    expect(list).toContain("inventoryItemBarcode.count");
    expect(list).not.toContain(".slice(");

    const batch = service.slice(
      service.indexOf("async resolveBarcodeBatch("),
      service.indexOf("static barcodeJson("),
    );
    expect(batch.match(/inventoryItemBarcode\.findMany\(/gu)).toHaveLength(1);
    expect(batch).not.toMatch(/inventoryItemBarcode\.findFirst\(|for\s*\([^)]*\)\s*\{[^}]*await/su);
    expect(batch).toContain("MAX_BATCH_SIZE");
  });

  it("publishes only the B1 management and resolution contract", () => {
    const openapi = read("packages/contracts/openapi.yaml");
    const router = read("apps/api/src/inventory/inventory-barcode-router.ts");
    const app = read("apps/api/src/app.ts");
    for (const operation of [
      "listInventoryItemBarcodes",
      "createInventoryItemBarcode",
      "updateInventoryItemBarcode",
      "setPrimaryInventoryItemBarcode",
      "deactivateInventoryItemBarcode",
      "resolveInventoryBarcode",
      "resolveInventoryBarcodeBatch",
    ]) {
      expect(openapi).toContain(`operationId: ${operation}`);
    }
    expect(router).not.toMatch(/(?:generate|print|render)InventoryBarcode/iu);
    expect(openapi).toContain("يوفر مسار B2 المنفصل توليد ملصق PNG");
    expect(openapi).toContain("يبقى تحليل GS1 خارج النطاق");
    expect(router).toContain('"inventory_barcodes.view"');
    expect(router).toContain('"inventory_barcodes.manage"');
    expect(router).toContain('"inventory_barcodes.resolve"');
    expect(app).toContain("createInventoryBarcodeRouter");
  });
});
