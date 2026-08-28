import { useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import {
  activeMatchForLine,
  isZeroDecimal,
  reconciliationCsv,
  reconciliationLineState,
  unresolvedLineCount,
} from "./bank-reconciliation";
import { localizedReferenceName, type TranslationKey, useI18n } from "./i18n";
import type {
  BankReconciliationBookMovement,
  BankReconciliationCapabilities,
  BankReconciliationMatch,
  BankReconciliationSession,
  BankReconciliationSessionDetail,
  BankStatementCsvProfile,
  BankStatementFileRequest,
  BankStatementFormat,
  BankStatementImport,
  BankStatementLine,
  BankStatementLineClassification,
  CashBankAccount,
  ListResponse,
  NormalizedBankStatementPreview,
} from "./types";
import { Button, EmptyState, Icon, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type WorkspaceTab = "new" | "history";
type LineFilter = "ALL" | "UNMATCHED" | "PROPOSED" | "APPROVED" | "CLASSIFIED";

const classifications: BankStatementLineClassification[] = [
  "PENDING_TRANSACTION",
  "BANK_FEE",
  "BANK_INTEREST",
  "BANK_ERROR",
  "NEEDS_ACCOUNTING_DOCUMENT",
];

const defaultCsvProfile: BankStatementCsvProfile = {
  delimiter: ",",
  dateFormat: "YYYY-MM-DD",
  decimalSeparator: ".",
  thousandsSeparator: ",",
  defaultCurrency: "SAR",
  positiveAmountDirection: "CREDIT",
  columns: {
    bookingDate: "booking_date",
    amount: "amount",
    currency: "currency",
    reference: "reference",
    description: "description",
  },
};

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function compactColumns(profile: BankStatementCsvProfile): BankStatementCsvProfile["columns"] {
  return Object.fromEntries(Object.entries(profile.columns).filter(([, value]) => value?.trim())) as BankStatementCsvProfile["columns"];
}

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BankReconciliationPage({ capabilities, notify }: { capabilities: BankReconciliationCapabilities; notify: Notice }) {
  const { formatDateTime, formatNumber, t } = useI18n();
  const [tab, setTab] = useState<WorkspaceTab>(capabilities.canImport ? "new" : "history");
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [imports, setImports] = useState<BankStatementImport[]>([]);
  const [sessions, setSessions] = useState<BankReconciliationSession[]>([]);
  const [knownSessionImportIds, setKnownSessionImportIds] = useState<Set<string>>(new Set());
  const [sessionMeta, setSessionMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionStatus, setSessionStatus] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sessionQuery = new URLSearchParams({
        page: String(sessionPage),
        pageSize: "10",
        ...(sessionStatus ? { status: sessionStatus } : {}),
      });
      const [cashResponse, importResponse, sessionResponse, allSessionResponse] = await Promise.all([
        capabilities.canImport
          ? api<ListResponse<CashBankAccount>>("/cash-bank-accounts?page=1&pageSize=100&type=BANK&active=true").catch(() => ({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }))
          : Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }),
        api<ListResponse<BankStatementImport>>("/bank-statement-imports?page=1&pageSize=100"),
        api<ListResponse<BankReconciliationSession>>(`/bank-reconciliation/sessions?${sessionQuery}`),
        api<ListResponse<BankReconciliationSession>>("/bank-reconciliation/sessions?page=1&pageSize=100"),
      ]);
      setAccounts(cashResponse.data.filter((item) => item.accountType === "BANK" && item.isActive));
      setImports(importResponse.data.filter((item) => item.status === "COMMITTED"));
      setSessions(sessionResponse.data);
      setSessionMeta(sessionResponse.meta);
      setKnownSessionImportIds(new Set(allSessionResponse.data.map((session) => session.statementImportId)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("reconciliation.loadError"));
    } finally {
      setLoading(false);
    }
  }, [capabilities.canImport, sessionPage, sessionStatus, t]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const waitingImports = imports.filter((item) => !knownSessionImportIds.has(item.id));

  async function startSession(statementImport: BankStatementImport) {
    if (!capabilities.canSuggest) {
      notify(t("reconciliation.statementCommitted"));
      setTab("history");
      await loadWorkspace();
      return;
    }
    setError("");
    try {
      const session = await api<BankReconciliationSession>("/bank-reconciliation/sessions", {
        method: "POST",
        idempotencyKey: idempotencyKey("bank-reconciliation-session", statementImport.id),
        body: JSON.stringify({
          statementImportId: statementImport.id,
          dateFrom: statementImport.periodStart,
          dateTo: statementImport.periodEnd,
        }),
      });
      notify(t("reconciliation.sessionCreated"));
      setSelectedSessionId(session.id);
      setTab("history");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("reconciliation.sessionError"));
    }
  }

  if (selectedSessionId) {
    return <ReconciliationSessionView
      sessionId={selectedSessionId}
      capabilities={capabilities}
      notify={notify}
      onBack={() => { setSelectedSessionId(null); void loadWorkspace(); }}
    />;
  }

  return <div className="reconciliation-workspace">
    <div className={`rollout-banner ${capabilities.stage.toLowerCase()}`}>
      <Icon name="treasury" />
      <div><strong>{t(`reconciliation.stage.${capabilities.stage}`)}</strong><span>{t(`reconciliation.stageDescription.${capabilities.stage}`)}</span></div>
    </div>
    <div className="section-tabs reconciliation-tabs" role="tablist" aria-label={t("reconciliation.tabsLabel")}>
      {capabilities.canImport && <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>{t("reconciliation.newTab")}</button>}
      <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>{t("reconciliation.historyTab")}</button>
    </div>
    {error && <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadWorkspace()}>{t("common.retry")}</Button></div>}
    {loading ? <Spinner label={t("reconciliation.loading")} /> : tab === "new" ? <StatementImportBuilder accounts={accounts} onCommitted={async (item) => { await loadWorkspace(); await startSession(item); }} /> : <div className="reconciliation-history">
      {waitingImports.length > 0 && <article className="panel pending-imports">
        <header><div><h2>{t("reconciliation.pendingImports")}</h2><p>{t("reconciliation.pendingImportsDescription")}</p></div></header>
        <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
          <table className="data-table"><thead><tr><th>{t("reconciliation.bankAccount")}</th><th>{t("reconciliation.period")}</th><th>{t("reconciliation.lines")}</th><th></th></tr></thead><tbody>{waitingImports.map((item) => <tr key={item.id}><td><strong>{item.cashBankAccount.nameAr}</strong><small dir="ltr">{item.cashBankAccount.code}</small></td><td dir="ltr">{item.periodStart} — {item.periodEnd}</td><td>{formatNumber(item.lineCount)}</td><td>{capabilities.canSuggest ? <Button variant="secondary" onClick={() => void startSession(item)}>{t("reconciliation.startSession")}</Button> : <span className="muted-value">{t("reconciliation.reviewPermissionRequired")}</span>}</td></tr>)}</tbody></table>
        </div>
      </article>}
      <article className="panel reconciliation-sessions">
        <header><div><h2>{t("reconciliation.sessionsTitle")}</h2><p>{t("reconciliation.sessionsDescription")}</p></div><select aria-label={t("reconciliation.sessionStatus")} value={sessionStatus} onChange={(event) => { setSessionPage(1); setSessionStatus(event.target.value); }}><option value="">{t("reconciliation.allStatuses")}</option><option value="OPEN">{t("reconciliation.status.OPEN")}</option><option value="CLOSED">{t("reconciliation.status.CLOSED")}</option></select></header>
        <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("reconciliation.bankAccount")}</th><th>{t("reconciliation.period")}</th><th>{t("reconciliation.difference")}</th><th>{t("reconciliation.sessionStatus")}</th><th>{t("reconciliation.createdAt")}</th><th></th></tr></thead><tbody>{sessions.length ? sessions.map((session) => <tr key={session.id}><td><strong>{session.cashBankAccount.nameAr}</strong><small dir="ltr">{session.cashBankAccount.code}</small></td><td dir="ltr">{session.dateFrom} — {session.dateTo}</td><td><span className={isZeroDecimal(session.difference) ? "amount-balanced" : "amount-difference"} dir="ltr">{session.difference} {session.currency}</span></td><td><span className={`status-chip ${session.status.toLowerCase()}`}>{t(`reconciliation.status.${session.status}`)}</span></td><td>{formatDateTime(session.createdAt)}</td><td><Button variant="ghost" onClick={() => setSelectedSessionId(session.id)}>{t("reconciliation.openSession")}</Button></td></tr>) : <tr><td colSpan={6}>{t("reconciliation.noSessions")}</td></tr>}</tbody></table></div>
        <Pagination {...sessionMeta} page={sessionPage} onChange={setSessionPage} />
      </article>
    </div>}
  </div>;
}

function StatementImportBuilder({ accounts, onCommitted }: { accounts: CashBankAccount[]; onCommitted: (item: BankStatementImport) => Promise<void> }) {
  const { formatNumber, t } = useI18n();
  const [cashBankAccountId, setCashBankAccountId] = useState(accounts[0]?.id ?? "");
  const [format, setFormat] = useState<BankStatementFormat>("CSV");
  const [file, setFile] = useState<File | null>(null);
  const [contentBase64, setContentBase64] = useState("");
  const [profile, setProfile] = useState<BankStatementCsvProfile>(defaultCsvProfile);
  const [expectedCurrency, setExpectedCurrency] = useState("");
  const [expectedAccountIdentifier, setExpectedAccountIdentifier] = useState("");
  const [preview, setPreview] = useState<NormalizedBankStatementPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!cashBankAccountId && accounts[0]) setCashBankAccountId(accounts[0].id); }, [accounts, cashBankAccountId]);

  function request(): BankStatementFileRequest {
    return {
      cashBankAccountId,
      format,
      contentBase64,
      ...(file ? { fileName: file.name } : {}),
      ...(format === "CSV" ? { csvProfile: { ...profile, columns: compactColumns(profile) } } : {}),
      ...(format === "CAMT053" && expectedCurrency.trim() ? { expectedCurrency: expectedCurrency.trim().toUpperCase() } : {}),
      ...(format === "CAMT053" && expectedAccountIdentifier.trim() ? { expectedAccountIdentifier: expectedAccountIdentifier.trim() } : {}),
    };
  }

  async function selectFile(selected?: File) {
    setFile(null); setContentBase64(""); setPreview(null); setError("");
    if (!selected) return;
    if (selected.size > 512 * 1024) { setError(t("reconciliation.fileTooLarge")); return; }
    const matches = format === "CSV" ? /\.csv$/iu.test(selected.name) : /\.xml$/iu.test(selected.name);
    if (!matches) { setError(t("reconciliation.fileTypeMismatch")); return; }
    try { setContentBase64(await readBase64(selected)); setFile(selected); }
    catch { setError(t("reconciliation.fileReadError")); }
  }

  async function runPreview() {
    if (!file || !contentBase64 || !cashBankAccountId) return;
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await api<NormalizedBankStatementPreview>("/bank-statement-imports/preview", { method: "POST", body: JSON.stringify(request()) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("reconciliation.previewError")); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const imported = await api<BankStatementImport>("/bank-statement-imports", {
        method: "POST",
        idempotencyKey: idempotencyKey("bank-statement-import", preview.sourceHashSha256.slice(0, 24)),
        body: JSON.stringify(request()),
      });
      await onCommitted(imported);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("reconciliation.commitError")); }
    finally { setBusy(false); }
  }

  if (!accounts.length) return <EmptyState title={t("reconciliation.noBankAccounts")} description={t("reconciliation.noBankAccountsDescription")} />;

  return <div className="reconciliation-import-layout">
    <article className="panel statement-builder"><header><div><h2>{t("reconciliation.importTitle")}</h2><p>{t("reconciliation.importDescription")}</p></div></header>
      <div className="reconciliation-form">
        <div className="form-grid">
          <label><span>{t("reconciliation.bankAccount")}</span><select value={cashBankAccountId} onChange={(event) => { setCashBankAccountId(event.target.value); setPreview(null); }} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {localizedReferenceName(account)}</option>)}</select></label>
          <label><span>{t("reconciliation.fileFormat")}</span><select value={format} onChange={(event) => { setFormat(event.target.value as BankStatementFormat); setFile(null); setContentBase64(""); setPreview(null); }}><option value="CSV">{t("reconciliation.format.CSV")}</option><option value="CAMT053">{t("reconciliation.format.CAMT053")}</option></select></label>
        </div>
        {format === "CSV" ? <details className="csv-profile" open><summary>{t("reconciliation.csvSettings")}</summary><div className="form-grid">
          <label><span>{t("reconciliation.defaultCurrency")}</span><input dir="ltr" value={profile.defaultCurrency} minLength={3} maxLength={3} pattern="[A-Z]{3}" onChange={(event) => setProfile({ ...profile, defaultCurrency: event.target.value.toUpperCase().replace(/[^A-Z]/gu, "") })} required /></label>
          <label><span>{t("reconciliation.delimiter")}</span><select value={profile.delimiter} onChange={(event) => setProfile({ ...profile, delimiter: event.target.value as BankStatementCsvProfile["delimiter"] })}><option value=",">{t("reconciliation.comma")}</option><option value=";">{t("reconciliation.semicolon")}</option><option value="\t">{t("reconciliation.tab")}</option></select></label>
          <label><span>{t("reconciliation.dateFormat")}</span><select value={profile.dateFormat} onChange={(event) => setProfile({ ...profile, dateFormat: event.target.value as BankStatementCsvProfile["dateFormat"] })}><option value="YYYY-MM-DD">{t("reconciliation.dateFormat.YYYY_MM_DD")}</option><option value="DD/MM/YYYY">{t("reconciliation.dateFormat.DD_MM_YYYY")}</option><option value="MM/DD/YYYY">{t("reconciliation.dateFormat.MM_DD_YYYY")}</option></select></label>
          <label><span>{t("reconciliation.positiveDirection")}</span><select value={profile.positiveAmountDirection} onChange={(event) => setProfile({ ...profile, positiveAmountDirection: event.target.value as "CREDIT" | "DEBIT" })}><option value="CREDIT">{t("reconciliation.direction.CREDIT")}</option><option value="DEBIT">{t("reconciliation.direction.DEBIT")}</option></select></label>
          <label><span>{t("reconciliation.bookingDateColumn")}</span><input dir="ltr" value={profile.columns.bookingDate} onChange={(event) => setProfile({ ...profile, columns: { ...profile.columns, bookingDate: event.target.value } })} required /></label>
          <label><span>{t("reconciliation.amountColumn")}</span><input dir="ltr" value={profile.columns.amount ?? ""} onChange={(event) => setProfile({ ...profile, columns: { ...profile.columns, amount: event.target.value, debit: undefined, credit: undefined } })} /></label>
          <label><span>{t("reconciliation.currencyColumn")}</span><input dir="ltr" value={profile.columns.currency ?? ""} onChange={(event) => setProfile({ ...profile, columns: { ...profile.columns, currency: event.target.value } })} /></label>
          <label><span>{t("reconciliation.referenceColumn")}</span><input dir="ltr" value={profile.columns.reference ?? ""} onChange={(event) => setProfile({ ...profile, columns: { ...profile.columns, reference: event.target.value } })} /></label>
          <label className="full"><span>{t("reconciliation.descriptionColumn")}</span><input dir="ltr" value={profile.columns.description ?? ""} onChange={(event) => setProfile({ ...profile, columns: { ...profile.columns, description: event.target.value } })} /></label>
        </div></details> : <div className="form-grid camt-expectations"><label><span>{t("reconciliation.expectedCurrency")}</span><input dir="ltr" value={expectedCurrency} maxLength={3} onChange={(event) => setExpectedCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/gu, ""))} /></label><label><span>{t("reconciliation.expectedAccount")}</span><input dir="ltr" value={expectedAccountIdentifier} onChange={(event) => setExpectedAccountIdentifier(event.target.value)} /></label></div>}
        <label className="import-dropzone"><span>{t("reconciliation.chooseFile")}</span><input type="file" accept={format === "CSV" ? ".csv,text/csv" : ".xml,application/xml,text/xml"} onChange={(event) => void selectFile(event.target.files?.[0])} /><small>{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : t("reconciliation.fileHint")}</small></label>
        <div className="import-safety-note"><strong>{t("reconciliation.safetyTitle")}</strong><span>{t("reconciliation.safetyDescription")}</span></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions"><Button variant="secondary" onClick={() => { setFile(null); setContentBase64(""); setPreview(null); setError(""); }} disabled={!file || busy}>{t("common.cancel")}</Button><Button onClick={() => void runPreview()} disabled={!file || busy || !cashBankAccountId}>{busy ? t("reconciliation.working") : t("reconciliation.preview")}</Button></div>
      </div>
    </article>
    <article className="panel statement-preview"><header><div><h2>{t("reconciliation.previewTitle")}</h2><p>{t("reconciliation.previewDescription")}</p></div></header>
      {busy && !preview ? <Spinner label={t("reconciliation.working")} /> : preview ? <div className="preview-body reconciliation-preview-body">
        <div className="import-metrics"><div><span>{t("reconciliation.lines")}</span><strong>{formatNumber(preview.lines.length)}</strong></div><div><span>{t("reconciliation.period")}</span><strong className="date-range">{preview.periodStart ?? "—"}<small>{preview.periodEnd ?? "—"}</small></strong></div><div><span>{t("reconciliation.netMovement")}</span><strong dir="ltr">{preview.netMovement} {preview.currency}</strong></div></div>
        <div className="data-table-wrap flat preview-lines" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("reconciliation.date")}</th><th>{t("reconciliation.reference")}</th><th>{t("reconciliation.description")}</th><th>{t("reconciliation.amount")}</th></tr></thead><tbody>{preview.lines.slice(0, 100).map((line) => <tr key={`${line.sourceRowNumber}-${line.fingerprintSha256}`}><td dir="ltr">{line.bookingDate}</td><td>{line.reference || line.externalId || "—"}</td><td>{line.description || "—"}</td><td dir="ltr">{line.amount} {line.currency}</td></tr>)}</tbody></table></div>
        {preview.lines.length > 100 && <p className="table-note">{t("reconciliation.previewLimit", { value: formatNumber(preview.lines.length) })}</p>}
        <div className="import-ready"><strong>{t("reconciliation.readyTitle")}</strong><span>{t("reconciliation.readyDescription")}</span></div>
        <Button icon="check" onClick={() => void commit()} disabled={busy}>{busy ? t("reconciliation.working") : t("reconciliation.commitAndStart")}</Button>
      </div> : <div className="import-empty"><span aria-hidden="true">⇄</span><h3>{t("reconciliation.emptyPreviewTitle")}</h3><p>{t("reconciliation.emptyPreviewDescription")}</p></div>}
    </article>
  </div>;
}

function ReconciliationSessionView({ sessionId, capabilities, notify, onBack }: { sessionId: string; capabilities: BankReconciliationCapabilities; notify: Notice; onBack: () => void }) {
  const { formatNumber, t } = useI18n();
  const [session, setSession] = useState<BankReconciliationSessionDetail | null>(null);
  const [movements, setMovements] = useState<BankReconciliationBookMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lineFilter, setLineFilter] = useState<LineFilter>("ALL");
  const [amountFilter, setAmountFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateWindowDays, setDateWindowDays] = useState(3);
  const [linePage, setLinePage] = useState(1);
  const [reviewLine, setReviewLine] = useState<BankStatementLine | null>(null);
  const [closingExplanation, setClosingExplanation] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [detail, book] = await Promise.all([
        api<BankReconciliationSessionDetail>(`/bank-reconciliation/sessions/${sessionId}`),
        api<{ data: BankReconciliationBookMovement[] }>(`/bank-reconciliation/sessions/${sessionId}/book-movements`),
      ]);
      setSession(detail); setMovements(book.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("reconciliation.sessionLoadError")); }
    finally { setLoading(false); }
  }, [sessionId, t]);

  useEffect(() => { void load(); }, [load]);

  const filteredLines = useMemo(() => session?.lines.filter((line) => {
    const state = reconciliationLineState(line, activeMatchForLine(session.matches, line.id));
    return (lineFilter === "ALL" || state === lineFilter)
      && (!amountFilter.trim() || line.amount.includes(amountFilter.trim()))
      && (!dateFrom || line.bookingDate >= dateFrom)
      && (!dateTo || line.bookingDate <= dateTo);
  }) ?? [], [amountFilter, dateFrom, dateTo, lineFilter, session]);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const visibleLines = filteredLines.slice((linePage - 1) * pageSize, linePage * pageSize);

  useEffect(() => { setLinePage(1); }, [lineFilter, amountFilter, dateFrom, dateTo]);

  async function write(path: string, operation: string, body: Record<string, unknown>, success: string) {
    setBusy(true); setError("");
    try {
      await api(path, { method: "POST", idempotencyKey: idempotencyKey(operation, sessionId), body: JSON.stringify(body) });
      notify(success); setReviewLine(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("reconciliation.actionError")); }
    finally { setBusy(false); }
  }

  async function generateSuggestions() {
    if (!session) return;
    await write(`/bank-reconciliation/sessions/${session.id}/suggestions`, "bank-reconciliation-suggestions", { sessionVersion: session.version, dateWindowDays }, t("reconciliation.suggestionsGenerated"));
  }

  async function closeSession() {
    if (!session) return;
    await write(`/bank-reconciliation/sessions/${session.id}/close`, "bank-reconciliation-close", { sessionVersion: session.version, ...(closingExplanation.trim() ? { explanation: closingExplanation.trim() } : {}) }, t("reconciliation.sessionClosed"));
  }

  function statusLabel(line: BankStatementLine, match: BankReconciliationMatch | null) {
    return t(`reconciliation.lineStatus.${reconciliationLineState(line, match)}`);
  }
  function ruleLabel(match: BankReconciliationMatch) { return t(`reconciliation.rule.${match.rule}`); }
  function classificationLabel(value: BankStatementLineClassification) { return t(`reconciliation.classification.${value}`); }
  function documentTypeLabel(value: string) {
    const keys: Record<string, TranslationKey> = {
      MANUAL_JOURNAL: "reconciliation.documentType.MANUAL_JOURNAL",
      INVENTORY_ADJUSTMENT: "reconciliation.documentType.INVENTORY_ADJUSTMENT",
      RECEIPT: "reconciliation.documentType.RECEIPT",
      PAYMENT: "reconciliation.documentType.PAYMENT",
      SALES_INVOICE: "reconciliation.documentType.SALES_INVOICE",
      SALES_CREDIT_NOTE: "reconciliation.documentType.SALES_CREDIT_NOTE",
      PURCHASE_INVOICE: "reconciliation.documentType.PURCHASE_INVOICE",
      PURCHASE_DEBIT_NOTE: "reconciliation.documentType.PURCHASE_DEBIT_NOTE",
    };
    return t(keys[value] ?? "reconciliation.documentType.OTHER");
  }

  function exportReport(exceptionsOnly: boolean) {
    if (!session) return;
    const lines = session.lines.filter((line) => !exceptionsOnly || reconciliationLineState(line, activeMatchForLine(session.matches, line.id)) !== "APPROVED");
    const rows = lines.map((line) => {
      const match = activeMatchForLine(session.matches, line.id);
      const state = reconciliationLineState(line, match);
      return [
        String(line.sourceRowNumber), line.bookingDate, line.reference ?? line.externalId ?? "", line.description ?? "",
        line.amount, line.currency, t(`reconciliation.lineStatus.${state}`),
        match?.bookMovement.documentNumber ?? "", match ? documentTypeLabel(match.bookMovement.documentType) : "",
        line.classification ? classificationLabel(line.classification) : "",
      ];
    });
    downloadCsv(exceptionsOnly ? "bank-reconciliation-exceptions.csv" : "bank-reconciliation-report.csv", reconciliationCsv([
      t("reconciliation.csv.row"), t("reconciliation.csv.date"), t("reconciliation.csv.reference"), t("reconciliation.csv.description"), t("reconciliation.csv.amount"), t("reconciliation.csv.currency"), t("reconciliation.csv.status"), t("reconciliation.csv.document"), t("reconciliation.csv.documentType"), t("reconciliation.csv.classification"),
    ], rows));
  }

  if (loading) return <Spinner label={t("reconciliation.sessionLoading")} />;
  if (!session) return <div className="error-panel" role="alert"><p>{error || t("reconciliation.sessionLoadError")}</p><Button variant="secondary" onClick={onBack}>{t("reconciliation.backToSessions")}</Button></div>;
  const unresolved = unresolvedLineCount(session);
  const differenceIsZero = isZeroDecimal(session.difference);
  const canClose = capabilities.canClose && session.status === "OPEN" && unresolved === 0 && (differenceIsZero || closingExplanation.trim().length >= 3);

  return <div className="reconciliation-session-view">
    <div className="reconciliation-session-heading"><Button variant="ghost" icon="back" onClick={onBack}>{t("reconciliation.backToSessions")}</Button><div><span>{session.cashBankAccount.code}</span><h2>{session.cashBankAccount.nameAr}</h2><p dir="ltr">{session.dateFrom} — {session.dateTo}</p></div><span className={`status-chip ${session.status.toLowerCase()}`}>{t(`reconciliation.status.${session.status}`)}</span></div>
    {error && <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("common.retry")}</Button></div>}
    <div className="reconciliation-summary">
      <div><span>{t("reconciliation.bankOpening")}</span><strong dir="ltr">{session.bankOpeningBalance ?? "—"} {session.currency}</strong></div>
      <div><span>{t("reconciliation.bankClosing")}</span><strong dir="ltr">{session.bankClosingBalance ?? "—"} {session.currency}</strong></div>
      <div><span>{t("reconciliation.bookClosing")}</span><strong dir="ltr">{session.bookClosingBalance} {session.currency}</strong></div>
      <div className={differenceIsZero ? "balanced" : "difference"}><span>{t("reconciliation.difference")}</span><strong dir="ltr">{session.difference} {session.currency}</strong><small>{differenceIsZero ? t("reconciliation.zeroDifference") : t("reconciliation.differenceNeedsReview")}</small></div>
    </div>
    <div className="reconciliation-actions-bar">
      <label><span>{t("reconciliation.dateWindow")}</span><input type="number" min={0} max={30} value={dateWindowDays} onChange={(event) => setDateWindowDays(Number(event.target.value))} /></label>
      <Button variant="secondary" onClick={() => void generateSuggestions()} disabled={busy || !capabilities.canSuggest || session.status === "CLOSED"}>{t("reconciliation.generateSuggestions")}</Button>
      <div className="export-actions"><Button variant="ghost" icon="arrowDown" onClick={() => exportReport(false)}>{t("reconciliation.exportReport")}</Button><Button variant="ghost" icon="arrowDown" onClick={() => exportReport(true)}>{t("reconciliation.exportExceptions")}</Button></div>
    </div>
    {!capabilities.canReview && session.status === "OPEN" && <div className="inline-notice neutral">{t("reconciliation.shadowNotice")}</div>}
    <div className="toolbar reconciliation-filters">
      <select aria-label={t("reconciliation.lineStatusFilter")} value={lineFilter} onChange={(event) => setLineFilter(event.target.value as LineFilter)}><option value="ALL">{t("reconciliation.allLineStatuses")}</option><option value="UNMATCHED">{t("reconciliation.lineStatus.UNMATCHED")}</option><option value="PROPOSED">{t("reconciliation.lineStatus.PROPOSED")}</option><option value="APPROVED">{t("reconciliation.lineStatus.APPROVED")}</option><option value="CLASSIFIED">{t("reconciliation.lineStatus.CLASSIFIED")}</option></select>
      <input aria-label={t("reconciliation.amountFilter")} placeholder={t("reconciliation.amountFilter")} dir="ltr" value={amountFilter} onChange={(event) => setAmountFilter(event.target.value)} />
      <label><span>{t("reconciliation.fromDate")}</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label><span>{t("reconciliation.toDate")}</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
    </div>
    <div className="data-table-wrap reconciliation-table-wrap" role="region" tabIndex={0} aria-label={t("reconciliation.comparisonTable")}><table className="data-table reconciliation-table"><thead><tr><th>{t("reconciliation.bankStatementSide")}</th><th>{t("reconciliation.bookSide")}</th><th>{t("reconciliation.matchStatus")}</th><th></th></tr></thead><tbody>{visibleLines.length ? visibleLines.map((line) => {
      const match = activeMatchForLine(session.matches, line.id);
      const state = reconciliationLineState(line, match);
      return <tr key={line.id}><td><div className="movement-cell"><strong dir="ltr">{line.amount} {line.currency}</strong><span dir="ltr">{line.bookingDate}</span><small>{line.reference || line.externalId || t("reconciliation.noReference")}</small><p>{line.description || "—"}</p></div></td><td>{match ? <div className="movement-cell"><strong>{match.bookMovement.documentNumber}</strong><span>{documentTypeLabel(match.bookMovement.documentType)} · <span dir="ltr">{match.bookMovement.occurredOn}</span></span><small dir="ltr">{match.bookMovement.amount} {match.bookMovement.currency}</small><p>{match.bookMovement.reference || t("reconciliation.noReference")}</p></div> : <span className="muted-value">{t("reconciliation.noBookMovement")}</span>}</td><td><span className={`status-chip reconciliation-${state.toLowerCase()}`}>{statusLabel(line, match)}</span>{match?.status === "PROPOSED" && <small className="match-reason">{ruleLabel(match)} · {formatNumber(match.score)}%</small>}{line.classification && <small className="match-reason">{classificationLabel(line.classification)}</small>}</td><td>{session.status === "OPEN" && (capabilities.canReview || match?.status === "PROPOSED") && <Button variant="ghost" onClick={() => setReviewLine(line)}>{capabilities.canReview ? t("reconciliation.reviewLine") : t("reconciliation.viewSuggestion")}</Button>}</td></tr>;
    }) : <tr><td colSpan={4}>{t("reconciliation.noFilteredLines")}</td></tr>}</tbody></table></div>
    {filteredLines.length > pageSize && <Pagination page={linePage} totalPages={totalPages} total={filteredLines.length} onChange={setLinePage} />}
    <section className="reconciliation-close-panel"><div><h3>{t("reconciliation.closeTitle")}</h3><p>{t("reconciliation.closeDescription", { value: formatNumber(unresolved) })}</p></div>{!differenceIsZero && <label><span>{t("reconciliation.closingExplanation")}</span><textarea value={closingExplanation} minLength={3} maxLength={500} onChange={(event) => setClosingExplanation(event.target.value)} disabled={session.status === "CLOSED"} /></label>}<Button icon="check" onClick={() => void closeSession()} disabled={busy || !canClose}>{session.status === "CLOSED" ? t("reconciliation.closed") : t("reconciliation.closeSession")}</Button>{!capabilities.canClose && session.status === "OPEN" && <small>{t("reconciliation.closeNotEnabled")}</small>}</section>
    {reviewLine && <LineReviewModal session={session} line={reviewLine} match={activeMatchForLine(session.matches, reviewLine.id)} movements={movements} canReview={capabilities.canReview} busy={busy} onClose={() => setReviewLine(null)} onWrite={write} />}
  </div>;
}

function LineReviewModal({ session, line, match, movements, canReview, busy, onClose, onWrite }: { session: BankReconciliationSessionDetail; line: BankStatementLine; match: BankReconciliationMatch | null; movements: BankReconciliationBookMovement[]; canReview: boolean; busy: boolean; onClose: () => void; onWrite: (path: string, operation: string, body: Record<string, unknown>, success: string) => Promise<void> }) {
  const { t } = useI18n();
  const [movementKey, setMovementKey] = useState("");
  const [classification, setClassification] = useState<BankStatementLineClassification>("PENDING_TRANSACTION");
  const [note, setNote] = useState("");
  const availableMovements = movements.filter((movement) => !movement.matched || movement.key === match?.bookMovement.key);

  return <Modal title={t("reconciliation.reviewTitle")} description={t("reconciliation.reviewDescription")} onClose={onClose} wide>
    <div className="review-line-summary"><div><span>{t("reconciliation.bankStatementSide")}</span><strong dir="ltr">{line.amount} {line.currency}</strong><small dir="ltr">{line.bookingDate}</small><p>{line.reference || line.externalId || t("reconciliation.noReference")}</p></div>{match && <div><span>{t("reconciliation.bookSide")}</span><strong>{match.bookMovement.documentNumber}</strong><small dir="ltr">{match.bookMovement.amount} {match.bookMovement.currency}</small><p>{t(`reconciliation.rule.${match.rule}`)}</p></div>}</div>
    {!canReview ? <div className="inline-notice neutral">{t("reconciliation.shadowNotice")}</div> : match?.status === "PROPOSED" ? <div className="review-action-card"><h3>{t("reconciliation.approveSuggestion")}</h3><p>{t("reconciliation.approveSuggestionDescription")}</p><Button icon="check" disabled={busy} onClick={() => void onWrite(`/bank-reconciliation/sessions/${session.id}/matches/${match.id}/approve`, "bank-reconciliation-approve", { sessionVersion: session.version, matchVersion: match.version }, t("reconciliation.matchApproved"))}>{t("reconciliation.approve")}</Button></div> : match?.status === "APPROVED" ? <div className="review-action-card"><h3>{t("reconciliation.releaseMatch")}</h3><label><span>{t("reconciliation.releaseReason")}</span><textarea value={note} minLength={3} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label><Button variant="danger" disabled={busy || note.trim().length < 3} onClick={() => void onWrite(`/bank-reconciliation/sessions/${session.id}/matches/${match.id}/release`, "bank-reconciliation-release", { sessionVersion: session.version, matchVersion: match.version, reason: note.trim() }, t("reconciliation.matchReleased"))}>{t("reconciliation.release")}</Button></div> : <div className="review-options">
      <section className="review-action-card"><h3>{t("reconciliation.manualMatch")}</h3><p>{t("reconciliation.manualMatchDescription")}</p><label><span>{t("reconciliation.bookMovement")}</span><select value={movementKey} onChange={(event) => setMovementKey(event.target.value)}><option value="">{t("reconciliation.selectMovement")}</option>{availableMovements.map((movement) => <option key={movement.key} value={movement.key}>{movement.documentNumber} · {movement.occurredOn} · {movement.amount} {movement.currency}</option>)}</select></label><Button disabled={busy || !movementKey} onClick={() => void onWrite(`/bank-reconciliation/sessions/${session.id}/matches/manual`, "bank-reconciliation-manual", { sessionVersion: session.version, bankStatementLineId: line.id, bookMovementKey: movementKey }, t("reconciliation.manualMatched"))}>{t("reconciliation.confirmManualMatch")}</Button></section>
      <section className="review-action-card"><h3>{t("reconciliation.classifyException")}</h3><p>{t("reconciliation.classifyDescription")}</p><label><span>{t("reconciliation.classification")}</span><select value={classification} onChange={(event) => setClassification(event.target.value as BankStatementLineClassification)}>{classifications.map((value) => <option key={value} value={value}>{t(`reconciliation.classification.${value}`)}</option>)}</select></label><label><span>{t("reconciliation.classificationNote")}</span><textarea value={note} minLength={3} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label><Button variant="secondary" disabled={busy || note.trim().length < 3} onClick={() => void onWrite(`/bank-reconciliation/sessions/${session.id}/lines/${line.id}/classify`, "bank-reconciliation-classify", { sessionVersion: session.version, lineVersion: line.version, classification, note: note.trim() }, t("reconciliation.lineClassified"))}>{t("reconciliation.saveClassification")}</Button></section>
    </div>}
    <div className="form-actions"><Button variant="ghost" onClick={onClose}>{t("common.close")}</Button></div>
  </Modal>;
}
