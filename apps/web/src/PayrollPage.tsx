import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, idempotencyKey } from "./api";
import { formatCurrencyDecimal } from "./decimal-format";
import { useI18n, type TranslationKey } from "./i18n";
import { Button, PageHeader, Pagination, Spinner, TableRegion } from "./ui";

type Props = { companyId: string; userId: string; permissions: string[]; notify: (message: string, tone?: "success" | "error") => void };
type Capabilities = { canReadPrivate: boolean; currencyCode: string; currencyDecimals: number };
type Employee = { id: string; employeeNumber: string; nameAr: string };
type Agreement = Employee & { employeeId: string; startsOn: string; endsBefore: string | null; version: number; basicSalary: string; fixedAllowance: string | null };
type Run = { id: string; periodStart: string; periodEndExclusive: string; status: "DRAFT" | "CALCULATED" | "AWAITING_APPROVAL" | "APPROVED"; version: number; employeeCount: number; makerUserId: string; approvedByUserId: string | null };
type Detail = { run: Run; details: null | { schemaVersion: 1; currencyCode: string; grossEarnings: string; netPayable: string; employees: (Employee & { employeeId: string; agreementId: string; agreementVersion: number; basicSalary: string; fixedAllowance: string | null; netPayable: string })[] } };
type Approval = { id: string; subjectId: string; subjectVersion: number; status: string; version: number; requestedBy: { id: string } };
type List<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };
type Command = { path: string; body: string; key: string; kind: "agreement" | "run" | "action" };
type PayrollKey = Extract<TranslationKey, `payroll.${string}`>;

// Reads are bounded, cancellable, and tagged: obsolete results never render under a new selection.
function usePayrollRead<T>(path: string | null, refresh: number) {
  const identity = JSON.stringify([path, refresh]);
  const [state, setState] = useState<{ identity: string; data?: T; error?: boolean }>({ identity: "" });
  useLayoutEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ identity });
    void api<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ identity, data });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ identity, error: true });
    });
    return () => controller.abort();
  }, [identity, path]);
  const current = state.identity === identity ? state : undefined;
  return { data: path ? current?.data : undefined, error: Boolean(path && current?.error), loading: Boolean(path && !current?.data && !current?.error) };
}

export function PayrollPage(props: Props) {
  // Remount synchronously on company, identity or authority change; no salary storage survives.
  return props.companyId ? <PayrollWorkspace key={JSON.stringify([props.companyId, props.userId, [...props.permissions].sort()])} {...props} /> : null;
}

function PayrollWorkspace({ userId, permissions, notify }: Props) {
  const { t, intlLocale } = useI18n();
  const canView = permissions.includes("payroll.view");
  const canManage = permissions.includes("payroll.runs.manage");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [agreementPage, setAgreementPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [startsOn, setStartsOn] = useState("");
  const [endsBefore, setEndsBefore] = useState("");
  const [basicSalary, setBasicSalary] = useState("");
  const [fixedAllowance, setFixedAllowance] = useState("");
  const [pending, setPending] = useState<Command | null>(null);
  const pendingRef = useRef<Command | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); pendingRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const capability = usePayrollRead<Capabilities>(canView ? "/payroll/capabilities" : null, refresh);
  const owner = capability.data?.canReadPrivate === true;
  const canSaveAgreement = owner && permissions.includes("payroll.agreements.manage");
  const runs = usePayrollRead<List<Run>>(capability.data ? `/payroll/runs?page=${page}&pageSize=10` : null, refresh);
  const agreements = usePayrollRead<List<Agreement>>(owner ? `/payroll/agreements?page=${agreementPage}&pageSize=10` : null, refresh);
  const employees = usePayrollRead<{ data: Employee[] }>(canSaveAgreement ? `/payroll/employees?${new URLSearchParams({ search: searchQuery })}` : null, refresh);
  const detail = usePayrollRead<Detail>(capability.data && selectedId ? `/payroll/runs/${encodeURIComponent(selectedId)}` : null, refresh);
  const run = detail.data?.run;
  const approvals = usePayrollRead<List<Approval>>(owner && permissions.includes("approvals.view") && run?.status === "AWAITING_APPROVAL"
    ? `/approval-requests?${new URLSearchParams({ subjectType: "PAYROLL_RUN", subjectId: run.id, status: "PENDING", page: "1", pageSize: "10" })}` : null, refresh);
  const approval = approvals.data?.data.find(row => row.subjectId === run?.id && row.subjectVersion === run.version && row.status === "PENDING");
  const maker = run?.makerUserId === userId;
  const canDecide = owner && permissions.includes("approvals.decide") && approval && !maker && approval.requestedBy.id !== userId;
  const locked = busy || pending !== null;
  const money = (value: string, currency = capability.data?.currencyCode ?? "SAR") => formatCurrencyDecimal(value, currency, intlLocale, {
    minimumFractionDigits: capability.data?.currencyDecimals ?? 2, maximumFractionDigits: capability.data?.currencyDecimals ?? 2,
  });
  const reload = () => setRefresh(value => value + 1);

  async function execute(command: Command) {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || busyRef.current) return;
    busyRef.current = true; setBusy(true); setWriteError("");
    pendingRef.current = command; setPending(command);
    try {
      const result = await api<{ id?: string }>(command.path, { method: "POST", body: command.body, idempotencyKey: command.key, signal: controller.signal });
      if (controller.signal.aborted) return;
      pendingRef.current = null; setPending(null);
      if (command.kind === "agreement") { setBasicSalary(""); setFixedAllowance(""); setEmployee(null); setStartsOn(""); setEndsBefore(""); }
      if (command.kind === "run" && result.id) { setSelectedId(result.id); setMonth(""); setPage(1); }
      reload(); notify(t("payroll.saved"), "success");
    } catch (cause) {
      if (controller.signal.aborted) return;
      // Network/timeout/invalid-response/5xx and in-progress responses retain the exact command.
      const definite = cause instanceof ApiError && cause.status >= 400 && cause.status < 500
        && ![408, 425, 429].includes(cause.status) && !`${cause.code ?? ""} ${cause.reason ?? ""}`.includes("IN_PROGRESS");
      if (definite) { pendingRef.current = null; setPending(null); reload(); }
      setWriteError(t(definite ? "payroll.error" : "payroll.uncertain"));
    } finally {
      if (!controller.signal.aborted) { busyRef.current = false; setBusy(false); }
    }
  }
  function send(path: string, body: unknown, kind: Command["kind"] = "action") {
    if (pendingRef.current || busyRef.current) return;
    void execute({ path, body: JSON.stringify(body), key: idempotencyKey("payroll", crypto.randomUUID()), kind });
  }
  function createAgreement(event: FormEvent) {
    event.preventDefault();
    if (!canSaveAgreement || !employee) return;
    const decimals = capability.data!.currencyDecimals;
    const validMoney = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && (value.split(".")[1]?.length ?? 0) <= decimals;
    if (!startsOn || (endsBefore && endsBefore <= startsOn) || !validMoney(basicSalary) || !/[1-9]/.test(basicSalary)
      || (fixedAllowance && !validMoney(fixedAllowance))) { setWriteError(t("payroll.invalid")); return; }
    send("/payroll/agreements", { employeeId: employee.id, startsOn, ...(endsBefore ? { endsBefore } : {}), basicSalary,
      ...(fixedAllowance ? { fixedAllowance } : {}) }, "agreement");
  }
  function createRun(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    const [year, monthNumber] = month.split("-").map(Number);
    if (year < 1 || year > 9998) { setWriteError(t("payroll.invalid")); return; }
    const next = monthNumber === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${String(year).padStart(4, "0")}-${String(monthNumber + 1).padStart(2, "0")}`;
    send("/payroll/runs", { periodStart: `${month}-01`, periodEndExclusive: `${next}-01` }, "run");
  }
  function endAgreement(agreement: Agreement, endDate: string) {
    if (!canSaveAgreement || locked) return;
    const parsed = new Date(`${endDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== endDate || endDate <= agreement.startsOn.slice(0, 10)
      || (agreement.endsBefore && endDate >= agreement.endsBefore.slice(0, 10))) {
      setWriteError(t("payroll.invalid")); return;
    }
    send(`/payroll/agreements/${encodeURIComponent(agreement.id)}/end`, { expectedVersion: agreement.version, endsBefore: endDate });
  }
  const readError = [capability, runs, agreements, employees, detail, approvals].some(read => read.error);
  const paging = <T,>(list: List<T> | undefined, change: (value: number) => void) => list && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onChange={value => { if (!locked) change(value); }} />;
  if (!canView) return <p role="status">{t("payroll.noAccess")}</p>;
  return <div className="page-content">
    <PageHeader kicker={t("payroll.title")} title={t("payroll.title")} description={t("payroll.description")}
      actions={<Button variant="secondary" disabled={locked} onClick={reload}>{t("payroll.refresh")}</Button>} />
    {capability.loading && <Spinner />}
    {readError && <div className="error-panel" role="alert"><p>{t("payroll.error")}</p><Button disabled={locked} onClick={reload}>{t("payroll.retry")}</Button></div>}
    {writeError && <p role="alert">{writeError}</p>}
    {pending && !busy && <div role="status"><p>{t("payroll.uncertain")}</p><Button onClick={() => void execute(pending)}>{t("payroll.retry")}</Button></div>}
    {busy && <Spinner />}
    {capability.data && <>
      <p>{t("payroll.privateNotice")}</p>
      {canSaveAgreement && <section className="card" aria-labelledby="payroll-agreement-title">
        <h2 id="payroll-agreement-title">{t("payroll.newAgreement")}</h2>
        <form onSubmit={createAgreement}><fieldset disabled={locked} className="form-grid">
          <legend>{t("payroll.agreements")}</legend>
          <label>{t("payroll.search")}<input value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /></label>
          <p>{t("payroll.searchHint")}</p>
          <label>{t("payroll.employee")}<select required value={employee?.id ?? ""} onChange={event => setEmployee(employees.data?.data.find(row => row.id === event.target.value) ?? null)}>
            <option value="">{t("payroll.choose")}</option>
            {employee && !employees.data?.data.some(row => row.id === employee.id) && <option value={employee.id}>{employee.employeeNumber} — {employee.nameAr}</option>}
            {employees.data?.data.map(row => <option key={row.id} value={row.id}>{row.employeeNumber} — {row.nameAr}</option>)}
          </select></label>
          <label>{t("payroll.startsOn")}<input type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label>
          <label>{t("payroll.endsBefore")}<input type="date" min={startsOn} value={endsBefore} onChange={event => setEndsBefore(event.target.value)} /></label>
          <label>{t("payroll.basicSalary")} ({capability.data.currencyCode})<input required inputMode="decimal" autoComplete="off" maxLength={24} value={basicSalary} onChange={event => setBasicSalary(event.target.value)} /></label>
          <label>{t("payroll.fixedAllowance")}<input inputMode="decimal" autoComplete="off" maxLength={24} value={fixedAllowance} onChange={event => setFixedAllowance(event.target.value)} /></label>
          <Button type="submit">{t("payroll.save")}</Button>
        </fieldset></form>
      </section>}
      {owner && <section className="card" aria-labelledby="payroll-agreements-title">
        <h2 id="payroll-agreements-title">{t("payroll.agreements")}</h2>
        {canSaveAgreement && <p>{t("payroll.agreementChangeHint" as TranslationKey)}</p>}
        {agreements.loading ? <Spinner /> : agreements.data && <TableRegion label={t("payroll.agreements")}><table className="data-table">
          <thead><tr>{["employee", "startsOn", "endsBefore", "basicSalary", "fixedAllowance"].map(key => <th scope="col" key={key}>{t(`payroll.${key}` as PayrollKey)}</th>)}{canSaveAgreement && <th scope="col">{t("payroll.endAgreement" as TranslationKey)}</th>}</tr></thead>
          <tbody>{agreements.data.data.map(row => <tr key={row.id}><th scope="row">{row.employeeNumber} — {row.nameAr}</th><td>{row.startsOn.slice(0, 10)}</td><td>{row.endsBefore?.slice(0, 10) ?? "—"}</td><td>{money(row.basicSalary)}</td><td>{money(row.fixedAllowance ?? "0")}</td>
            {canSaveAgreement && <td><EndAgreementForm key={`${row.id}:${row.version}`} agreement={row} locked={locked} onSave={date => endAgreement(row, date)} /></td>}
          </tr>)}</tbody>
        </table></TableRegion>}
        {agreements.data?.data.length === 0 && <p>{t("payroll.empty")}</p>}
        {paging(agreements.data, setAgreementPage)}
      </section>}
      <section className="card" aria-labelledby="payroll-runs-title">
        <h2 id="payroll-runs-title">{t("payroll.runs")}</h2>
        {canManage && <form onSubmit={createRun}><fieldset disabled={locked} className="form-grid"><legend>{t("payroll.create")}</legend>
          <label>{t("payroll.month")}<input type="month" required min="0001-01" max="9998-12" value={month} onChange={event => setMonth(event.target.value)} /></label><Button type="submit">{t("payroll.create")}</Button>
        </fieldset></form>}
        {runs.loading ? <Spinner /> : runs.data && <TableRegion label={t("payroll.runs")}><table className="data-table">
          <thead><tr><th scope="col">{t("payroll.period")}</th><th scope="col">{t("payroll.status")}</th><th scope="col">{t("payroll.count")}</th><th scope="col">{t("payroll.open")}</th></tr></thead>
          <tbody>{runs.data.data.map(row => <tr key={row.id}><th scope="row">{row.periodStart.slice(0, 7)}</th><td>{t(`payroll.status.${row.status}`)}</td><td>{row.employeeCount}</td><td><Button disabled={locked} variant="secondary" aria-pressed={selectedId === row.id} onClick={() => setSelectedId(row.id)}>{t("payroll.open")}</Button></td></tr>)}</tbody>
        </table></TableRegion>}
        {runs.data?.data.length === 0 && <p>{t("payroll.empty")}</p>}
        {paging(runs.data, value => { setPage(value); setSelectedId(""); })}
      </section>
      {detail.loading && <Spinner />}
      {run && <section className="card" aria-labelledby="payroll-detail-title">
        <h2 id="payroll-detail-title">{t("payroll.period")}: {run.periodStart.slice(0, 10)} — {run.periodEndExclusive.slice(0, 10)}</h2>
        <p>{t("payroll.endExclusive")}</p><p>{t("payroll.status")}: {t(`payroll.status.${run.status}`)} · {t("payroll.count")}: {run.employeeCount}</p>
        <div className="toolbar">
          {canManage && maker && (run.status === "DRAFT" || run.status === "CALCULATED") && <Button disabled={locked} onClick={() => send(`/payroll/runs/${run.id}/calculate`, { expectedVersion: run.version })}>{t("payroll.calculate")}</Button>}
          {canManage && maker && run.status === "CALCULATED" && <Button disabled={locked} onClick={() => send("/approval-requests", { subjectType: "PAYROLL_RUN", subjectId: run.id, subjectVersion: run.version })}>{t("payroll.submit")}</Button>}
        </div>
        {owner && detail.data?.details && <>
          <p>{t("payroll.gross")}: {money(detail.data.details.grossEarnings, detail.data.details.currencyCode)}</p><p>{t("payroll.net")}: {money(detail.data.details.netPayable, detail.data.details.currencyCode)}</p>
          <TableRegion label={t("payroll.runs")}><table className="data-table"><thead><tr><th scope="col">{t("payroll.employee")}</th><th scope="col">{t("payroll.basicSalary")}</th><th scope="col">{t("payroll.fixedAllowance")}</th><th scope="col">{t("payroll.net")}</th></tr></thead>
            <tbody>{detail.data.details.employees.map(row => <tr key={row.employeeId}><th scope="row">{row.employeeNumber} — {row.nameAr}</th><td>{money(row.basicSalary, detail.data!.details!.currencyCode)}</td><td>{money(row.fixedAllowance ?? "0", detail.data!.details!.currencyCode)}</td><td>{money(row.netPayable, detail.data!.details!.currencyCode)}</td></tr>)}</tbody>
          </table></TableRegion>
        </>}
        {approvals.loading && <Spinner />}
        {owner && run.status === "AWAITING_APPROVAL" && (maker || approval?.requestedBy.id === userId) && <p>{t("payroll.makerChecker")}</p>}
        {canDecide && approval && <fieldset disabled={locked} className="form-grid"><legend>{t("payroll.approve")}</legend>
          <Button onClick={() => send(`/approval-requests/${approval.id}/approve`, { version: approval.version })}>{t("payroll.approve")}</Button>
          <p>{t("payroll.privateNotice")}</p>
          <Button variant="secondary" onClick={() => send(`/approval-requests/${approval.id}/reject`, { version: approval.version, reason: "Payroll returned for correction." })}>{t("payroll.reject")}</Button>
        </fieldset>}
      </section>}
    </>}
  </div>;
}

function EndAgreementForm({ agreement, locked, onSave }: { agreement: Agreement; locked: boolean; onSave: (date: string) => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState(agreement.endsBefore?.slice(0, 10) ?? "");
  const firstEnd = new Date(`${agreement.startsOn.slice(0, 10)}T00:00:00.000Z`);
  firstEnd.setUTCDate(firstEnd.getUTCDate() + 1);
  const lastEnd = agreement.endsBefore ? new Date(`${agreement.endsBefore.slice(0, 10)}T00:00:00.000Z`) : null;
  lastEnd?.setUTCDate(lastEnd.getUTCDate() - 1);
  return <form onSubmit={event => { event.preventDefault(); if (!locked) onSave(date); }}>
    <fieldset disabled={locked}>
      <legend>{t("payroll.endAgreement" as TranslationKey)} — {agreement.employeeNumber} — {agreement.nameAr}</legend>
      <label>{t("payroll.endDate" as TranslationKey)}<input type="date" required min={firstEnd.toISOString().slice(0, 10)}
        max={lastEnd?.toISOString().slice(0, 10)} value={date} onChange={event => setDate(event.target.value)} /></label>
      <Button type="submit" disabled={!date || date <= agreement.startsOn.slice(0, 10) || Boolean(agreement.endsBefore && date >= agreement.endsBefore.slice(0, 10))}>{t("payroll.saveEnd" as TranslationKey)}</Button>
    </fieldset>
  </form>;
}
