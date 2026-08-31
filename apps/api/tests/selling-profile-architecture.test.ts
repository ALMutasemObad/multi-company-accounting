import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
describe("selling profile additive ownership and migration guards", () => {
  it("owns only the Sales profile and delegates foreign references", () => {
    const service = read("../src/sales/selling-profile-service.ts");
    expect(service).not.toMatch(/\.(?:account|inventoryItem|unitOfMeasure|taxRate|companyCurrency|journalEntry|journalLine)\.(?:find|create|update|delete)/);
    expect(service).toContain("IdempotentCommandExecutor"); expect(service).toContain("this.ports.audit.append(tx");
    for (const owner of ["inventory/selling-catalog-inventory-adapter", "accounts/selling-catalog-account-adapter",
      "companies/selling-catalog-currency-adapter", "tax/selling-catalog-tax-adapter"]) {
      expect(read(`../src/${owner}.ts`)).not.toMatch(/\.(?:create|update|updateMany|delete|upsert)\(/);
    }
    expect(read("../src/tax/selling-catalog-tax-adapter.ts")).toContain('TaxService.json(rate, "OUTPUT")');
  });
  it("adds one table with exact money, uniqueness, company FKs and no destructive rollback", () => {
    const migration = read("../prisma/migrations/20260831110000_sales_item_selling_profiles/migration.sql");
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(migration).toContain("DECIMAL(19,4)"); expect(migration).toContain("CHECK (`unit_price` >= 0)");
    expect(migration).toContain("UNIQUE KEY `selling_profiles_company_item_key` (`company_id`, `inventory_item_id`)");
    expect(migration.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(5);
    expect(migration).not.toMatch(/DROP|DELETE FROM|ALTER TABLE/);
    expect(migration).toContain("`roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE");
    expect(read("../prisma/migrations/20260831110000_sales_item_selling_profiles/rollback.sql")).not.toMatch(/DROP TABLE|DELETE FROM/);
  });
});
