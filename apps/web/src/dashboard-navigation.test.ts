import { describe, expect, it } from "vitest";
import { deriveDashboardNavigation } from "./dashboard-navigation";
import type { NavigationAccess } from "./app-navigation";
import type { PlatformModuleCode } from "./types";

function access(permissions: string[], modules: PlatformModuleCode[] = ["REPORTING", "POS", "SALES", "PURCHASES", "TREASURY"]): NavigationAccess {
  return {
    moduleSet: new Set(modules),
    permissionSet: new Set(permissions),
    hasSelectedCompany: true,
    platformOperations: false,
  };
}

describe("dashboard navigation", () => {
  it("does not expose destinations to a dashboard-only reader", () => {
    const model = deriveDashboardNavigation(access(["dashboard.view"]));

    expect([...model.allowedViews]).toEqual([]);
    expect(model.quickStarts).toEqual([]);
    expect(model.overviewViews).toEqual([]);
    expect(model.canOpenReports).toBe(false);
  });

  it("keeps individually authorized destinations discoverable", () => {
    const model = deriveDashboardNavigation(access([
      "dashboard.view",
      "sales_invoices.view",
      "suppliers.view",
      "reports.cash_flow.view",
    ]));

    expect(model.quickStarts.map((item) => item.view)).toEqual(["sales"]);
    expect(model.overviewViews).toEqual(["suppliers"]);
    expect(model.canOpenReports).toBe(true);
    expect([...model.allowedViews]).toEqual(["sales", "suppliers", "reports"]);
  });

  it("requires both the destination permission and its module entitlement", () => {
    const model = deriveDashboardNavigation(access(["sales_invoices.view"], ["REPORTING"]));

    expect(model.quickStarts).toEqual([]);
    expect(model.allowedViews.has("sales")).toBe(false);
  });

  it("preserves all existing dashboard destinations for a fully authorized user", () => {
    const model = deriveDashboardNavigation(access([
      "pos.view",
      "sales_invoices.view",
      "purchase_invoices.view",
      "suppliers.view",
      "customers.view",
      "payments.view",
      "reports.cash_flow.view",
    ]));

    expect(model.quickStarts.map((item) => item.view)).toEqual(["pos", "sales", "purchases"]);
    expect(model.overviewViews).toEqual(["suppliers", "customers", "payments"]);
    expect(model.canOpenReports).toBe(true);
  });
});
