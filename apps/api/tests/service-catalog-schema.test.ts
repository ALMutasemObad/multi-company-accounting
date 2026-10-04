import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20261004120000_service_catalog_offerings/migration.sql", import.meta.url), "utf8");

describe("SC-1A catalog-only persistence boundary", () => {
  it("creates exactly the three definition tables without activating or granting the module", () => {
    expect([...migration.matchAll(/CREATE TABLE `([^`]+)`/g)].map((match) => match[1])).toEqual([
      "service_categories", "service_offerings", "service_offering_variants",
    ]);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE)\s+(?:INTO\s+)?`?(?:permissions|role_permissions|platform_modules|platform_subscription_entitlements)`?/i);
  });

  it("keeps all catalog identities and optional references company-scoped", () => {
    expect(migration).toContain("FOREIGN KEY (`category_id`,`company_id`) REFERENCES `service_categories` (`id`,`company_id`)");
    expect(migration).toContain("FOREIGN KEY (`offering_id`,`company_id`) REFERENCES `service_offerings` (`id`,`company_id`)");
    expect(migration).toContain("FOREIGN KEY (`default_revenue_account_id`,`company_id`) REFERENCES `accounts` (`id`,`company_id`)");
    expect(migration).toContain("FOREIGN KEY (`default_output_tax_rate_id`,`company_id`) REFERENCES `tax_rates` (`id`,`company_id`)");
    expect(schema).toContain('@@unique([companyId, code])');
  });

  it("does not persist a project, invoice, customer or inventory relation in the catalog", () => {
    for (const foreignKey of ["project_id", "sales_invoice_id", "customer_id", "inventory_item_id"]) {
      expect(migration).not.toContain(`\`${foreignKey}\``);
    }
    for (const name of [...migration.matchAll(/`([^`]+)`/g)].map((match) => match[1])) {
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });
});
