import {
  activeIntlLocale,
  localizedReferenceName,
  translate as t } from "./i18n";
import { Fragment,
  useCallback,
  useEffect,
  useState } from "react";
import { api,
  downloadFile } from "./api";
import { formatMoney } from "./domain";
import { currentYearRange,
  monthLabel,
  trialBalanceCsv } from "./reporting";
import type { Account,
  DashboardReport,
  FinancialPositionReport,
  IncomeStatementReport,
  JournalReport,
  LedgerReport,
  StatementRow,
  StatementSection,
  TrialBalanceReport } from "./types";
import { Button,
  EmptyState,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Tab = "cash" | "trial" | "journal" | "position" | "income";

export function ReportsPage() {
  const initial = currentYearRange();
  const [tab, setTab] = useState<Tab>("cash");
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDateFrom, setCompareDateFrom] = useState(previousYear(initial.dateFrom));
  const [compareDateTo, setCompareDateTo] = useState(previousYear(initial.dateTo));
  const [includeZeroBalances, setIncludeZeroBalances] = useState(false);
  const [journalDocumentType, setJournalDocumentType] = useState("");
  const [journalStatus, setJournalStatus] = useState("");
  const [journalAccountId, setJournalAccountId] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalPage, setJournalPage] = useState(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [applied, setApplied] = useState({ dateFrom: initial.dateFrom, dateTo: initial.dateTo, compareEnabled: false, compareDateFrom: previousYear(initial.dateFrom), compareDateTo: previousYear(initial.dateTo), includeZeroBalances: false, journalDocumentType: "", journalStatus: "", journalAccountId: "", journalSearch: "" });
  const [cashFlow, setCashFlow] = useState<DashboardReport | null>(null);
  const [trial, setTrial] = useState<TrialBalanceReport | null>(null);
  const [position, setPosition] = useState<FinancialPositionReport | null>(null);
  const [income, setIncome] = useState<IncomeStatementReport | null>(null);
  const [journal, setJournal] = useState<JournalReport | null>(null);
  const [ledger, setLedger] = useState<LedgerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(""); setLedger(null);
    try {
      if (tab === "cash") setCashFlow(await api<DashboardReport>(`/reports/dashboard?${rangeQuery(applied)}`));
      if (tab === "trial") setTrial(await api<TrialBalanceReport>(`/reports/trial-balance?${rangeQuery(applied)}`));
      if (tab === "journal") {
        const query = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo, page: String(journalPage), pageSize: "25" });
        if (applied.journalDocumentType) query.set("documentType", applied.journalDocumentType);
        if (applied.journalStatus) query.set("status", applied.journalStatus);
        if (applied.journalAccountId) query.set("accountId", applied.journalAccountId);
        if (applied.journalSearch) query.set("search", applied.journalSearch);
        const [report, accountResult] = await Promise.all([
          api<JournalReport>(`/reports/journal?${query}`),
          accounts.length ? Promise.resolve({ data: accounts }) : api<{ data: Account[] }>("/accounts?page=1&pageSize=100&active=true"),
        ]);
        setJournal(report); setAccounts(accountResult.data);
      }
      if (tab === "position") {
        const query = new URLSearchParams({ asOf: applied.dateTo, includeZeroBalances: String(applied.includeZeroBalances) });
        if (applied.compareEnabled) query.set("compareAsOf", applied.compareDateTo);
        setPosition(await api<FinancialPositionReport>(`/reports/financial-position?${query}`));
      }
      if (tab === "income") {
        const query = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo, includeZeroBalances: String(applied.includeZeroBalances) });
        if (applied.compareEnabled) { query.set("compareDateFrom", applied.compareDateFrom); query.set("compareDateTo", applied.compareDateTo); }
        setIncome(await api<IncomeStatementReport>(`/reports/income-statement?${query}`));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.reports.001")); }
    finally { setLoading(false); }
  }, [accounts, applied, journalPage, tab]);
  useEffect(() => { void load(); }, [load]);

  function applyFilters() { setJournalPage(1); setApplied({ dateFrom, dateTo, compareEnabled, compareDateFrom, compareDateTo, includeZeroBalances, journalDocumentType, journalStatus, journalAccountId, journalSearch: journalSearch.trim() }); }
  function downloadTrialCsv() {
    if (!trial) return;
    const blob = new Blob(["\uFEFF", trialBalanceCsv(trial.data)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `trial-balance-${applied.dateFrom}-${applied.dateTo}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function openLedger(accountId: string) {
    setLedgerLoading(true); setError("");
    try { setLedger(await api<LedgerReport>(`/reports/ledger?${new URLSearchParams({ accountId, dateFrom: applied.dateFrom, dateTo: applied.dateTo, page: "1", pageSize: "100" })}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.reports.002")); }
    finally { setLedgerLoading(false); }
  }
  async function exportReport(format: "csv" | "xlsx" | "pdf") {
    const isPosition = tab === "position";
    const query = isPosition
      ? new URLSearchParams({ asOf: applied.dateTo, includeZeroBalances: String(applied.includeZeroBalances) })
      : new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo, includeZeroBalances: String(applied.includeZeroBalances) });
    if (applied.compareEnabled) {
      if (isPosition) query.set("compareAsOf", applied.compareDateTo);
      else { query.set("compareDateFrom", applied.compareDateFrom); query.set("compareDateTo", applied.compareDateTo); }
    }
    const name = isPosition ? "financial-position" : "income-statement";
    await downloadFile(`/reports/${name}/${format}?${query}`, `${name}.${format}`);
  }
  async function exportJournal() {
    const query = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo });
    if (applied.journalDocumentType) query.set("documentType", applied.journalDocumentType);
    if (applied.journalStatus) query.set("status", applied.journalStatus);
    if (applied.journalAccountId) query.set("accountId", applied.journalAccountId);
    if (applied.journalSearch) query.set("search", applied.journalSearch);
    await downloadFile(`/reports/journal/csv?${query}`, `journal-report-${applied.dateFrom}-${applied.dateTo}.csv`);
  }

  const comparisonInvalid = (tab === "position" || tab === "income") && compareEnabled && (!compareDateFrom || !compareDateTo || compareDateFrom > compareDateTo);
  const invalid = !dateFrom || !dateTo || dateFrom > dateTo || comparisonInvalid;
  const hasData = tab === "cash" ? cashFlow : tab === "trial" ? trial : tab === "journal" ? journal : tab === "position" ? position : income;
  return <section className="workspace-page reports-page">
    <PageHeader kicker={t("pages.reports.003")} title={t("pages.reports.004")} description={t("pages.reports.005")} />
    <div className="section-tabs report-tabs" role="tablist">
      <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>{t("pages.reports.006")}</button>
      <button className={tab === "trial" ? "active" : ""} onClick={() => setTab("trial")}>{t("pages.reports.007")}</button>
      <button className={tab === "journal" ? "active" : ""} onClick={() => setTab("journal")}>{t("pages.reports.008")}</button>
      <button className={tab === "position" ? "active" : ""} onClick={() => setTab("position")}>{t("pages.reports.009")}</button>
      <button className={tab === "income" ? "active" : ""} onClick={() => setTab("income")}>{t("pages.reports.010")}</button>
    </div>
    <div className="report-toolbar">
      {tab !== "position" && <label><span>{t("pages.audit-logs.018")}</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>}
      <label><span>{tab === "position" ? t("pages.purchase-invoices.112") : t("pages.audit-logs.019")}</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      {(tab === "position" || tab === "income") && <label className="check-field inline-check"><input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} /><span>{t("pages.reports.014")}</span></label>}
      {compareEnabled && tab === "income" && <label><span>{t("pages.reports.015")}</span><input type="date" value={compareDateFrom} onChange={(event) => setCompareDateFrom(event.target.value)} /></label>}
      {compareEnabled && (tab === "position" || tab === "income") && <label><span>{tab === "position" ? t("pages.reports.016") : t("pages.reports.017")}</span><input type="date" value={compareDateTo} onChange={(event) => setCompareDateTo(event.target.value)} /></label>}
      {(tab === "position" || tab === "income") && <label className="check-field inline-check"><input type="checkbox" checked={includeZeroBalances} onChange={(event) => setIncludeZeroBalances(event.target.checked)} /><span>{t("pages.reports.018")}</span></label>}
      {tab === "journal" && <>
        <label><span>{t("pages.purchase-invoices.023")}</span><select value={journalDocumentType} onChange={(event) => setJournalDocumentType(event.target.value)}><option value="">{t("pages.reports.020")}</option><option value="MANUAL_JOURNAL">{t("pages.reports.021")}</option><option value="RECEIPT">{t("pages.reports.022")}</option><option value="PAYMENT">{t("pages.reports.023")}</option><option value="PERIOD_CLOSE">{t("pages.reports.024")}</option></select></label>
        <label><span>{t("pages.accounts.043")}</span><select value={journalStatus} onChange={(event) => setJournalStatus(event.target.value)}><option value="">{t("pages.reports.026")}</option><option value="POSTED">{t("pages.dashboard.045")}</option><option value="REVERSED">{t("pages.dashboard.047")}</option></select></label>
        <label><span>{t("pages.accounts.039")}</span><select value={journalAccountId} onChange={(event) => setJournalAccountId(event.target.value)}><option value="">{t("pages.reports.030")}</option>{accounts.filter((account) => account.allowsPosting).map((account) => <option key={account.id} value={account.id}>{account.code} - {localizedReferenceName(account)}</option>)}</select></label>
        <label><span>{t("pages.accounts.026")}</span><input value={journalSearch} onChange={(event) => setJournalSearch(event.target.value)} placeholder={t("pages.reports.032")} /></label>
      </>}
      <Button disabled={invalid} onClick={applyFilters}>{t("pages.purchase-invoices.114")}</Button>
    </div>
    {loading && !hasData ? <Spinner label={t("pages.reports.034")} /> : error && !hasData ? <div className="error-panel" role="alert"><h3>{t("pages.reports.035")}</h3><p>{error}</p><Button onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : <>
      {error && <div className="inline-notice">{error}</div>}
      {tab === "cash" && <CashFlowView report={cashFlow} />}
      {tab === "trial" && <TrialBalanceView report={trial} onDownload={downloadTrialCsv} />}
      {tab === "journal" && <JournalReportView report={journal} onExport={() => void exportJournal()} onPageChange={setJournalPage} />}
      {tab === "position" && position && <FinancialPositionView report={position} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {tab === "income" && income && <IncomeStatementView report={income} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {ledgerLoading && <Spinner label={t("pages.reports.037")} />}
      {ledger && <LedgerView report={ledger} onClose={() => setLedger(null)} />}
    </>}
  </section>;
}

function CashFlowView({ report }: { report: DashboardReport | null }) {
  return <article className="panel report-section"><header><div><h2>{t("pages.reports.006")}</h2><p>{t("pages.reports.038")}</p></div></header>
    {report?.cashFlow.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.reports.039")}</th><th>{t("pages.dashboard.025")}</th><th>{t("pages.dashboard.026")}</th><th>{t("pages.reports.042")}</th></tr></thead><tbody>{report.cashFlow.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}</td><td className="money-cell positive-text">{formatMoney(row.receipts)}</td><td className="money-cell negative-text">{formatMoney(row.payments)}</td><td className={`money-cell ${Number(row.net) >= 0 ? "positive-text" : "negative-text"}`}>{formatMoney(row.net)}</td></tr>)}</tbody></table></div> : <EmptyState title={t("pages.dashboard.023")} description={t("pages.reports.044")} />}
  </article>;
}
function TrialBalanceView({ report, onDownload }: { report: TrialBalanceReport | null; onDownload: () => void }) {
  return <article className="panel report-section"><header><div><h2>{t("pages.reports.007")}</h2><p>{t("pages.reports.045")}</p></div><Button variant="secondary" onClick={onDownload} disabled={!report?.data.length}>{t("pages.reports.046")}</Button></header>
    {report?.data.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.reports.047")}</th><th>{t("pages.reports.048")}</th><th>{t("pages.reports.049")}</th><th>{t("pages.manual-journals.060")}</th><th>{t("pages.manual-journals.061")}</th><th>{t("pages.reports.052")}</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.accountId}><td><span className="code-pill">{row.code}</span></td><td>{localizedReferenceName(row)}</td><td>{classLabel(row.accountClass)}</td><td className="money-cell">{formatMoney(row.debit)}</td><td className="money-cell">{formatMoney(row.credit)}</td><td className="money-cell">{formatMoney(row.balance)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>{t("pages.purchase-invoices.041")}</th><th>{formatMoney(report.totals.debit)}</th><th>{formatMoney(report.totals.credit)}</th><th>{formatMoney(Number(report.totals.debit) - Number(report.totals.credit))}</th></tr></tfoot></table></div> : <EmptyState title={t("pages.reports.054")} description={t("pages.reports.055")} />}
  </article>;
}
function JournalReportView({ report, onExport, onPageChange }: { report: JournalReport | null; onExport: () => void; onPageChange: (page: number) => void }) {
  return <article className="panel report-section"><header><div><h2>{t("pages.reports.008")}</h2><p>{t("pages.reports.056")}</p></div><Button variant="secondary" onClick={onExport} disabled={!report?.data.length}>{t("pages.reports.046")}</Button></header>
    {report?.data.length ? <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table journal-report-table"><thead><tr><th>{t("pages.dashboard.037")}</th><th>{t("pages.purchase-invoices.037")}</th><th>{t("pages.accounts.040")}</th><th>{t("pages.manual-journals.032")}</th><th>{t("pages.accounts.043")}</th><th>{t("pages.manual-journals.060")}</th><th>{t("pages.manual-journals.061")}</th><th>{t("pages.reports.061")}</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.journalEntryId}><td>{row.entryDate}</td><td><span className="code-pill">{row.documentNumber}</span><small>{t("pages.manual-journals.052")}{row.entryNumber.toLocaleString(activeIntlLocale())}</small></td><td>{documentTypeLabel(row.documentType)}</td><td>{row.description}</td><td><span className={`status-chip ${row.status.toLowerCase()}`}>{row.status === "POSTED" ? t("pages.dashboard.045") : t("pages.dashboard.047")}</span></td><td className="money-cell">{formatMoney(row.debitTotal)}</td><td className="money-cell">{formatMoney(row.creditTotal)}</td><td><span className={`balance-indicator ${row.balanced ? "balanced" : "unbalanced"}`}>{row.balanced ? t("pages.reports.063") : t("pages.reports.064")}</span></td></tr>)}</tbody><tfoot><tr><th colSpan={5}>{t("pages.reports.065")}</th><th>{formatMoney(report.totals.debit)}</th><th>{formatMoney(report.totals.credit)}</th><th>{Number(report.totals.debit) === Number(report.totals.credit) ? t("pages.reports.063") : t("pages.reports.066")}</th></tr></tfoot></table></div><Pagination {...report.meta} page={report.meta.page} onChange={onPageChange} /></> : <EmptyState title={t("pages.reports.067")} description={t("pages.reports.068")} />}
  </article>;
}
function FinancialPositionView({ report, onLedger, onExport }: { report: FinancialPositionReport; onLedger: (id: string) => void; onExport: (format: "csv" | "xlsx" | "pdf") => void }) {
  return <>
    <div className="metric-grid statement-metrics"><Metric label={t("pages.reports.069")} value={report.totals.assets} /><Metric label={t("pages.reports.070")} value={report.totals.liabilities} /><Metric label={t("pages.reports.071")} value={report.totals.equity} /><Metric label={t("pages.reports.072")} value={report.currentEarnings} /></div>
    <article className="panel report-section"><header><div><h2>{t("pages.reports.073")}{report.asOf}</h2><p className={report.reconciliation.balanced ? "positive-text" : "negative-text"}>{report.reconciliation.balanced ? t("pages.reports.074") : t("pages.reports.075", { value1: formatMoney(report.reconciliation.difference) })}</p></div><ExportActions onExport={onExport} /></header>
      <StatementTable sections={[{ title: t("pages.reports.076"), value: report.sections.assets }, { title: t("pages.reports.077"), value: report.sections.liabilities }, { title: t("pages.reports.071"), value: report.sections.equity }]} hasComparison={report.comparisonAsOf != null} onLedger={onLedger} />
    </article>
  </>;
}
function IncomeStatementView({ report, onLedger, onExport }: { report: IncomeStatementReport; onLedger: (id: string) => void; onExport: (format: "csv" | "xlsx" | "pdf") => void }) {
  return <>
    <div className="metric-grid statement-metrics"><Metric label={t("pages.reports.078")} value={report.totals.revenues} /><Metric label={t("pages.reports.079")} value={report.totals.expenses} /><Metric label={t("pages.reports.080")} value={report.totals.netIncome} tone={Number(report.totals.netIncome) >= 0 ? "positive" : "negative"} /></div>
    <article className="panel report-section"><header><div><h2>{t("pages.reports.010")}</h2><p>{t("pages.reports.081")}{report.range.dateFrom}{t("pages.payments.051")}{report.range.dateTo}</p></div><ExportActions onExport={onExport} /></header>
      <StatementTable sections={[{ title: t("pages.reports.078"), value: report.sections.revenues }, { title: t("pages.reports.079"), value: report.sections.expenses }]} hasComparison={report.comparisonRange != null} onLedger={onLedger} />
      <div className={`statement-net ${Number(report.totals.netIncome) >= 0 ? "positive" : "negative"}`}><span>{t("pages.reports.080")}</span><strong>{formatMoney(report.totals.netIncome)} {report.baseCurrency.code}</strong>{report.totals.comparisonNetIncome != null && <small>{t("pages.reports.083")}{formatMoney(report.totals.comparisonNetIncome)}</small>}</div>
    </article>
  </>;
}
function StatementTable({ sections, hasComparison, onLedger }: { sections: Array<{ title: string; value: StatementSection }>; hasComparison: boolean; onLedger: (id: string) => void }) {
  return <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table statement-table"><thead><tr><th>{t("pages.accounts.039")}</th><th>{t("pages.reports.084")}</th>{hasComparison && <><th>{t("pages.reports.085")}</th><th>{t("pages.reports.086")}</th><th>{t("pages.reports.087")}</th></>}</tr></thead><tbody>{sections.map((section) => <Fragment key={section.title}><tr className="statement-section-row"><th colSpan={hasComparison ? 5 : 2}>{section.title}</th></tr>{renderRows(section.value.rows, hasComparison, onLedger)}<tr className="statement-total-row"><th>{t("pages.reports.088")}{section.title}</th><th>{formatMoney(section.value.total)}</th>{hasComparison && <><th>{formatMoney(section.value.comparisonTotal ?? 0)}</th><th>{formatMoney(section.value.variance ?? 0)}</th><th>{section.value.variancePercent == null ? "—" : `${section.value.variancePercent}%`}</th></>}</tr></Fragment>)}</tbody></table></div>;
}
function renderRows(rows: StatementRow[], hasComparison: boolean, onLedger: (id: string) => void, depth = 0): React.ReactNode[] {
  return rows.flatMap((row) => [<tr key={row.accountId ?? row.code}><td style={{ paddingInlineStart: `${16 + depth * 24}px` }}>{row.accountId ? <button className="account-drilldown" onClick={() => onLedger(row.accountId!)}><span className="code-pill">{row.code}</span>{localizedReferenceName(row)}</button> : <strong>{localizedReferenceName(row)}</strong>}</td><td className="money-cell">{formatMoney(row.amount)}</td>{hasComparison && <><td className="money-cell">{formatMoney(row.comparisonAmount ?? 0)}</td><td className={`money-cell ${Number(row.variance ?? 0) >= 0 ? "positive-text" : "negative-text"}`}>{formatMoney(row.variance ?? 0)}</td><td className="money-cell">{row.variancePercent == null ? "—" : `${row.variancePercent}%`}</td></>}</tr>, ...renderRows(row.children, hasComparison, onLedger, depth + 1)]);
}
function LedgerView({ report, onClose }: { report: LedgerReport; onClose: () => void }) {
  return <article className="panel report-section ledger-panel"><header><div><h2>{t("pages.reports.089")}{localizedReferenceName(report.subject)}</h2><p>{report.subject.code}{t("pages.reports.090")}{report.range.dateFrom}{t("pages.payments.051")}{report.range.dateTo}</p></div><Button variant="secondary" onClick={onClose}>{t("pages.audit-logs.037")}</Button></header><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.dashboard.037")}</th><th>{t("pages.purchase-invoices.037")}</th><th>{t("pages.manual-journals.032")}</th><th>{t("pages.manual-journals.060")}</th><th>{t("pages.manual-journals.061")}</th><th>{t("pages.reports.092")}</th><th>{t("pages.reports.093")}</th></tr></thead><tbody><tr className="statement-total-row"><td colSpan={3}>{t("pages.reports.094")}</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td></tr>{report.data.map((row) => <tr key={row.id}><td>{row.date}</td><td><span className="code-pill">{row.documentNumber}</span></td><td>{row.description}</td><td className="money-cell">{formatMoney(row.debit)}</td><td className="money-cell">{formatMoney(row.credit)}</td><td className="money-cell">{formatMoney(row.runningDebit)}</td><td className="money-cell">{formatMoney(row.runningCredit)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>{t("pages.reports.095")}</th><th>{formatMoney(report.closingDebit)}</th><th>{formatMoney(report.closingCredit)}</th></tr></tfoot></table></div></article>;
}
function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{formatMoney(value)}</strong><small>{t("pages.reports.096")}</small></article>; }
function ExportActions({ onExport }: { onExport: (format: "csv" | "xlsx" | "pdf") => void }) { return <div className="report-export-actions"><Button variant="secondary" onClick={() => onExport("csv")}>CSV</Button><Button variant="secondary" onClick={() => onExport("xlsx")}>Excel</Button><Button variant="secondary" onClick={() => onExport("pdf")}>PDF</Button></div>; }
const classLabel = (value: string) => ({ ASSET: t("pages.reports.097"), LIABILITY: t("pages.reports.098"), EQUITY: t("pages.reports.099"), REVENUE: t("pages.reports.100"), EXPENSE: t("pages.reports.101") }[value] ?? value);
const documentTypeLabel = (value: string) => ({ MANUAL_JOURNAL: t("pages.reports.021"), RECEIPT: t("pages.reports.022"), PAYMENT: t("pages.reports.023"), PERIOD_CLOSE: t("pages.reports.024") }[value] ?? value);
const previousYear = (value: string) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
const rangeQuery = (value: { dateFrom: string; dateTo: string }) => new URLSearchParams({ dateFrom: value.dateFrom, dateTo: value.dateTo });
