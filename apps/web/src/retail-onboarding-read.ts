import { api } from "./api";
import type { NavigationAccess } from "./app-navigation";
import { assertRequestActive } from "./request-scope";
import type { PlatformModuleCode } from "./types";
import type { RetailFactId, RetailFacts, RetailFactState } from "./retail-onboarding-model";

type FactDefinition = { id: RetailFactId; module: PlatformModuleCode; permission: string; path: string };
export const retailFactDefinitions: readonly FactDefinition[] = [
  { id: "warehouses", module: "INVENTORY", permission: "warehouses.view", path: "/warehouses?page=1&pageSize=1&active=true" },
  { id: "units", module: "INVENTORY", permission: "inventory_catalog.view", path: "/units-of-measure?page=1&pageSize=1&active=true" },
  { id: "items", module: "INVENTORY", permission: "inventory_catalog.view", path: "/inventory-items?page=1&pageSize=1&active=true" },
  { id: "stock", module: "INVENTORY", permission: "inventory_movements.view", path: "/inventory-balances?page=1&pageSize=1&nonZero=true" },
  { id: "cash", module: "TREASURY", permission: "cash_bank_accounts.view", path: "/cash-bank-accounts?page=1&pageSize=1&active=true&type=CASH" },
];

export function canReadRetailFact(fact: FactDefinition, access: NavigationAccess) {
  return access.hasSelectedCompany && access.moduleSet.has(fact.module) && access.permissionSet.has(fact.permission);
}

export function initialRetailFacts(access: NavigationAccess, pending = false): RetailFacts {
  return Object.fromEntries(retailFactDefinitions.map((fact) => [fact.id,
    canReadRetailFact(fact, access) ? pending ? "loading" : "notChecked" : "unavailable",
  ])) as RetailFacts;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

// Validate only the evidence used here. A sample proves existence, never catalogue
// coverage, stock sufficiency, a configured barcode/price, or checkout readiness.
export function retailEvidence(id: RetailFactId, payload: unknown): "found" | "empty" {
  if (!record(payload) || !Array.isArray(payload.data) || !record(payload.meta)) throw new Error("Invalid evidence");
  const { data, meta } = payload;
  if (meta.page !== 1 || meta.pageSize !== 1 || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0
    || data.length > 1 || (data.length === 0) !== (meta.total === 0)) throw new Error("Invalid evidence");
  if (!data.length) return "empty";
  const item: unknown = data[0];
  if (!record(item) || typeof item.id !== "string" || !/^[1-9][0-9]*$/u.test(item.id)) throw new Error("Invalid evidence");
  if (id === "stock") {
    if (typeof item.onHand !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(item.onHand) || !/[1-9]/u.test(item.onHand)) throw new Error("Invalid evidence");
  } else if (item.isActive !== true || (id === "cash" && item.accountType !== "CASH")) throw new Error("Invalid evidence");
  return "found";
}

type Reader = (path: string, options: { signal: AbortSignal; timeoutMs: number }) => Promise<unknown>;
export async function readRetailFacts(access: NavigationAccess, signal: AbortSignal, reader: Reader = api): Promise<RetailFacts> {
  assertRequestActive(signal);
  const pairs = await Promise.all(retailFactDefinitions.map(async (fact): Promise<[RetailFactId, RetailFactState]> => {
    if (!canReadRetailFact(fact, access)) return [fact.id, "unavailable"];
    try {
      const payload = await reader(fact.path, { signal, timeoutMs: 10_000 });
      assertRequestActive(signal);
      return [fact.id, retailEvidence(fact.id, payload)];
    } catch {
      assertRequestActive(signal);
      return [fact.id, "error"];
    }
  }));
  assertRequestActive(signal);
  return Object.fromEntries(pairs) as RetailFacts;
}
