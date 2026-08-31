import React, { useState } from "react";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import { createRoot } from "react-dom/client";
import { PosPage } from "../../apps/web/src/PosPage";
import { AuthorizationProvider } from "../../apps/web/src/authorization-context";
import { I18nProvider, LanguageSwitcher, loadLocale, resolveLocale } from "../../apps/web/src/i18n";
import { setCsrfToken } from "../../apps/web/src/api";
import type { PlatformModuleCode } from "../../apps/web/src/types";
import "../../apps/web/src/styles.css";
setCsrfToken("r1-local-test-token");
const permissions = ["pos.view", "pos.checkout", "sales_catalog.view", "sales_invoices.view", "inventory_barcodes.resolve", "accounts.view", "fiscal_periods.view", "currencies.view", "customers.view", "warehouses.view", "cash_bank_accounts.view", "receipts.view"];
const modules: PlatformModuleCode[] = ["CORE_ACCOUNTING", "POS", "SALES", "TREASURY", "INVENTORY", "TAX"];
function Harness() {
  const [company, setCompany] = useState("1");
  const [user, setUser] = useState("1");
  const [role, setRole] = useState("cashier");
  const [show, setShow] = useState(true);
  const [notice, setNotice] = useState("");
  return <I18nProvider><div style={{ maxWidth: 1440, margin: "auto", padding: 16 }}>
    <aside aria-label="Local test controls" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
      <LanguageSwitcher /><label>Test company<select aria-label="Test company" value={company} onChange={(event) => setCompany(event.target.value)}><option>1</option><option>2</option></select></label>
      <label>Test user<select aria-label="Test user" value={user} onChange={(event) => setUser(event.target.value)}><option>1</option><option>2</option></select></label>
      <label>Test role<select aria-label="Test role" value={role} onChange={(event) => setRole(event.target.value)}><option value="cashier">Cashier</option><option value="viewer">Viewer</option><option value="no-catalog">No catalog</option><option value="no-sales-module">No Sales module</option></select></label>
      <button type="button" onClick={() => setShow(!show)}>Toggle POS mount</button><span>LOCAL TEST FIXTURES · NO REAL CHECKOUT</span>
    </aside>
    <AuthorizationProvider authorization={{ user: { id: user, displayName: "Test cashier" }, selectedCompany: { id: company, name: "Test company", timezone: "Asia/Riyadh" },
      modules: role === "no-sales-module" ? modules.filter((module) => module !== "SALES") : modules,
      permissions: role === "viewer" ? ["pos.view"] : role === "no-catalog" ? permissions.filter((permission) => permission !== "sales_catalog.view") : permissions }}>
      <div role="status">{notice}</div>{show && <PosPage notify={setNotice} />}
    </AuthorizationProvider>
  </div></I18nProvider>;
}
void loadLocale(resolveLocale(localStorage.getItem("mcap.locale"))).then(() => createRoot(document.getElementById("root")!).render(<Harness />));
