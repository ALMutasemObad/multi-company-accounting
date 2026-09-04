import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { allows } from "./authorization";
import { useAuthorization } from "./authorization-context";
import { formatCurrencyDecimal } from "./decimal-format";
import { localizedReferenceName, useI18n } from "./i18n";
import type {
  EmployeeExpenseClaim,
  EmployeeExpenseClaimStatus,
  EmployeeExpenseCostCenter,
  ListResponse,
} from "./types";
import { Button, EmptyState, PageHeader, Pagination, Spinner } from "./ui";
import "./employee-expenses.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type DraftLine = {
  key: string;
  incurredOn: string;
  merchant: string;
  description: string;
  receiptReference: string;
  costCenterId: string;
  amount: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  incurredOn: today(),
  merchant: "",
  description: "",
  receiptReference: "",
  costCenterId: "",
  amount: "",
});

export function EmployeeExpensesPage({ notify }: { notify: Notice }) {
  const { t, intlLocale } = useI18n();
  const { permissionSet } = useAuthorization();
  const canSubmit = allows(permissionSet, { permission: "employee_expenses.submit" });
  const canReview = allows(permissionSet, { permission: "employee_expenses.review" });
  const [claims, setClaims] = useState<EmployeeExpenseClaim[]>([]);
  const [costCenters, setCostCenters] = useState<EmployeeExpenseCostCenter[]>([]);
  const [scope, setScope] = useState<"mine" | "company">(canReview ? "company" : "mine");
  const [status, setStatus] = useState<EmployeeExpenseClaimStatus | "">("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10", scope });
      if (status) query.set("status", status);
      const result = await api<ListResponse<EmployeeExpenseClaim>>(`/employee-expense-claims?${query}`);
      setClaims(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("employeeExpenses.error"));
    } finally {
      setLoading(false);
    }
  }, [page, scope, status, t]);

  const loadCostCenters = useCallback(async () => {
    if (!canSubmit) return;
    try {
      const result = await api<{ data: EmployeeExpenseCostCenter[] }>("/employee-expense-cost-centers");
      setCostCenters(result.data);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("employeeExpenses.error"), "error");
    }
  }, [canSubmit, notify, t]);

  useEffect(() => { void loadClaims(); }, [loadClaims]);
  useEffect(() => { void loadCostCenters(); }, [loadCostCenters]);

  const summary = useMemo(() => ({
    draft: claims.filter((claim) => claim.status === "DRAFT").length,
    pending: claims.filter((claim) => claim.status === "AWAITING_APPROVAL").length,
    ready: claims.filter((claim) => claim.status === "READY_FOR_PAYMENT").length,
  }), [claims]);

  function updateLine(key: string, change: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } : line));
  }

  async function createClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    try {
      await api("/employee-expense-claims", {
        method: "POST",
        idempotencyKey: idempotencyKey("employee-expense-create", crypto.randomUUID()),
        body: JSON.stringify({
          purpose: purpose.trim(),
          lines: lines.map(({ key: _key, ...line }) => ({
            ...line,
            merchant: line.merchant.trim(),
            description: line.description.trim(),
            receiptReference: line.receiptReference.trim() || null,
          })),
        }),
      });
      setPurpose("");
      setLines([emptyLine()]);
      setScope("mine");
      setStatus("");
      setPage(1);
      notify(t("employeeExpenses.created"));
      await loadClaims();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("employeeExpenses.error"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function submitClaim(claim: EmployeeExpenseClaim) {
    if (!window.confirm(t("employeeExpenses.submitConfirm"))) return;
    setWorking(true);
    try {
      await api("/approval-requests", {
        method: "POST",
        idempotencyKey: idempotencyKey("employee-expense-submit", crypto.randomUUID()),
        body: JSON.stringify({
          subjectType: "EMPLOYEE_EXPENSE_CLAIM",
          subjectId: claim.id,
          subjectVersion: claim.version,
        }),
      });
      notify(t("employeeExpenses.submitted"));
      await loadClaims();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("employeeExpenses.error"), "error");
    } finally {
      setWorking(false);
    }
  }

  const money = (claim: EmployeeExpenseClaim, amount: string) => formatCurrencyDecimal(
    amount,
    claim.currency.code,
    intlLocale,
    { minimumFractionDigits: claim.currency.decimals, maximumFractionDigits: claim.currency.decimals, currencyDisplay: "code" },
  );

  return <section className="workspace-page employee-expenses-workspace">
    <PageHeader
      kicker={t("employeeExpenses.kicker")}
      title={t("employeeExpenses.title")}
      description={t("employeeExpenses.description")}
    />

    <div className="employee-expense-summary" aria-label={t("employeeExpenses.statusFilter")}>
      <article><strong>{summary.draft}</strong><span>{t("employeeExpenses.summary.draft")}</span></article>
      <article><strong>{summary.pending}</strong><span>{t("employeeExpenses.summary.pending")}</span></article>
      <article><strong>{summary.ready}</strong><span>{t("employeeExpenses.summary.ready")}</span></article>
    </div>

    {canSubmit && <form className="panel employee-expense-form" onSubmit={(event) => void createClaim(event)}>
      <header><div><h2>{t("employeeExpenses.formTitle")}</h2><p>{t("employeeExpenses.formDescription")}</p></div></header>
      <label className="employee-expense-purpose"><span>{t("employeeExpenses.purpose")}</span><textarea required minLength={5} maxLength={500} value={purpose} placeholder={t("employeeExpenses.purposePlaceholder")} onChange={(event) => setPurpose(event.target.value)} /></label>
      <div className="employee-expense-lines-heading"><div><h2>{t("employeeExpenses.lines")}</h2><p>{t("employeeExpenses.receiptHint")}</p></div><Button type="button" variant="secondary" icon="plus" disabled={lines.length >= 20 || working} onClick={() => setLines((current) => [...current, emptyLine()])}>{t("employeeExpenses.addLine")}</Button></div>
      <div className="employee-expense-line-list">
        {lines.map((line, index) => <fieldset className="employee-expense-line-editor" key={line.key}>
          <legend>{t("employeeExpenses.line", { number: index + 1 })}</legend>
          <label><span>{t("employeeExpenses.incurredOn")}</span><input required type="date" value={line.incurredOn} onChange={(event) => updateLine(line.key, { incurredOn: event.target.value })} /></label>
          <label><span>{t("employeeExpenses.merchant")}</span><input required maxLength={160} value={line.merchant} onChange={(event) => updateLine(line.key, { merchant: event.target.value })} /></label>
          <label className="wide"><span>{t("employeeExpenses.lineDescription")}</span><input required minLength={3} maxLength={500} value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} /></label>
          <label><span>{t("employeeExpenses.costCenter")}</span><select required value={line.costCenterId} onChange={(event) => updateLine(line.key, { costCenterId: event.target.value })}>
            <option value="">{costCenters.length ? t("referencePicker.required") : t("employeeExpenses.noCostCenters")}</option>
            {costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} · {localizedReferenceName(center)}</option>)}
          </select></label>
          <label><span>{t("employeeExpenses.amount")}</span><input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" value={line.amount} onChange={(event) => updateLine(line.key, { amount: event.target.value })} /></label>
          <label className="wide"><span>{t("employeeExpenses.receiptReference")}</span><input maxLength={200} value={line.receiptReference} onChange={(event) => updateLine(line.key, { receiptReference: event.target.value })} /><small>{t("employeeExpenses.receiptHint")}</small></label>
          {lines.length > 1 && <Button type="button" variant="ghost" icon="trash" disabled={working} aria-label={`${t("employeeExpenses.removeLine")} ${index + 1}`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>{t("employeeExpenses.removeLine")}</Button>}
        </fieldset>)}
      </div>
      <div className="form-actions"><Button type="submit" icon="check" disabled={working || costCenters.length === 0}>{working ? t("common.saving") : t("employeeExpenses.saveDraft")}</Button></div>
    </form>}

    <div className="toolbar employee-expense-toolbar">
      {canReview && <label><span>{t("employeeExpenses.scope")}</span><select value={scope} onChange={(event) => { setScope(event.target.value as "mine" | "company"); setPage(1); }}>
        <option value="mine">{t("employeeExpenses.scope.mine")}</option>
        <option value="company">{t("employeeExpenses.scope.company")}</option>
      </select></label>}
      <label><span>{t("employeeExpenses.statusFilter")}</span><select value={status} onChange={(event) => { setStatus(event.target.value as EmployeeExpenseClaimStatus | ""); setPage(1); }}>
        <option value="">{t("employeeExpenses.status.ALL")}</option>
        {(["DRAFT", "AWAITING_APPROVAL", "READY_FOR_PAYMENT"] as const).map((value) => <option key={value} value={value}>{t(`employeeExpenses.status.${value}`)}</option>)}
      </select></label>
    </div>

    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadClaims()}>{t("common.retry")}</Button></div>
      : loading ? <Spinner label={t("employeeExpenses.loading")} />
      : claims.length === 0 ? <EmptyState title={t("employeeExpenses.emptyTitle")} description={t("employeeExpenses.emptyDescription")} />
      : <div className="employee-expense-claims">
        {claims.map((claim) => <article className="panel employee-expense-claim" key={claim.id}>
          <header>
            <div><span className={`status-chip ${claim.status.toLowerCase()}`}>{t(`employeeExpenses.status.${claim.status}`)}</span><h2>{claim.purpose}</h2><p>{t("employeeExpenses.employee")}: {localizedReferenceName(claim.employee)} · {claim.employee.employeeNumber}</p></div>
            <div className="employee-expense-total"><span>{t("employeeExpenses.total")}</span><strong>{money(claim, claim.totalAmount)}</strong><small>{t("employeeExpenses.lineCount", { count: claim.lines.length })}</small></div>
          </header>
          <ul className="employee-expense-line-summary">
            {claim.lines.map((line) => <li key={line.id}>
              <div><strong>{line.merchant}</strong><span>{line.description}</span></div>
              <div><strong>{money(claim, line.amount)}</strong><span>{line.costCenter.code} · {localizedReferenceName(line.costCenter)}</span></div>
              <div><span>{new Date(`${line.incurredOn}T00:00:00.000Z`).toLocaleDateString(intlLocale)}</span><span>{line.receiptReference ?? t("employeeExpenses.noReceipt")}</span></div>
            </li>)}
          </ul>
          {claim.status === "READY_FOR_PAYMENT" && <div className="employee-expense-ready"><strong>{t("employeeExpenses.readyTitle")}</strong><span>{t("employeeExpenses.readyDescription")}</span></div>}
          {claim.status === "DRAFT" && claim.ownedByCurrentUser && canSubmit && <div className="row-actions"><Button icon="arrowUp" disabled={working} onClick={() => void submitClaim(claim)}>{t("employeeExpenses.submit")}</Button></div>}
        </article>)}
      </div>}
    <Pagination {...meta} page={page} onChange={setPage} />
  </section>;
}
