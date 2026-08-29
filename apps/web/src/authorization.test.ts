import { describe, expect, it } from "vitest";
import { allows, can, canAll, canAny } from "./authorization";
import { actionPermissionPolicies } from "./action-permissions";
import {
  navigationItems,
  resolveAuthorizedView,
  viewPermissionPolicies,
  visibleNavigationItems,
  visibleSystemGroups,
  type NavigationAccess,
} from "./app-navigation";

const access = (
  permissions: string[],
  overrides: Partial<Omit<NavigationAccess, "permissionSet">> = {},
): NavigationAccess => ({
  permissionSet: new Set(permissions),
  hasSelectedCompany: true,
  platformOperations: false,
  ...overrides,
});

describe("authorization predicates", () => {
  const permissions = new Set(["sales_invoices.view", "sales_invoices.create", "accounts.view"]);

  it("evaluates single, any, and all policies", () => {
    expect(can(permissions, "sales_invoices.view")).toBe(true);
    expect(can(permissions, "sales_invoices.post")).toBe(false);
    expect(canAny(permissions, ["sales_invoices.post", "accounts.view"])).toBe(true);
    expect(canAll(permissions, ["sales_invoices.view", "sales_invoices.create"])).toBe(true);
    expect(canAll(permissions, ["sales_invoices.view", "sales_invoices.post"])).toBe(false);
    expect(allows(permissions, { permission: "accounts.view" })).toBe(true);
  });

  it("fails closed for empty requirements", () => {
    expect(can(permissions, "")).toBe(false);
    expect(canAny(permissions, [])).toBe(false);
    expect(canAll(permissions, [])).toBe(false);
  });
});

describe("permission-aware navigation", () => {
  it("shows only tenant modules allowed by centralized policies", () => {
    const tenantAccess = access(["dashboard.view", "sales_invoices.view"]);
    expect(visibleNavigationItems(tenantAccess).map((item) => item.view)).toEqual([
      "home",
      "dashboard",
      "sales",
    ]);
    expect(visibleSystemGroups(tenantAccess).flatMap((group) => group.modules.map((item) => item.view))).toEqual([
      "sales",
      "dashboard",
    ]);
  });

  it("routes an unauthorized direct hash back to the tenant home", () => {
    expect(resolveAuthorizedView("payments", access(["sales_invoices.view"]))).toBe("home");
  });

  it("keeps platform capability independent from tenant permissions", () => {
    const tenantOperator = access([], { platformOperations: true });
    expect(visibleNavigationItems(tenantOperator).map((item) => item.view)).toEqual(["home", "platform"]);

    const permissionWithoutCapability = access(["platform.operations"]);
    expect(visibleNavigationItems(permissionWithoutCapability).some((item) => item.view === "platform")).toBe(false);
  });

  it("allows an operator without tenant membership to enter only Platform Operations", () => {
    const platformOnlyAccess = access([], {
      hasSelectedCompany: false,
      platformOperations: true,
    });
    expect(visibleNavigationItems(platformOnlyAccess).map((item) => item.view)).toEqual(["platform"]);
    expect(visibleSystemGroups(platformOnlyAccess)).toEqual([]);
    expect(resolveAuthorizedView("sales", platformOnlyAccess)).toBe("platform");
  });

  it("defines a policy for every non-home tenant navigation item", () => {
    const tenantViews = navigationItems
      .map((item) => item.view)
      .filter((view) => view !== "home" && view !== "platform")
      .sort();
    expect(Object.keys(viewPermissionPolicies).sort()).toEqual(tenantViews);
  });
});

describe("high-risk action policies", () => {
  it("maps financial document actions to their explicit server permissions", () => {
    const expectedActions = ["create", "update", "post", "cancel", "reverse", "print"] as const;
    const documentPolicies = {
      sales_invoices: actionPermissionPolicies.salesInvoices,
      purchase_invoices: actionPermissionPolicies.purchaseInvoices,
      receipts: actionPermissionPolicies.receipts,
      payments: actionPermissionPolicies.payments,
    };

    for (const [permissionPrefix, policies] of Object.entries(documentPolicies)) {
      expect(Object.keys(policies)).toEqual(expectedActions);
      expect(expectedActions.map((action) => policies[action].permission)).toEqual(
        expectedActions.map((action) => `${permissionPrefix}.${action}`),
      );
    }
  });

  it("keeps document commands independently permissioned", () => {
    const permissions = new Set(["sales_invoices.update", "sales_invoices.print"]);
    expect(allows(permissions, actionPermissionPolicies.salesInvoices.update)).toBe(true);
    expect(allows(permissions, actionPermissionPolicies.salesInvoices.print)).toBe(true);
    expect(allows(permissions, actionPermissionPolicies.salesInvoices.post)).toBe(false);
    expect(allows(permissions, actionPermissionPolicies.salesInvoices.cancel)).toBe(false);
  });

  it("does not infer checkout or master-data management from view permissions", () => {
    expect(allows(new Set(["pos.view"]), actionPermissionPolicies.pos.checkout)).toBe(false);
    expect(allows(new Set(["customers.view"]), actionPermissionPolicies.customers.manage)).toBe(false);
    expect(allows(new Set(["suppliers.view"]), actionPermissionPolicies.suppliers.manage)).toBe(false);
  });
});
