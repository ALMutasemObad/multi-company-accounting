import { api, ApiError } from "./api";
import { allows } from "./authorization";
import { posPermissionPolicies, type NavigationAccess } from "./app-navigation";
import { assertRequestActive, RequestError } from "./request-scope";
import type { PlatformModuleCode } from "./types";
import type {
  PosReadinessFactId, PosReadinessFacts, PosReadinessState,
  RetailFactId, RetailFacts, RetailFactState,
} from "./retail-onboarding-model";

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

type PosReadinessFactDefinition = {
  id: PosReadinessFactId;
  module: PlatformModuleCode;
  permission: string;
  path: string;
};

/** These are bounded, read-only existence probes. They deliberately omit search
 * so a user's transient picker query cannot be misreported as missing setup. */
export const posReadinessFactDefinitions: readonly PosReadinessFactDefinition[] = [
  { id: "warehouseId", module: "INVENTORY", permission: "warehouses.view", path: "/pos/context/options/warehouseId?page=1&pageSize=1" },
  { id: "cashBankAccountId", module: "TREASURY", permission: "cash_bank_accounts.view", path: "/pos/context/options/cashBankAccountId?page=1&pageSize=1" },
  { id: "paymentMethodId", module: "TREASURY", permission: "cash_bank_accounts.view", path: "/pos/context/options/paymentMethodId?page=1&pageSize=1" },
  { id: "currencyId", module: "POS", permission: "currencies.view", path: "/pos/context/options/currencyId?page=1&pageSize=1" },
  { id: "catalog", module: "SALES", permission: "sales_catalog.view", path: "/sales/catalog?page=1&pageSize=1" },
];

export function canReadPosReadinessFact(fact: PosReadinessFactDefinition, access: NavigationAccess) {
  return access.hasSelectedCompany && access.moduleSet.has("POS") && access.moduleSet.has(fact.module)
    && allows(access.permissionSet, posPermissionPolicies.checkout) && access.permissionSet.has(fact.permission);
}

export function initialPosReadinessFacts(access: NavigationAccess, pending = false): PosReadinessFacts {
  return Object.fromEntries(posReadinessFactDefinitions.map((fact) => [fact.id,
    canReadPosReadinessFact(fact, access) ? pending ? "loading" : "notChecked" : "forbidden",
  ])) as PosReadinessFacts;
}

export function posReadinessEvidence(payload: unknown): "ready" | "empty" {
  if (!record(payload) || !Array.isArray(payload.data) || !record(payload.meta)) throw new Error("Invalid POS readiness evidence");
  const { data, meta } = payload;
  if (meta.page !== 1 || meta.pageSize !== 1 || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0
    || !Number.isSafeInteger(meta.totalPages) || (meta.totalPages as number) < 0 || data.length > 1
    || (data.length === 0) !== (meta.total === 0)) throw new Error("Invalid POS readiness evidence");
  return data.length ? "ready" : "empty";
}

export function posReadinessFailure(cause: unknown): Extract<PosReadinessState, "forbidden" | "timeout" | "error"> {
  if (cause instanceof ApiError && cause.status === 403) return "forbidden";
  if (cause instanceof RequestError && cause.kind === "timeout") return "timeout";
  return "error";
}

export async function readPosReadinessFacts(access: NavigationAccess, signal: AbortSignal, reader: Reader = api): Promise<PosReadinessFacts> {
  assertRequestActive(signal);
  const pairs = await Promise.all(posReadinessFactDefinitions.map(async (fact): Promise<[PosReadinessFactId, PosReadinessState]> => {
    if (!canReadPosReadinessFact(fact, access)) return [fact.id, "forbidden"];
    try {
      const payload = await reader(fact.path, { signal, timeoutMs: 10_000 });
      assertRequestActive(signal);
      return [fact.id, posReadinessEvidence(payload)];
    } catch (cause) {
      assertRequestActive(signal);
      return [fact.id, posReadinessFailure(cause)];
    }
  }));
  assertRequestActive(signal);
  return Object.fromEntries(pairs) as PosReadinessFacts;
}
