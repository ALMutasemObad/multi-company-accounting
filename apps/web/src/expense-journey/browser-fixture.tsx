import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { EmployeeExpensesPage } from "../EmployeeExpensesPage";
import { AuthorizationProvider } from "../authorization-context";
import { I18nProvider, loadLocale } from "../i18n";
import "../styles.css";
function Fixture() {
  const [company, setCompany] = useState("company-a");
  const [visible, setVisible] = useState(true);
  const [permissions, setPermissions] = useState(["employee_expenses.view", "employee_expenses.submit", "employee_expenses.review"]);
  const [notice, setNotice] = useState("");
  return <I18nProvider initialLocale="ar"><AuthorizationProvider authorization={{ user: { id: "user-a", displayName: "Tester" }, selectedCompany: { id: company, name: company, timezone: "Asia/Riyadh" }, modules: ["HUMAN_RESOURCES"], permissions }}>
    <button data-testid="switch" onClick={() => setCompany("company-b")}>{company}</button>
    <button data-testid="unmount" onClick={() => setVisible(false)}>{"×"}</button>
    <button data-testid="readonly" onClick={() => setPermissions(["employee_expenses.view"])}>{"−"}</button>
    <output data-testid="notice">{notice}</output>
    {visible && <EmployeeExpensesPage notify={setNotice} />}
  </AuthorizationProvider></I18nProvider>;
}
await loadLocale("ar");
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
