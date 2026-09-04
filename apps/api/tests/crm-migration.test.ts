import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = () => readFile(new URL("../prisma/migrations/20260904193000_crm_business_development_vertical/migration.sql", import.meta.url), "utf8");
const rollback = () => readFile(new URL("../prisma/migrations/20260904193000_crm_business_development_vertical/rollback.sql", import.meta.url), "utf8");

describe("CRM migration invariants", () => {
  it("enforces company-scoped references, parent exclusivity and state consistency", async () => {
    const sql = await migration();
    expect(sql).toContain("FOREIGN KEY (`owner_employee_id`, `company_id`)");
    expect(sql).toContain("FOREIGN KEY (`converted_customer_id`, `company_id`)");
    expect(sql).toContain("FOREIGN KEY (`company_id`, `currency_id`)");
    expect(sql).toContain("CHECK ((`lead_id` IS NULL) <> (`opportunity_id` IS NULL))");
    expect(sql).toContain("`probability_bps` <= 10000");
    expect(sql).toContain("UNIQUE KEY `crm_opportunities_lead_company_key`");
  });

  it("refuses destructive rollback after CRM or idempotency use", async () => {
    const sql = await rollback();
    expect(sql).toContain("@crm_rows = 0 AND @crm_idempotency = 0");
    expect(sql).toContain("`operation` LIKE 'crm.%'");
    expect(sql).toContain("crm_rollback_blocked_non_empty_or_idempotent");
  });
});
