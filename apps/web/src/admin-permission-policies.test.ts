import { describe, expect, it } from "vitest";
import { allows } from "./authorization";
import {
  adminPermissionPolicies,
  visibleAdminTabs,
} from "./admin-permission-policies";
import { viewPermissionPolicies } from "./app-navigation";

describe("administration permission policies", () => {
  it.each([
    ["users.view", "users"],
    ["roles.view", "roles"],
    ["auth.sessions.view", "sessions"],
  ] as const)("uses %s as an independent navigation and tab boundary", (permission, tab) => {
    const permissionSet = new Set([permission]);
    expect(allows(permissionSet, adminPermissionPolicies.navigation)).toBe(true);
    expect(visibleAdminTabs(permissionSet)).toEqual([tab]);
    expect(allows(permissionSet, viewPermissionPolicies.admin)).toBe(true);
  });

  it("fails closed when no administration read permission exists", () => {
    const permissionSet = new Set(["users.create", "roles.manage", "auth.sessions.revoke"]);
    expect(allows(permissionSet, adminPermissionPolicies.navigation)).toBe(false);
    expect(visibleAdminTabs(permissionSet)).toEqual([]);
  });

  it("keeps user write actions independent", () => {
    const permissionSet = new Set(["users.view", "users.update"]);
    expect(allows(permissionSet, adminPermissionPolicies.users.update)).toBe(true);
    expect(allows(permissionSet, adminPermissionPolicies.users.create)).toBe(false);
    expect(allows(permissionSet, adminPermissionPolicies.users.disable)).toBe(false);
  });

  it("requires both the employee-options read and link write permissions", () => {
    expect(allows(new Set(["users.create"]), adminPermissionPolicies.users.linkEmployee)).toBe(false);
    expect(allows(new Set(["users.update"]), adminPermissionPolicies.users.linkEmployee)).toBe(false);
    expect(allows(new Set(["users.create", "users.update"]), adminPermissionPolicies.users.linkEmployee)).toBe(true);
  });

  it("requires role visibility and management before role assignment is mounted", () => {
    expect(allows(new Set(["roles.manage"]), adminPermissionPolicies.users.assignRoles)).toBe(false);
    expect(allows(new Set(["roles.view"]), adminPermissionPolicies.users.assignRoles)).toBe(false);
    expect(allows(new Set(["roles.view", "roles.manage"]), adminPermissionPolicies.users.assignRoles)).toBe(true);
  });

  it("does not infer role or session writes from view permissions", () => {
    expect(allows(new Set(["roles.view"]), adminPermissionPolicies.roles.manage)).toBe(false);
    expect(allows(new Set(["auth.sessions.view"]), adminPermissionPolicies.sessions.revoke)).toBe(false);
    expect(allows(new Set(["auth.sessions.revoke"]), adminPermissionPolicies.sessions.revoke)).toBe(true);
  });
});
