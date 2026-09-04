import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/migrations/20260904120000_organization_membership_owner_workspace");

describe("organization membership migration", () => {
  it("creates an identity-owned group role without modifying company or platform permissions", () => {
    const sql = readFileSync(resolve(migrationDirectory, "migration.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE `organization_memberships`");
    expect(sql).toContain("ENUM('OWNER', 'ADMIN', 'VIEWER')");
    expect(sql).toContain("PARTITION BY candidates.`organization_id`");
    expect(sql).toContain("CREATE TABLE `organization_audit_logs`");
    expect(sql).not.toMatch(/UPDATE\s+`?(permissions|platform_operator)/iu);
  });

  it("refuses a rollback after versioned membership changes or organization audit activity", () => {
    const sql = readFileSync(resolve(migrationDirectory, "rollback.sql"), "utf8");
    expect(sql).toContain("organization_membership_rollback_refused_business_activity_exists");
    expect(sql).toContain("`version` <> 0");
    expect(sql).toContain("`organization_audit_logs`");
  });
});
