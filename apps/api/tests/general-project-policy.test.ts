import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GeneralProjectPolicyError, transitionProject, transitionPhase, transitionTask, validateDependencyAddition,
  type GeneralProjectTaskNode,
} from "../src/general-projects/general-project-policy.js";

const project = () => ({ from: "DRAFT" as const, to: "ACTIVE" as const, activeManagerCount: 1, phaseStatuses: [], taskStatuses: [] });
const phase = () => ({ projectStatus: "ACTIVE" as const, from: "PLANNED" as const, to: "IN_PROGRESS" as const, taskStatuses: [] });
const task = () => ({
  projectStatus: "ACTIVE" as const, phaseStatus: "IN_PROGRESS" as const,
  from: "TODO" as const, to: "IN_PROGRESS" as const,
  actorCanManage: false, actorCanProgress: true, actorIsActiveResponsible: true,
  activeResponsibleCount: 1, predecessorStatuses: ["COMPLETED" as const],
});
const errorCode = (action: () => unknown) => {
  try { action(); } catch (cause) { return cause instanceof GeneralProjectPolicyError ? cause.code : "UNKNOWN"; }
  return "NONE";
};

const migration = readFileSync(new URL("../prisma/migrations/20261004_general_project_register/migration.sql", import.meta.url), "utf8");
const planMigration = readFileSync(new URL("../prisma/migrations/20261005_general_project_plan/migration.sql", import.meta.url), "utf8");
const planRollback = readFileSync(new URL("../prisma/migrations/20261005_general_project_plan/rollback.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

describe("general project migration boundaries", () => {
  it("starts disabled until the project register passes database acceptance", () => {
    expect(migration).toMatch(/VALUES \('GENERAL_PROJECTS', 'Project management', FALSE, 0,/u);
  });

  it("links only to company, customer, employee, user, and project records", () => {
    const referencedTables = [...migration.matchAll(/REFERENCES `([a-z_]+)`/gu)].map(match => match[1]);
    expect(new Set(referencedTables)).toEqual(new Set(["companies", "customers", "employees", "users", "general_projects"]));
    expect(migration).not.toMatch(/(?:professional_services|service_catalog|cases|legal_matters)/u);
  });
});

describe("general project plan persistence boundary", () => {
  it("applies the plan migration after its project register dependency", () => {
    expect("20261005_general_project_plan" > "20261004_general_project_register").toBe(true);
  });

  it("adds phases, tasks and member assignments without activating the module", () => {
    expect([...planMigration.matchAll(/CREATE TABLE `([^`]+)`/gu)].map(match => match[1])).toEqual([
      "general_project_phases", "general_project_tasks", "general_project_task_assignments",
    ]);
    expect(planMigration).not.toMatch(/UPDATE `platform_modules`|INSERT INTO `platform_plan_entitlements`/u);
    expect(schema).toContain("model GeneralProjectPhase {");
    expect(schema).toContain("model GeneralProjectTask {");
    expect(schema).toContain("model GeneralProjectTaskAssignment {");
  });

  it("enforces project and company scope in plan and assignment foreign keys", () => {
    expect(planMigration).toContain("FOREIGN KEY (`phase_id`, `project_id`, `company_id`) REFERENCES `general_project_phases` (`id`, `project_id`, `company_id`)");
    expect(planMigration).toContain("FOREIGN KEY (`task_id`, `project_id`, `company_id`) REFERENCES `general_project_tasks` (`id`, `project_id`, `company_id`)");
    expect(planMigration).toContain("FOREIGN KEY (`member_id`, `project_id`, `company_id`) REFERENCES `general_project_members` (`id`, `project_id`, `company_id`)");
    expect(planMigration).not.toMatch(/REFERENCES `professional_/u);
    expect(planRollback).toContain("@gp_plan_rows = 0 AND @gp_plan_replays = 0");
  });
});

describe("general project domain policy", () => {
  it("activates with a manager and rejects other transitions or a final project", () => {
    expect(transitionProject(project())).toBe("ACTIVE");
    expect(errorCode(() => transitionProject({ ...project(), activeManagerCount: 0 }))).toBe("ACTIVE_MANAGER_REQUIRED");
    expect(errorCode(() => transitionProject({ ...project(), to: "COMPLETED" }))).toBe("INVALID_PROJECT_TRANSITION");
    expect(errorCode(() => transitionProject({ ...project(), from: "CANCELLED" }))).toBe("PROJECT_FINAL");
  });

  it("does not complete a project or phase while work remains open", () => {
    expect(errorCode(() => transitionProject({ ...project(), from: "ACTIVE", to: "COMPLETED", taskStatuses: ["BLOCKED"] })))
      .toBe("PROJECT_WORK_OPEN");
    expect(errorCode(() => transitionPhase({ ...phase(), from: "IN_PROGRESS", to: "COMPLETED", taskStatuses: ["TODO"] })))
      .toBe("PHASE_WORK_OPEN");
    expect(transitionProject({ ...project(), from: "ACTIVE", to: "COMPLETED", phaseStatuses: ["CANCELLED"], taskStatuses: ["COMPLETED"] }))
      .toBe("COMPLETED");
  });

  it("requires explicit reasons for hold, cancel, and unblock", () => {
    expect(errorCode(() => transitionProject({ ...project(), from: "ACTIVE", to: "ON_HOLD" }))).toBe("REASON_REQUIRED");
    expect(errorCode(() => transitionPhase({ ...phase(), to: "CANCELLED" }))).toBe("REASON_REQUIRED");
    expect(errorCode(() => transitionTask({ ...task(), from: "BLOCKED", to: "TODO" }))).toBe("REASON_REQUIRED");
    expect(transitionTask({ ...task(), from: "BLOCKED", to: "TODO", reason: "Resolved explicitly" })).toBe("TODO");
  });

  it("gates task start by project, phase, responsibility, and finished dependencies", () => {
    expect(transitionTask(task())).toBe("IN_PROGRESS");
    expect(errorCode(() => transitionTask({ ...task(), projectStatus: "ON_HOLD" }))).toBe("PROJECT_NOT_ACTIVE");
    expect(errorCode(() => transitionTask({ ...task(), phaseStatus: "PLANNED" }))).toBe("PHASE_NOT_IN_PROGRESS");
    expect(errorCode(() => transitionTask({ ...task(), activeResponsibleCount: 0 }))).toBe("ACTIVE_RESPONSIBLE_REQUIRED");
    expect(errorCode(() => transitionTask({ ...task(), predecessorStatuses: ["CANCELLED"] }))).toBe("DEPENDENCY_BLOCKED");
    expect(errorCode(() => transitionTask({ ...task(), actorIsActiveResponsible: false }))).toBe("TASK_PROGRESS_DENIED");
    expect(transitionTask({ ...task(), actorCanManage: true, actorIsActiveResponsible: false })).toBe("IN_PROGRESS");
  });

  it("keeps blocking distinct from dependency status and cancellation manager-only", () => {
    expect(transitionTask({ ...task(), to: "BLOCKED", reason: "Waiting on supplier" })).toBe("BLOCKED");
    expect(errorCode(() => transitionTask({ ...task(), to: "CANCELLED", reason: "No longer needed" }))).toBe("TASK_MANAGE_REQUIRED");
    expect(errorCode(() => transitionTask({ ...task(), from: "BLOCKED", to: "IN_PROGRESS" }))).toBe("INVALID_TASK_TRANSITION");
    expect(errorCode(() => transitionTask({ ...task(), from: "COMPLETED" }))).toBe("TASK_FINAL");
  });

  it("rejects cycles, duplicates, self-links, cross-company links, and terminal tasks", () => {
    const a: GeneralProjectTaskNode = { id: "a", companyId: "c", projectId: "p", status: "TODO" };
    const b: GeneralProjectTaskNode = { ...a, id: "b" };
    const c: GeneralProjectTaskNode = { ...a, id: "c" };
    const tasks = [a, b, c];
    const dependencies = [{ predecessorId: "a", successorId: "b", active: true }, { predecessorId: "b", successorId: "c", active: true }];
    expect(() => validateDependencyAddition({ predecessor: a, successor: c, tasks, dependencies })).not.toThrow();
    expect(errorCode(() => validateDependencyAddition({ predecessor: c, successor: a, tasks, dependencies }))).toBe("DEPENDENCY_CYCLE");
    expect(errorCode(() => validateDependencyAddition({ predecessor: a, successor: b, tasks, dependencies }))).toBe("DEPENDENCY_DUPLICATE");
    expect(errorCode(() => validateDependencyAddition({ predecessor: a, successor: a, tasks, dependencies }))).toBe("DEPENDENCY_SELF_REFERENCE");
    expect(errorCode(() => validateDependencyAddition({ predecessor: a, successor: { ...b, companyId: "other" }, tasks, dependencies })))
      .toBe("DEPENDENCY_SCOPE_MISMATCH");
    expect(errorCode(() => validateDependencyAddition({ predecessor: { ...a, status: "CANCELLED" }, successor: b, tasks, dependencies })))
      .toBe("DEPENDENCY_FINAL_TASK");
  });
});
