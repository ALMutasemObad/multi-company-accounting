import { describe, expect, it } from "vitest";
import { isNavigationItemVisible, navigationItems, type NavigationAccess } from "./app-navigation";
import { effectivePermissionSet } from "./module-entitlements";
import type { PlatformModuleCode } from "./types";

const reports = navigationItems.find((item) => item.view === "reports")!;
function access(modules: PlatformModuleCode[], permissions: string[]): NavigationAccess {
  const moduleSet = new Set(modules);
  return { moduleSet, permissionSet: effectivePermissionSet(permissions, moduleSet), hasSelectedCompany: true, platformOperations: false };
}

describe("report center navigation", () => {
  it("is available to an inventory count manager without a financial reporting subscription", () => {
    expect(isNavigationItemVisible(reports, access(["INVENTORY"], ["inventory_counts.manage"]))).toBe(true);
    expect(isNavigationItemVisible(reports, access(["INVENTORY"], ["inventory_counts.enter"]))).toBe(false);
  });

  it("still requires an entitled module and the corresponding permission", () => {
    expect(isNavigationItemVisible(reports, access(["REPORTING"], ["reports.cash_flow.view"]))).toBe(true);
    expect(isNavigationItemVisible(reports, access(["REPORTING"], ["inventory_counts.manage"]))).toBe(false);
    expect(isNavigationItemVisible(reports, access([], ["inventory_counts.manage", "reports.cash_flow.view"]))).toBe(false);
  });
});
