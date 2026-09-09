import { describe, expect, it } from "vitest";
import {
  isNavigationItemVisible,
  navigationItems,
  resolveAuthorizedView,
  viewPermissionPolicies,
  type NavigationAccess,
} from "../app-navigation";
import { allows } from "../authorization";

const humanResources = navigationItems.find((item) => item.view === "humanResources")!;

function access(permissions: string[], entitled = true): NavigationAccess {
  return {
    moduleSet: new Set(entitled ? ["HUMAN_RESOURCES"] : []),
    permissionSet: new Set(permissions),
    hasSelectedCompany: true,
    platformOperations: false,
  };
}

describe("HR workspace navigation", () => {
  it.each([
    ["employees-only", ["hr.employees.view"]],
    ["structure-only", ["hr.structure.view"]],
  ])("admits %s readers", (_label, permissions) => {
    expect(allows(new Set(permissions), viewPermissionPolicies.humanResources)).toBe(true);
    expect(isNavigationItemVisible(humanResources, access(permissions))).toBe(true);
    expect(resolveAuthorizedView("humanResources", access(permissions))).toBe("humanResources");
  });

  it.each([
    ["no permissions", []],
    ["contracts only", ["hr.contracts.view"]],
  ])("rejects %s because contracts require an employee record", (_label, permissions) => {
    expect(allows(new Set(permissions), viewPermissionPolicies.humanResources)).toBe(false);
    expect(isNavigationItemVisible(humanResources, access(permissions))).toBe(false);
    expect(resolveAuthorizedView("humanResources", access(permissions))).toBe("home");
  });

  it("still requires the HUMAN_RESOURCES entitlement", () => {
    expect(isNavigationItemVisible(humanResources, access(["hr.employees.view"], false))).toBe(false);
  });
});
