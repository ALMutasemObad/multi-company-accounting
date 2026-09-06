import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeExpensesPage, ExpenseJourney } from "../EmployeeExpensesPage";
import { api } from "../api";
import { Button, Pagination } from "../ui";

// Executes the real page callbacks/effects with deferred API responses. DOM and
// native disabled behavior are covered separately by the browser acceptance test.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
const auth = vi.hoisted(() => ({ user: { id: "user-a" }, selectedCompany: { id: "company-a" }, permissionSet: new Set<string>() }));
vi.mock("react", async original => {
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const slot = hooks.cursor++;
    const old = hooks.cells[slot] as unknown[] | undefined;
    if (old && old.length === deps.length && old.every((value, index) => Object.is(value, deps[index]))) return;
    hooks.cells[slot] = deps;
    hooks.effects.push(() => { hooks.cleanups.get(slot)?.(); const cleanup = callback(); if (cleanup) hooks.cleanups.set(slot, cleanup); });
  };
  return { ...await original<typeof import("react")>(),
    useState: <T,>(initial: T | (() => T)) => {
      const slot = hooks.cursor++;
      if (!(slot in hooks.cells)) hooks.cells[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.cells[slot], (value: T | ((old: T) => T)) => { hooks.cells[slot] = typeof value === "function" ? (value as (old: T) => T)(hooks.cells[slot] as T) : value; }];
    },
    useRef: <T,>(initial: T) => { const slot = hooks.cursor++; if (!(slot in hooks.cells)) hooks.cells[slot] = { current: initial }; return hooks.cells[slot]; },
    useMemo: <T,>(callback: () => T) => callback(),
    useCallback: <T,>(callback: T, deps: unknown[]) => { const slot = hooks.cursor++; const old = hooks.cells[slot] as { callback: T; deps: unknown[] } | undefined; if (!old || !old.deps.every((value, index) => Object.is(value, deps[index]))) hooks.cells[slot] = { callback, deps }; return (hooks.cells[slot] as { callback: T }).callback; },
    useEffect: effect, useLayoutEffect: effect,
  };
});
vi.mock("../api", () => ({ api: vi.fn(), idempotencyKey: (_: string, id: string) => id }));
vi.mock("../authorization-context", () => ({ useAuthorization: () => auth }));
const translate = (key: string) => key;
vi.mock("../i18n", () => ({ useI18n: () => ({ t: translate, intlLocale: "en" }), localizedReferenceName: () => "Name" }));
const notify = vi.fn();
const transport = vi.mocked(api);
const response = (id = "claim-a") => ({ data: [{ id, purpose: id, status: "DRAFT", ownedByCurrentUser: true, version: 1, employee: {}, currency: { code: "SAR", decimals: 2 }, totalAmount: "12", lines: [] }], meta: { page: 1, pageSize: 10, total: 1, totalPages: 2 } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function nodes(tree: ReactNode, type: unknown): ReactElement<Record<string, any>>[] {
  return React.Children.toArray(tree).flatMap(child => React.isValidElement<{ children?: ReactNode }>(child)
    ? [...(child.type === type ? [child as ReactElement<Record<string, any>>] : []), ...nodes(child.props.children, type)] : []);
}
function render() { hooks.cursor = 0; const tree = ExpenseJourney({ notify }); hooks.effects.splice(0).forEach(effect => effect()); return tree; }
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); return render(); }
const posts = () => transport.mock.calls.filter(([, options]) => options?.method === "POST");
const gets = () => transport.mock.calls.filter(([path]) => path.startsWith("/employee-expense-claims?"));
const unmount = () => { hooks.cleanups.forEach(cleanup => cleanup()); hooks.cleanups.clear(); };
beforeEach(() => {
  unmount(); hooks.cells = []; hooks.effects = []; hooks.cursor = 0;
  vi.clearAllMocks();
  auth.user.id = "user-a"; auth.selectedCompany.id = "company-a";
  auth.permissionSet = new Set(["employee_expenses.view", "employee_expenses.submit", "employee_expenses.review"]);
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  transport.mockImplementation(async path => path === "/employee-expense-cost-centers" ? { data: [{ id: "center-a", code: "CC" }] } : response());
});
describe("expense journey", () => {
  it("refreshes mine/all/page 1 after create, including when already there", async () => {
    render(); let tree = await flush();
    nodes(tree, Pagination)[0].props.onChange(2); tree = render(); await flush();
    nodes(tree, "select").find(node => node.props.value === "")!.props.onChange({ target: { value: "" } });
    tree = render();
    nodes(tree, "form")[0].props.onSubmit({ preventDefault() {} });
    await flush(); await flush();
    expect(gets().at(-1)?.[0]).toBe("/employee-expense-claims?page=1&pageSize=10&scope=mine");
    const count = gets().length;
    tree = render(); nodes(tree, "form")[0].props.onSubmit({ preventDefault() {} });
    await flush(); await flush();
    expect(gets()).toHaveLength(count + 1);
  });
  it.each(["success", "failure"])("ignores an older list %s after filters change", async outcome => {
    const old = deferred<ReturnType<typeof response>>();
    transport.mockImplementation(async path => path.includes("scope=company") ? old.promise : path.includes("cost-centers") ? { data: [] } : response("new"));
    let tree = render();
    nodes(tree, "select").find(node => node.props.value === "company")!.props.onChange({ target: { value: "mine" } });
    render(); await flush();
    if (outcome === "success") old.resolve(response("old")); else old.reject(new Error("old error")); tree = await flush();
    expect(nodes(tree, "h2").some(node => node.props.children === "new")).toBe(true);
    expect(nodes(tree, "h2").some(node => node.props.children === "old")).toBe(false);
  });
  it("locks double create synchronously and preserves failed draft and retry key", async () => {
    render(); let tree = await flush();
    nodes(tree, "textarea")[0].props.onChange({ target: { value: "Client travel" } }); tree = render();
    const pending = deferred<object>(); transport.mockImplementation(async () => pending.promise);
    const submit = nodes(tree, "form")[0].props.onSubmit;
    submit({ preventDefault() {} }); submit({ preventDefault() {} });
    expect(posts()).toHaveLength(1);
    tree = render(); expect(nodes(tree, "textarea")[0].props.disabled).toBe(true);
    expect(nodes(tree, "fieldset")[0].props.disabled).toBe(true);
    pending.reject(new Error("offline")); tree = await flush();
    expect(nodes(tree, "textarea")[0].props.value).toBe("Client travel");
    expect(nodes(tree, "textarea")[0].props.disabled).toBe(false);
    nodes(tree, "form")[0].props.onSubmit({ preventDefault() {} }); await flush();
    expect(posts()).toHaveLength(2);
    expect(posts()[0][1]?.idempotencyKey).toBe(posts()[1][1]?.idempotencyKey);
  });
  it("retains the approval retry key and rejects a duplicate click", async () => {
    render(); let tree = await flush();
    const pending = deferred<object>(); transport.mockImplementation(async () => pending.promise);
    const submit = nodes(tree, Button).find(node => node.props.children === "employeeExpenses.submit")!.props.onClick;
    submit(); submit(); expect(posts()).toHaveLength(1);
    pending.reject(new Error("offline")); tree = await flush();
    nodes(tree, Button).find(node => node.props.children === "employeeExpenses.submit")!.props.onClick(); await flush();
    expect(posts()[0][1]?.idempotencyKey).toBe(posts()[1][1]?.idempotencyKey);
  });
  it("ignores write completion after unmount", async () => {
    render(); let tree = await flush();
    const pending = deferred<object>(); transport.mockImplementation(async () => pending.promise);
    nodes(tree, "form")[0].props.onSubmit({ preventDefault() {} });
    unmount(); pending.resolve({}); await flush(); expect(notify).not.toHaveBeenCalled();
  });
  it("does not fetch or expose creation without permissions", async () => {
    auth.permissionSet.clear(); render(); const tree = await flush();
    expect(transport).not.toHaveBeenCalled(); expect(nodes(tree, "form")).toHaveLength(0);
    expect(nodes(tree, Button).filter(node => node.props.children === "employeeExpenses.submit")).toHaveLength(0);
  });
  it("uses mine for a non-reviewer and hides submit for read-only access", async () => {
    auth.permissionSet = new Set(["employee_expenses.view"]); render(); const tree = await flush();
    expect(gets()[0][0]).toContain("scope=mine"); expect(nodes(tree, "form")).toHaveLength(0);
    expect(nodes(tree, Button).filter(node => node.props.children === "employeeExpenses.submit")).toHaveLength(0);
  });
  it("changes the React boundary on company, user or permission change", () => {
    const first = EmployeeExpensesPage({ notify })!.key;
    auth.selectedCompany.id = "company-b"; const company = EmployeeExpensesPage({ notify })!.key;
    auth.user.id = "user-b"; const user = EmployeeExpensesPage({ notify })!.key;
    auth.permissionSet.clear(); const permissions = EmployeeExpensesPage({ notify })!.key;
    expect(new Set([first, company, user, permissions]).size).toBe(4);
  });
});
