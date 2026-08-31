import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/600.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import { SubscriptionBillingCenter } from "../../apps/web/src/SubscriptionBillingCenter";
import { AuthorizationProvider } from "../../apps/web/src/authorization-context";
import { I18nProvider, loadLocale, resolveLocale } from "../../apps/web/src/i18n";
import { setCsrfToken } from "../../apps/web/src/api";
import "../../apps/web/src/styles.css";

function Harness() {
  const [company, setCompany] = useState("1");
  const [visible, setVisible] = useState(true);
  const [manage, setManage] = useState(true);
  const [notice, setNotice] = useState("");
  return <I18nProvider><AuthorizationProvider authorization={{ user: { id: "7", displayName: "Test owner" }, selectedCompany: { id: company, name: "Test activity", timezone: "Asia/Riyadh" }, permissions: manage ? ["subscriptions.view", "subscriptions.manage"] : ["subscriptions.view"], modules: ["CORE_ACCOUNTING"] }}>
    <main style={{ padding: 16 }}>
      <nav><button onClick={() => setCompany(company === "1" ? "2" : "1")}>Switch activity</button><button onClick={() => setVisible(!visible)}>Toggle billing</button><button onClick={() => setManage(!manage)}>Toggle manage permission</button></nav>
      <output>{notice}</output>
      {visible && <SubscriptionBillingCenter notify={setNotice} />}
    </main>
  </AuthorizationProvider></I18nProvider>;
}
await loadLocale("ar");
await loadLocale(resolveLocale(localStorage.getItem("mcap.locale")));
setCsrfToken("test-csrf-only");
createRoot(document.getElementById("root")!).render(<React.StrictMode><Harness /></React.StrictMode>);
