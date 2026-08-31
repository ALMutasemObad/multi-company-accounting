// Test-only entry. Renders the production home component with synthetic scope/data.
// Not imported by the production entry and never sends an API request or command.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import { AuthorizationProvider } from "../src/authorization-context";
import { I18nProvider, LanguageSwitcher, loadLocale, resolveLocale } from "../src/i18n";
import { SystemHomePage } from "../src/SystemHomePage";
import type { CurrentAuthorization } from "../src/types";
import "../src/styles.css";

let holdReads = false;
let respondEmpty = false;
const pending: Array<() => void> = [];
window.fetch = async (_input, init) => {
  if (init?.method && init.method !== "GET") throw new Error("Test fixture rejects all writes");
  const data = respondEmpty ? [] : [{ id: "1", isActive: true, accountType: "CASH", onHand: "3.000000" }];
  const response = () => new Response(JSON.stringify({ data, meta: { page: 1, pageSize: 1, total: data.length, totalPages: data.length } }), { status: 200, headers: { "Content-Type": "application/json" } });
  return holdReads ? new Promise((resolve) => pending.push(() => resolve(response()))) : response();
};
const initial: CurrentAuthorization = {
  user: { id: "1", displayName: "Synthetic operator" }, selectedCompany: { id: "1", name: "بقالة الاختبار · Synthetic grocery", timezone: "Asia/Riyadh" },
  modules: ["POS", "INVENTORY", "SALES", "PURCHASES", "CORE_ACCOUNTING", "TREASURY", "REPORTING"],
  permissions: ["pos.view", "pos.checkout", "warehouses.view", "inventory_catalog.view", "inventory_barcodes.view", "inventory_movements.view", "cash_bank_accounts.view", "purchase_invoices.view", "suppliers.view", "sales_invoices.view", "receipts.view", "reports.cash_flow.view", "settings.manage", "companies.view", "currencies.view", "fiscal_periods.view", "sales_catalog.view"],
};

function Harness() {
  const [authorization, setAuthorization] = useState(initial);
  const [target, setTarget] = useState("");
  const [connected, setConnected] = useState(false);
  return <I18nProvider>
    <aside style={{ padding: 16, border: "2px dashed #7a6b32", margin: 16 }} dir="ltr">
      <p>Synthetic test fixture — no live records or checkout. The home below is the production component.</p>
      <LanguageSwitcher />
      <button onClick={() => setAuthorization({ ...initial, selectedCompany: { ...initial.selectedCompany!, id: "2", name: "Second test company" } })}>Switch company</button>
      <button onClick={() => setAuthorization({ ...initial, user: { id: "2", displayName: "Second user" } })}>Switch user</button>
      <button onClick={() => setAuthorization({ ...initial, permissions: ["pos.view"] })}>Revoke setup access</button>
      <button onClick={() => setAuthorization({ ...initial, selectedCompany: null })}>No company</button>
      <button onClick={() => { holdReads = true; }}>Hold reads</button>
      <button onClick={() => { respondEmpty = true; holdReads = false; pending.splice(0).forEach((release) => release()); }}>Release old reads</button>
      <button onClick={() => setConnected(true)}>Connect section callback</button>
      <output data-testid="navigation-target">{target}</output>
    </aside>
    <main style={{ padding: 24, maxWidth: 1280, margin: "auto" }}>
      <AuthorizationProvider authorization={authorization}>
        <SystemHomePage onNavigate={(view) => setTarget(view)} onOpenSetupTarget={connected ? (value) => setTarget(JSON.stringify(value)) : undefined} />
      </AuthorizationProvider>
    </main>
  </I18nProvider>;
}
await loadLocale("ar");
await loadLocale(resolveLocale(localStorage.getItem("mcap.locale")));
createRoot(document.getElementById("root")!).render(<Harness />);
