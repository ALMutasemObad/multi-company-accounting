import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationRoot = new URL("../prisma/migrations/20260828030000_professional_project_planning/", import.meta.url);

describe("professional project planning migration", () => {
  it("uses additive company-safe relations and keeps actual time derived", async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);

    expect(migration).toContain("ADD COLUMN `planning_version`");
    expect(migration).toContain("CREATE TABLE `professional_project_stages`");
    expect(migration).toContain("CREATE TABLE `professional_project_tasks`");
    expect(migration).toContain("CREATE TABLE `professional_task_dependencies`");
    expect(migration).toContain("FOREIGN KEY (`task_id`, `project_id`, `company_id`)");
    expect(migration).toContain("FOREIGN KEY (`depends_on_task_id`, `project_id`, `company_id`)");
    expect(migration).toContain("FOREIGN KEY (`project_id`, `assignee_user_id`, `company_id`)");
    expect(migration).toContain("CHECK (`task_id` <> `depends_on_task_id`)");
    expect(migration).toContain("ADD COLUMN `task_id` BIGINT UNSIGNED NULL");
    expect(schema).not.toMatch(/model ProfessionalProjectTask[\s\S]{0,1800}\bactualMinutes\b/u);
  });

  it("refuses destructive rollback after any planning or time-link use", async () => {
    const rollback = await readFile(new URL("rollback.sql", migrationRoot), "utf8");
    expect(rollback).toContain("@professional_planning_stage_count = 0");
    expect(rollback).toContain("@professional_planning_task_count = 0");
    expect(rollback).toContain("@professional_planning_dependency_count = 0");
    expect(rollback).toContain("WHERE `task_id` IS NOT NULL");
    expect(rollback).toContain("`time_budget_minutes` IS NOT NULL OR `planning_version` <> 0");
    expect(rollback).toContain("professional_planning_rollback_refused_retain_work_breakdown_and_time_history");
    expect(rollback.indexOf("DROP TABLE `professional_task_dependencies`")).toBeLessThan(rollback.indexOf("DROP TABLE `professional_project_tasks`"));
    expect(rollback.indexOf("DROP TABLE `professional_project_tasks`")).toBeLessThan(rollback.indexOf("DROP TABLE `professional_project_stages`"));
  });
});
