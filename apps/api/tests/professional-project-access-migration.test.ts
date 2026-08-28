import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationRoot = new URL("../prisma/migrations/20260828060000_professional_ethical_wall/", import.meta.url);

describe("professional ethical-wall migration", () => {
  it("is additive, company-safe, and preserves identity ownership", async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain("ADD COLUMN `access_mode`");
    expect(migration).toContain("ADD COLUMN `access_version`");
    expect(migration).toContain("CREATE TABLE `professional_project_access_grants`");
    expect(migration).toContain("FOREIGN KEY (`project_id`, `company_id`)");
    expect(migration).toContain("FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies`");
    expect(migration).toContain("professional_project_access_grants_state_chk");
    expect(migration).toContain("professional_access.manage");
    expect(schema).not.toMatch(/model ProfessionalProjectAccessGrant[\s\S]{0,2500}\b(?:emailNormalized|passwordHash)\b/u);
  });

  it("refuses destructive rollback after confidentiality history exists", async () => {
    const rollback = await readFile(new URL("rollback.sql", migrationRoot), "utf8");
    expect(rollback).toContain("@professional_access_grant_count = 0");
    expect(rollback).toContain("`access_mode` <> 'COMPANY' OR `access_version` <> 0");
    expect(rollback).toContain("professional_access_rollback_refused_retain_confidentiality_history");
    expect(rollback.indexOf("DROP TABLE `professional_project_access_grants`")).toBeLessThan(rollback.indexOf("DROP COLUMN `access_mode`"));
  });
});
