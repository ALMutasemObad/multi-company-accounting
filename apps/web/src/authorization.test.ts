import { describe, expect, it, vi } from "vitest";
import { allows, can, canAll, canAny, requestIfAllowed } from "./authorization";
import { actionPermissionPolicies } from "./action-permissions";
import { endpointPermissionPolicies, referenceEndpointPermission } from "./endpoint-permissions";
import {
  navigationItems,
  resolveAuthorizedView,
  viewPermissionPolicies,
  visibleNavigationItems,
  visibleSystemGroups,
  type NavigationAccess,
} from "./app-navigation";
import { effectivePermissionSet } from './module-entitlements';
import type { PlatformModuleCode } from './types';

const activeModules: PlatformModuleCode[] = [
  'CORE_ACCOUNTING', 'SALES', 'PURCHASES', 'TREASURY', 'INVENTORY', 'POS',
  'REPORTING', 'DATA_IMPORT', 'APPROVALS', 'PROFESSIONAL_PROJECTS',
  'HUMAN_RESOURCES', 'TAX',
];

const access = (
  permissions: string[],
  overrides: Partial<Omit<NavigationAccess, "permissionSet">> = {},
): NavigationAccess => {
  const moduleSet = overrides.moduleSet ?? new Set(activeModules);
  return {
    moduleSet,
    permissionSet: effectivePermissionSet(permissions, moduleSet),
    hasSelectedCompany: true,
    platformOperations: false,
    ...overrides,
  };
};

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

  it("does not invoke a request factory when its endpoint permission is absent", async () => {
    const request = vi.fn(async () => "loaded");

    await expect(requestIfAllowed(
      new Set(["sales_invoices.view"]),
      endpointPermissionPolicies.fiscalPeriods,
      request,
    )).resolves.toEqual({ status: "skipped" });
    expect(request).not.toHaveBeenCalled();
  });

  it("captures an allowed optional request failure without rejecting the bundle", async () => {
    const failure = new Error("network failure");

    await expect(requestIfAllowed(
      new Set(["accounts.view"]),
      endpointPermissionPolicies.accounts,
      async () => { throw failure; },
    )).resolves.toEqual({ status: "rejected", reason: failure });
  });

  it("maps lazy reference endpoints to the same OpenAPI read permissions", () => {
    expect(referenceEndpointPermission("/accounts?active=true")).toEqual(endpointPermissionPolicies.accounts);
    expect(referenceEndpointPermission("/payment-methods?active=true")).toEqual(endpointPermissionPolicies.paymentMethods);
    expect(referenceEndpointPermission("/inventory-items?active=true")).toEqual(endpointPermissionPolicies.inventoryCatalog);
    expect(referenceEndpointPermission("/unknown-reference")).toBeUndefined();
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

  it('does not expose a module from RBAC alone when its company entitlement is absent', () => {
    const tenantAccess = access(['sales_invoices.view', 'sales_invoices.create'], {
      moduleSet: new Set<PlatformModuleCode>(['REPORTING']),
    });

    expect(visibleNavigationItems(tenantAccess).map((item) => item.view)).toEqual(['home']);
    expect(allows(tenantAccess.permissionSet, actionPermissionPolicies.salesInvoices.create)).toBe(false);
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
