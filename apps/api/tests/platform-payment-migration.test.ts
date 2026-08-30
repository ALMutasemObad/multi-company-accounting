import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../prisma/migrations/20260830190000_platform_electronic_payments/", import.meta.url);

describe("SUB-4 electronic payment migration", () => {
  it("creates tenant-safe payment lifecycle tables with replay and money constraints", async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL("migration.sql", root), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);

    for (const table of [
      "platform_payment_attempts",
      "platform_checkout_sessions",
      "platform_payment_transitions",
      "platform_webhook_receipts",
      "platform_billing_refunds",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(migration).toContain("platform_webhook_receipts_provider_event_key");
    expect(migration).toContain("platform_payment_attempts_invoice_fkey");
    expect(migration).toContain("platform_billing_refunds_payment_fkey");
    expect(migration).toContain("`amount` * 100 = `amount_minor`");
    expect(migration).toContain("`currency_code` IN ('SAR', 'USD', 'YER')");
    expect(migration).not.toMatch(/(?:card_number|\bpan\b|cvv|cvc|raw_payload|webhook_secret|access_token)/iu);
    expect(schema).toContain("model PlatformPaymentAttempt");
    expect(schema).toContain("model PlatformWebhookReceipt");
    expect(schema).toContain("model PlatformBillingRefund");
  });

  it("keeps the migration additive and refuses destructive rollback after payment history", async () => {
    const [migration, rollback] = await Promise.all([
      readFile(new URL("migration.sql", root), "utf8"),
      readFile(new URL("rollback.sql", root), "utf8"),
    ]);

    expect(migration).not.toMatch(/\b(?:DROP|RENAME)\s+(?:TABLE|COLUMN)\b/iu);
    expect(rollback).toContain("platform_electronic_payments_rollback_refused_attempts_exist");
    expect(rollback).toContain("platform_electronic_payments_rollback_refused_refunds_exist");
    expect(rollback).toContain("platform_electronic_payments_rollback_refused_webhooks_exist");
    expect(rollback).toContain("DROP TABLE `platform_billing_refunds`");
    expect(rollback).toContain("DROP TABLE `platform_webhook_receipts`");
  });
});
