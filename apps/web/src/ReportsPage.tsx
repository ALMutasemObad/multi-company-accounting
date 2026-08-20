import { Fragment, useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "./api";
import { formatMoney } from "./domain";
import { currentYearRange, monthLabel, trialBalanceCsv } from "./reporting";
import type { Account, DashboardReport, FinancialPositionReport, IncomeStatementReport, JournalReport, LedgerReport, StatementRow, StatementSection, TrialBalanceReport } from "./types";
import { Button, EmptyState, Pagination, Spinner } from "./ui";

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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل التقرير."); }
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
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل كشف الحساب."); }
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
    <header className="page-heading"><div><span className="section-kicker">تحليل واتخاذ قرار</span><h1>التقارير المالية</h1><p>قوائم مالية مستمدة مباشرة من القيود المرحّلة، مع المقارنة والتفاصيل والتصدير.</p></div></header>
    <div className="section-tabs report-tabs" role="tablist">
      <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>التدفق النقدي</button>
      <button className={tab === "trial" ? "active" : ""} onClick={() => setTab("trial")}>ميزان المراجعة</button>
      <button className={tab === "journal" ? "active" : ""} onClick={() => setTab("journal")}>دفتر اليومية</button>
      <button className={tab === "position" ? "active" : ""} onClick={() => setTab("position")}>المركز المالي</button>
      <button className={tab === "income" ? "active" : ""} onClick={() => setTab("income")}>قائمة الدخل</button>
    </div>
    <div className="report-toolbar">
      {tab !== "position" && <label><span>من تاريخ</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>}
      <label><span>{tab === "position" ? "كما في" : "إلى تاريخ"}</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      {(tab === "position" || tab === "income") && <label className="check-field inline-check"><input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} /><span>مقارنة</span></label>}
      {compareEnabled && tab === "income" && <label><span>بداية المقارنة</span><input type="date" value={compareDateFrom} onChange={(event) => setCompareDateFrom(event.target.value)} /></label>}
      {compareEnabled && (tab === "position" || tab === "income") && <label><span>{tab === "position" ? "تاريخ المقارنة" : "نهاية المقارنة"}</span><input type="date" value={compareDateTo} onChange={(event) => setCompareDateTo(event.target.value)} /></label>}
      {(tab === "position" || tab === "income") && <label className="check-field inline-check"><input type="checkbox" checked={includeZeroBalances} onChange={(event) => setIncludeZeroBalances(event.target.checked)} /><span>إظهار الأرصدة الصفرية</span></label>}
      {tab === "journal" && <>
        <label><span>نوع المستند</span><select value={journalDocumentType} onChange={(event) => setJournalDocumentType(event.target.value)}><option value="">كل الأنواع</option><option value="MANUAL_JOURNAL">قيد يومية</option><option value="RECEIPT">سند قبض</option><option value="PAYMENT">سند صرف</option><option value="PERIOD_CLOSE">إقفال فترة</option></select></label>
        <label><span>الحالة</span><select value={journalStatus} onChange={(event) => setJournalStatus(event.target.value)}><option value="">المرحّل والمعكوس</option><option value="POSTED">مرحّل</option><option value="REVERSED">معكوس</option></select></label>
        <label><span>الحساب</span><select value={journalAccountId} onChange={(event) => setJournalAccountId(event.target.value)}><option value="">كل الحسابات</option>{accounts.filter((account) => account.allowsPosting).map((account) => <option key={account.id} value={account.id}>{account.code} - {account.nameAr}</option>)}</select></label>
        <label><span>بحث</span><input value={journalSearch} onChange={(event) => setJournalSearch(event.target.value)} placeholder="رقم المستند أو البيان" /></label>
      </>}
      <Button disabled={invalid} onClick={applyFilters}>إعداد التقرير</Button>
    </div>
    {loading && !hasData ? <Spinner label="جارٍ إعداد التقرير" /> : error && !hasData ? <div className="error-panel"><h3>تعذر إعداد التقرير</h3><p>{error}</p><Button onClick={() => void load()}>إعادة المحاولة</Button></div> : <>
      {error && <div className="inline-notice">{error}</div>}
      {tab === "cash" && <CashFlowView report={cashFlow} />}
      {tab === "trial" && <TrialBalanceView report={trial} onDownload={downloadTrialCsv} />}
      {tab === "journal" && <JournalReportView report={journal} onExport={() => void exportJournal()} onPageChange={setJournalPage} />}
      {tab === "position" && position && <FinancialPositionView report={position} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {tab === "income" && income && <IncomeStatementView report={income} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {ledgerLoading && <Spinner label="جارٍ تحميل كشف الحساب" />}
      {ledger && <LedgerView report={ledger} onClose={() => setLedger(null)} />}
    </>}
  </section>;
}

function CashFlowView({ report }: { report: DashboardReport | null }) {
  return <article className="panel report-section"><header><div><h2>التدفق النقدي</h2><p>المقبوضات والمدفوعات وصافي الحركة حسب الشهر</p></div></header>
    {report?.cashFlow.length ? <div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>الشهر</th><th>المقبوضات</th><th>المدفوعات</th><th>الصافي</th></tr></thead><tbody>{report.cashFlow.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}</td><td className="money-cell positive-text">{formatMoney(row.receipts)}</td><td className="money-cell negative-text">{formatMoney(row.payments)}</td><td className={`money-cell ${Number(row.net) >= 0 ? "positive-text" : "negative-text"}`}>{formatMoney(row.net)}</td></tr>)}</tbody></table></div> : <EmptyState title="لا توجد حركة نقدية" description="لا توجد سندات مرحّلة في الفترة المختارة." />}
  </article>;
}
function TrialBalanceView({ report, onDownload }: { report: TrialBalanceReport | null; onDownload: () => void }) {
  return <article className="panel report-section"><header><div><h2>ميزان المراجعة</h2><p>إجمالي الحركة المدينة والدائنة لكل حساب ضمن الفترة</p></div><Button variant="secondary" onClick={onDownload} disabled={!report?.data.length}>تنزيل CSV</Button></header>
    {report?.data.length ? <div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>رمز الحساب</th><th>اسم الحساب</th><th>التصنيف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.accountId}><td><span className="code-pill">{row.code}</span></td><td>{row.nameAr}</td><td>{classLabel(row.accountClass)}</td><td className="money-cell">{formatMoney(row.debit)}</td><td className="money-cell">{formatMoney(row.credit)}</td><td className="money-cell">{formatMoney(row.balance)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>الإجمالي</th><th>{formatMoney(report.totals.debit)}</th><th>{formatMoney(report.totals.credit)}</th><th>{formatMoney(Number(report.totals.debit) - Number(report.totals.credit))}</th></tr></tfoot></table></div> : <EmptyState title="لا توجد قيود مرحّلة" description="سيظهر ميزان المراجعة بعد ترحيل أول قيد ضمن الفترة المختارة." />}
  </article>;
}
function JournalReportView({ report, onExport, onPageChange }: { report: JournalReport | null; onExport: () => void; onPageChange: (page: number) => void }) {
  return <article className="panel report-section"><header><div><h2>دفتر اليومية</h2><p>القيود المرحّلة والمعكوسة مرتبة من الأحدث، مع إجماليات متوازنة لكل قيد.</p></div><Button variant="secondary" onClick={onExport} disabled={!report?.data.length}>تنزيل CSV</Button></header>
    {report?.data.length ? <><div className="data-table-wrap flat"><table className="data-table journal-report-table"><thead><tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>البيان</th><th>الحالة</th><th>مدين</th><th>دائن</th><th>التوازن</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.journalEntryId}><td>{row.entryDate}</td><td><span className="code-pill">{row.documentNumber}</span><small>القيد {row.entryNumber.toLocaleString("ar-SA")}</small></td><td>{documentTypeLabel(row.documentType)}</td><td>{row.description}</td><td><span className={`status-chip ${row.status.toLowerCase()}`}>{row.status === "POSTED" ? "مرحّل" : "معكوس"}</span></td><td className="money-cell">{formatMoney(row.debitTotal)}</td><td className="money-cell">{formatMoney(row.creditTotal)}</td><td><span className={`balance-indicator ${row.balanced ? "balanced" : "unbalanced"}`}>{row.balanced ? "متوازن" : "غير متوازن"}</span></td></tr>)}</tbody><tfoot><tr><th colSpan={5}>إجمالي النتائج المصفاة</th><th>{formatMoney(report.totals.debit)}</th><th>{formatMoney(report.totals.credit)}</th><th>{Number(report.totals.debit) === Number(report.totals.credit) ? "متوازن" : "يوجد فرق"}</th></tr></tfoot></table></div><Pagination {...report.meta} page={report.meta.page} onChange={onPageChange} /></> : <EmptyState title="لا توجد قيود مطابقة" description="غيّر الفترة أو المرشحات لعرض قيود دفتر اليومية." />}
  </article>;
}
function FinancialPositionView({ report, onLedger, onExport }: { report: FinancialPositionReport; onLedger: (id: string) => void; onExport: (format: "csv" | "xlsx" | "pdf") => void }) {
  return <>
    <div className="metric-grid statement-metrics"><Metric label="إجمالي الأصول" value={report.totals.assets} /><Metric label="إجمالي الالتزامات" value={report.totals.liabilities} /><Metric label="حقوق الملكية" value={report.totals.equity} /><Metric label="أرباح غير مقفلة" value={report.currentEarnings} /></div>
    <article className="panel report-section"><header><div><h2>المركز المالي كما في {report.asOf}</h2><p className={report.reconciliation.balanced ? "positive-text" : "negative-text"}>{report.reconciliation.balanced ? "المعادلة المحاسبية متوازنة" : `يوجد فرق قدره ${formatMoney(report.reconciliation.difference)}`}</p></div><ExportActions onExport={onExport} /></header>
      <StatementTable sections={[{ title: "الأصول", value: report.sections.assets }, { title: "الالتزامات", value: report.sections.liabilities }, { title: "حقوق الملكية", value: report.sections.equity }]} hasComparison={report.comparisonAsOf != null} onLedger={onLedger} />
    </article>
  </>;
}
function IncomeStatementView({ report, onLedger, onExport }: { report: IncomeStatementReport; onLedger: (id: string) => void; onExport: (format: "csv" | "xlsx" | "pdf") => void }) {
  return <>
    <div className="metric-grid statement-metrics"><Metric label="الإيرادات" value={report.totals.revenues} /><Metric label="المصروفات" value={report.totals.expenses} /><Metric label="صافي الربح أو الخسارة" value={report.totals.netIncome} tone={Number(report.totals.netIncome) >= 0 ? "positive" : "negative"} /></div>
    <article className="panel report-section"><header><div><h2>قائمة الدخل</h2><p>من {report.range.dateFrom} إلى {report.range.dateTo}</p></div><ExportActions onExport={onExport} /></header>
      <StatementTable sections={[{ title: "الإيرادات", value: report.sections.revenues }, { title: "المصروفات", value: report.sections.expenses }]} hasComparison={report.comparisonRange != null} onLedger={onLedger} />
      <div className={`statement-net ${Number(report.totals.netIncome) >= 0 ? "positive" : "negative"}`}><span>صافي الربح أو الخسارة</span><strong>{formatMoney(report.totals.netIncome)} {report.baseCurrency.code}</strong>{report.totals.comparisonNetIncome != null && <small>المقارنة: {formatMoney(report.totals.comparisonNetIncome)}</small>}</div>
    </article>
  </>;
}
function StatementTable({ sections, hasComparison, onLedger }: { sections: Array<{ title: string; value: StatementSection }>; hasComparison: boolean; onLedger: (id: string) => void }) {
  return <div className="data-table-wrap flat"><table className="data-table statement-table"><thead><tr><th>الحساب</th><th>الرصيد الحالي</th>{hasComparison && <><th>رصيد المقارنة</th><th>التغير</th><th>التغير %</th></>}</tr></thead><tbody>{sections.map((section) => <Fragment key={section.title}><tr className="statement-section-row"><th colSpan={hasComparison ? 5 : 2}>{section.title}</th></tr>{renderRows(section.value.rows, hasComparison, onLedger)}<tr className="statement-total-row"><th>إجمالي {section.title}</th><th>{formatMoney(section.value.total)}</th>{hasComparison && <><th>{formatMoney(section.value.comparisonTotal ?? 0)}</th><th>{formatMoney(section.value.variance ?? 0)}</th><th>{section.value.variancePercent == null ? "—" : `${section.value.variancePercent}%`}</th></>}</tr></Fragment>)}</tbody></table></div>;
}
function renderRows(rows: StatementRow[], hasComparison: boolean, onLedger: (id: string) => void, depth = 0): React.ReactNode[] {
  return rows.flatMap((row) => [<tr key={row.accountId ?? row.code}><td style={{ paddingInlineStart: `${16 + depth * 24}px` }}>{row.accountId ? <button className="account-drilldown" onClick={() => onLedger(row.accountId!)}><span className="code-pill">{row.code}</span>{row.nameAr}</button> : <strong>{row.nameAr}</strong>}</td><td className="money-cell">{formatMoney(row.amount)}</td>{hasComparison && <><td className="money-cell">{formatMoney(row.comparisonAmount ?? 0)}</td><td className={`money-cell ${Number(row.variance ?? 0) >= 0 ? "positive-text" : "negative-text"}`}>{formatMoney(row.variance ?? 0)}</td><td className="money-cell">{row.variancePercent == null ? "—" : `${row.variancePercent}%`}</td></>}</tr>, ...renderRows(row.children, hasComparison, onLedger, depth + 1)]);
}
function LedgerView({ report, onClose }: { report: LedgerReport; onClose: () => void }) {
  return <article className="panel report-section ledger-panel"><header><div><h2>كشف حساب: {report.subject.nameAr}</h2><p>{report.subject.code} — من {report.range.dateFrom} إلى {report.range.dateTo}</p></div><Button variant="secondary" onClick={onClose}>إغلاق</Button></header><div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>التاريخ</th><th>المستند</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد المدين</th><th>الرصيد الدائن</th></tr></thead><tbody><tr className="statement-total-row"><td colSpan={3}>الرصيد الافتتاحي</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td></tr>{report.data.map((row) => <tr key={row.id}><td>{row.date}</td><td><span className="code-pill">{row.documentNumber}</span></td><td>{row.description}</td><td className="money-cell">{formatMoney(row.debit)}</td><td className="money-cell">{formatMoney(row.credit)}</td><td className="money-cell">{formatMoney(row.runningDebit)}</td><td className="money-cell">{formatMoney(row.runningCredit)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>الرصيد الختامي</th><th>{formatMoney(report.closingDebit)}</th><th>{formatMoney(report.closingCredit)}</th></tr></tfoot></table></div></article>;
}
function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{formatMoney(value)}</strong><small>ريال سعودي</small></article>; }
function ExportActions({ onExport }: { onExport: (format: "csv" | "xlsx" | "pdf") => void }) { return <div className="report-export-actions"><Button variant="secondary" onClick={() => onExport("csv")}>CSV</Button><Button variant="secondary" onClick={() => onExport("xlsx")}>Excel</Button><Button variant="secondary" onClick={() => onExport("pdf")}>PDF</Button></div>; }
const classLabel = (value: string) => ({ ASSET: "أصول", LIABILITY: "التزامات", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات" }[value] ?? value);
const documentTypeLabel = (value: string) => ({ MANUAL_JOURNAL: "قيد يومية", RECEIPT: "سند قبض", PAYMENT: "سند صرف", PERIOD_CLOSE: "إقفال فترة" }[value] ?? value);
const previousYear = (value: string) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
const rangeQuery = (value: { dateFrom: string; dateTo: string }) => new URLSearchParams({ dateFrom: value.dateFrom, dateTo: value.dateTo });
