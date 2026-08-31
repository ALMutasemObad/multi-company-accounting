import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NavigationAccess } from "./app-navigation";
import { AuthorizationProvider } from "./authorization-context";
import { I18nProvider, loadLocale } from "./i18n";
import { SystemHomePage } from "./SystemHomePage";
import { initialRetailStep, retailActions, retailSteps, showRetailGuide } from "./retail-onboarding-model";
import { initialRetailFacts, readRetailFacts, retailEvidence, retailFactDefinitions } from "./retail-onboarding-read";
import { effectivePermissionSet } from "./module-entitlements";
import type { CurrentAuthorization, PlatformModuleCode } from "./types";

const modules: PlatformModuleCode[] = ["SALES", "INVENTORY", "TREASURY", "POS", "REPORTING", "CORE_ACCOUNTING", "PURCHASES"];
const permissions = ["warehouses.view", "inventory_catalog.view", "inventory_movements.view", "inventory_barcodes.view", "cash_bank_accounts.view", "pos.view", "pos.checkout", "settings.manage", "companies.view", "currencies.view", "fiscal_periods.view", "sales_invoices.view", "receipts.view", "reports.cash_flow.view", "purchase_invoices.view", "suppliers.view"];
function access(granted = permissions, enabled = modules, company = true): NavigationAccess {
  const moduleSet = new Set(enabled);
  return { permissionSet: effectivePermissionSet(granted, moduleSet), moduleSet, hasSelectedCompany: company, platformOperations: false };
}
const list = (data: unknown[], total = data.length) => ({ data, meta: { page: 1, pageSize: 1, total, totalPages: total } });
const active = { id: "1", isActive: true, accountType: "CASH", onHand: "2.000000" };

describe("R3 real navigation and isolated evidence", () => {
  it("keeps the workflow ordered and opens only authorized real screens", () => {
    expect(retailSteps.map((step) => step.id)).toEqual(["business", "catalog", "stock", "cash", "checkout", "results"]);
    expect(initialRetailStep(access())).toBe("business");
    const cashier = access(["pos.view", "pos.checkout"]);
    expect(initialRetailStep(cashier)).toBe("checkout");
    expect(retailActions(retailSteps[1]!, cashier)).toEqual([]);
    expect(retailActions(retailSteps[4]!, access(["pos.view"]))).toEqual([]);
    expect(retailActions(retailSteps[5]!, access(["pos.view"])).map((action) => action.target.view)).toEqual(["pos"]);
    // Foundation settings remain authorized independently of commercial modules.
    expect(retailSteps.flatMap((step) => retailActions(step, access(permissions, []))).map((action) => action.id)).toEqual(["settings"]);
    expect(retailSteps.flatMap((step) => retailActions(step, access(permissions, modules, false)))).toEqual([]);
  });

  it("requires tab-specific permissions as well as the page policy", () => {
    const warehouseOnly = access(["warehouses.view"]);
    expect(retailActions(retailSteps[1]!, warehouseOnly)).toEqual([]);
    expect(retailActions(retailSteps[2]!, warehouseOnly).map((action) => action.id)).toEqual(["warehouses"]);
    expect(retailActions(retailSteps[1]!, access(["inventory_catalog.view"]))).toEqual([]);
    expect(retailActions(retailSteps[1]!, access(["warehouses.view", "inventory_catalog.view"])).map((action) => action.id)).toEqual(["items", "units"]);
  });

  it("keeps selling setup closed until its explicit permission AND both modules are available", () => {
    const integrated = access();
    // R0 owns the central sales_catalog entitlement mapping. Inject its effective
    // permission to test the approved future composition without editing it here.
    integrated.permissionSet = new Set([...integrated.permissionSet, "sales_catalog.view"]);
    expect(retailActions(retailSteps[1]!, integrated).find((action) => action.id === "sellingProfile")?.target).toEqual({ view: "inventory", section: "items" });
    expect(retailActions(retailSteps[1]!, access()).some((action) => action.id === "sellingProfile")).toBe(false);
    integrated.moduleSet = new Set(["INVENTORY"]);
    expect(retailActions(retailSteps[1]!, integrated).some((action) => action.id === "sellingProfile")).toBe(false);
    integrated.moduleSet = new Set(modules);
    integrated.permissionSet = new Set(["sales_catalog.view", "warehouses.view"]);
    expect(retailActions(retailSteps[1]!, integrated).some((action) => action.id === "sellingProfile")).toBe(false);
  });

  it("does not reinterpret a service company or no company as retail", () => {
    expect(showRetailGuide(access([], ["PROFESSIONAL_PROJECTS"]))).toBe(false);
    expect(showRetailGuide(access([], modules, false))).toBe(false);
    expect(showRetailGuide(access())).toBe(true);
  });

  it("performs no unavailable reads, never treating an unverified fact as empty", async () => {
    const reader = vi.fn(async () => list([active]));
    const states = await readRetailFacts(access([], modules), new AbortController().signal, reader);
    expect(reader).not.toHaveBeenCalled();
    expect(Object.values(states)).toEqual(Array(5).fill("unavailable"));
    await readRetailFacts(access(permissions, []), new AbortController().signal, reader);
    await readRetailFacts(access(permissions, modules, false), new AbortController().signal, reader);
    expect(reader).not.toHaveBeenCalled();
  });

  it("checks only a bounded page per authorized fact without writes or identifiers in state", async () => {
    const reader = vi.fn(async () => list([active], 1_000));
    const states = await readRetailFacts(access(), new AbortController().signal, reader);
    expect(Object.values(states)).toEqual(Array(5).fill("found"));
    expect(reader).toHaveBeenCalledTimes(5);
    for (const [path, options] of reader.mock.calls as unknown as [string, { timeoutMs: number }][]) {
      expect(path).toContain("pageSize=1");
      expect(options.timeoutMs).toBe(10_000);
      expect(options).not.toHaveProperty("method");
    }
    expect(JSON.stringify(states)).not.toContain('"1"');
  });

  it("does not fail the other facts when one read fails and does not retry", async () => {
    const reader = vi.fn(async (path: string) => {
      if (path.startsWith("/inventory-items")) throw new Error("sensitive server detail");
      return list([]);
    });
    expect(await readRetailFacts(access(), new AbortController().signal, reader)).toEqual({ warehouses: "empty", units: "empty", items: "error", stock: "empty", cash: "empty" });
    expect(reader).toHaveBeenCalledTimes(5);
  });

  it("rejects malformed/contradictory evidence, inactive cash and imprecise quantities", () => {
    for (const payload of [{}, list([], 5), list([active], 0), list([active, active]), list([{ ...active, isActive: false }])]) {
      expect(() => retailEvidence("items", payload)).toThrow();
    }
    expect(() => retailEvidence("cash", list([{ ...active, accountType: "BANK" }]))).toThrow();
    expect(() => retailEvidence("stock", list([{ ...active, onHand: 2 }]))).toThrow();
    expect(() => retailEvidence("stock", list([{ ...active, onHand: "0.000000" }]))).toThrow();
    expect(retailEvidence("stock", list([{ ...active, onHand: "9999999999999.123456" }]))).toBe("found");
  });

  it("discards late reads after cancellation and never starts with an aborted scope", async () => {
    const controller = new AbortController();
    let complete!: (value: unknown) => void;
    const reader = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const pending = readRetailFacts(access(["warehouses.view"]), controller.signal, reader);
    controller.abort();
    complete(list([active]));
    await expect(pending).rejects.toThrow();
    await expect(readRetailFacts(access(), controller.signal, reader)).rejects.toThrow();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("starts fresh, without deriving completion from visits or facts", async () => {
    await loadLocale("ar");
    expect(Object.values(initialRetailFacts(access()))).toEqual(Array(5).fill("notChecked"));
    expect(retailFactDefinitions).toHaveLength(5);
    const authorization: CurrentAuthorization = { user: { id: "1", displayName: "Test" }, selectedCompany: null, permissions, modules };
    const markup = renderToStaticMarkup(<I18nProvider><AuthorizationProvider authorization={authorization}><SystemHomePage onNavigate={() => undefined} /></AuthorizationProvider></I18nProvider>);
    expect(markup).not.toContain("retail-onboarding\"");
    expect(markup).not.toContain("data-setup-action");
  });
});
