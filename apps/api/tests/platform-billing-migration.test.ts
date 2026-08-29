import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationRoot = new URL("../prisma/migrations/20260828150000_platform_commercial_billing/", import.meta.url);

describe("platform commercial billing migration", () => {
  it("owns isolated account, invoice, line, and payment tables with tenant-safe relations", async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);
    for (const table of ["platform_billing_accounts", "platform_billing_invoices", "platform_billing_invoice_lines", "platform_billing_payments"]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(migration).toContain("platform_billing_invoices_company_period_key");
    expect(migration).toContain("platform_billing_payments_invoice_fkey");
    expect(migration).toContain("`quantity` INT UNSIGNED NOT NULL");
    expect(schema).toContain("model PlatformBillingAccount");
    expect(schema).toContain("model PlatformBillingInvoice");
    expect(schema).toContain("model PlatformBillingPayment");
  });

  it("refuses rollback after commercial history exists", async () => {
    const rollback = await readFile(new URL("rollback.sql", migrationRoot), "utf8");
    expect(rollback).toContain("platform_billing_rollback_refused_retain_account_invoice_and_payment_history");
    expect(rollback).toContain("DROP TABLE `platform_billing_payments`");
  });
});
