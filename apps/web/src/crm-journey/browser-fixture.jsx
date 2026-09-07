// Local browser acceptance harness; never imported by the application entry point.
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { CrmPage } from "../CrmPage";
import { AuthorizationProvider } from "../authorization-context";
import { I18nProvider, loadLocale } from "../i18n";
import "../styles.css";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
await Promise.all([loadLocale("ar"), loadLocale("en")]);
function Harness() {
  const [company, setCompany] = useState("1");
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  const params = new URLSearchParams(location.search);
  const permissions = (params.get("permissions") ?? "crm.view,crm.manage,crm.convert,crm.activities.manage").split(",");
  return <I18nProvider initialLocale={params.get("locale") === "en" ? "en" : "ar"}>
    <button data-testid="switch" onClick={() => setCompany("2")}>Switch company</button>
    <button data-testid="unmount" onClick={() => setVisible(false)}>Unmount</button>
    <output data-testid="notice">{notice}</output>
    <AuthorizationProvider authorization={{ user: { id: "1", displayName: "Tester" }, selectedCompany: { id: company, name: company, timezone: "Asia/Riyadh" }, modules: ["CRM", "SALES"], permissions }}>
      {visible && <CrmPage notify={(message) => setNotice(message)} />}
    </AuthorizationProvider>
  </I18nProvider>;
}
createRoot(document.getElementById("root")).render(<StrictMode><Harness /></StrictMode>);
