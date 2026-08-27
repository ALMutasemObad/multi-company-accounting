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
  accountStatementQuery,
  trialBalanceCsv,
  type AccountStatementSubjectType } from "./reporting";
import type { Account,
  CashFlowMapping,
  CashFlowMappingClassification,
  CashFlowReportLine,
  CostCenter,
  CostCenterActivityReport,
  Customer,
  FinancialPositionReport,
  IndirectCashFlowReport,
  IncomeStatementReport,
  JournalReport,
  LedgerReport,
  StatementRow,
  StatementSection,
  Supplier,
  TaxSummaryReport,
  TaxSummaryStatus,
  TrialBalanceReport } from "./types";
import { ReferenceCombobox } from "./ReferenceCombobox";
import { Button,
  EmptyState,
  Pagination,
  Spinner,
  PageHeader,
  Modal,
} from "./ui";

type Tab = "cash" | "tax" | "costCenters" | "trial" | "journal" | "ledger" | "position" | "income";

export function ReportsPage() {
  const initial = currentYearRange();
  const [tab, setTab] = useState<Tab>("cash");
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDateFrom, setCompareDateFrom] = useState(previousYear(initial.dateFrom));
  const [compareDateTo, setCompareDateTo] = useState(previousYear(initial.dateTo));
  const [includeZeroBalances, setIncludeZeroBalances] = useState(false);
  const [taxStatus, setTaxStatus] = useState<"" | TaxSummaryStatus>("");
  const [costCenterId, setCostCenterId] = useState("");
  const [costCenterLabel, setCostCenterLabel] = useState("");
  const [journalDocumentType, setJournalDocumentType] = useState("");
  const [journalStatus, setJournalStatus] = useState("");
  const [journalAccountId, setJournalAccountId] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalPage, setJournalPage] = useState(1);
  const [statementSubjectType, setStatementSubjectType] = useState<AccountStatementSubjectType>("customer");
  const [statementSubjectId, setStatementSubjectId] = useState("");
  const [statementSubjectLabel, setStatementSubjectLabel] = useState("");
  const [statementPage, setStatementPage] = useState(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [applied, setApplied] = useState({ dateFrom: initial.dateFrom, dateTo: initial.dateTo, compareEnabled: false, compareDateFrom: previousYear(initial.dateFrom), compareDateTo: previousYear(initial.dateTo), includeZeroBalances: false, taxStatus: "" as "" | TaxSummaryStatus, costCenterId: "", journalDocumentType: "", journalStatus: "", journalAccountId: "", journalSearch: "", statementSubjectType: "customer" as AccountStatementSubjectType, statementSubjectId: "" });
  const [cashFlow, setCashFlow] = useState<IndirectCashFlowReport | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [taxSummary, setTaxSummary] = useState<TaxSummaryReport | null>(null);
  const [costCenterActivity, setCostCenterActivity] = useState<CostCenterActivityReport | null>(null);
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
      if (tab === "cash") setCashFlow(await api<IndirectCashFlowReport>(`/reports/cash-flow?${rangeQuery(applied)}`));
      if (tab === "tax") {
        const parameters = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo });
        if (applied.taxStatus) parameters.set("status", applied.taxStatus);
        setTaxSummary(await api<TaxSummaryReport>(`/reports/tax-summary?${parameters}`));
      }
      if (tab === "costCenters") {
        const parameters = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo });
        if (applied.costCenterId) parameters.set("costCenterId", applied.costCenterId);
        setCostCenterActivity(await api<CostCenterActivityReport>(`/reports/cost-centers?${parameters}`));
      }
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
      if (tab === "ledger" && applied.statementSubjectId) {
        const query = accountStatementQuery({ subjectType: applied.statementSubjectType, subjectId: applied.statementSubjectId, dateFrom: applied.dateFrom, dateTo: applied.dateTo, page: statementPage, pageSize: 25 });
        setLedger(await api<LedgerReport>(`/reports/ledger?${query}`));
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
  }, [accounts, applied, journalPage, statementPage, tab]);
  useEffect(() => { void load(); }, [load]);

  function applyFilters() { setJournalPage(1); setStatementPage(1); setApplied({ dateFrom, dateTo, compareEnabled, compareDateFrom, compareDateTo, includeZeroBalances, taxStatus, costCenterId, journalDocumentType, journalStatus, journalAccountId, journalSearch: journalSearch.trim(), statementSubjectType, statementSubjectId }); }
  function downloadTrialCsv() {
    if (!trial) return;
    const blob = new Blob(["\uFEFF", trialBalanceCsv(trial.data)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `trial-balance-${applied.dateFrom}-${applied.dateTo}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function openLedger(accountId: string, scopedCostCenterId?: string) {
    setLedgerLoading(true); setError("");
    try {
      const parameters = new URLSearchParams({ accountId, dateFrom: applied.dateFrom, dateTo: applied.dateTo, page: "1", pageSize: "100" });
      if (scopedCostCenterId) parameters.set("costCenterId", scopedCostCenterId);
      setLedger(await api<LedgerReport>(`/reports/ledger?${parameters}`));
    }
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
  async function exportAccountStatement(format: "csv" | "xlsx" | "pdf") {
    if (!applied.statementSubjectId) return;
    const query = accountStatementQuery({ subjectType: applied.statementSubjectType, subjectId: applied.statementSubjectId, dateFrom: applied.dateFrom, dateTo: applied.dateTo });
    await downloadFile(`/reports/ledger/${format}?${query}`, `account-statement-${applied.dateFrom}-${applied.dateTo}.${format}`);
  }
  async function exportCashFlow(format: "csv" | "xlsx" | "pdf") {
    await downloadFile(`/reports/cash-flow/export/${format}?${rangeQuery(applied)}`, `cash-flow-${applied.dateFrom}-${applied.dateTo}.${format}`);
  }
  async function exportTaxSummary(format: "csv" | "xlsx" | "pdf") {
    const parameters = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo });
    if (applied.taxStatus) parameters.set("status", applied.taxStatus);
    await downloadFile(`/reports/tax-summary/export/${format}?${parameters}`, `tax-summary-${applied.dateFrom}-${applied.dateTo}.${format}`);
  }
  async function exportCostCenterActivity(format: "csv" | "xlsx" | "pdf") {
    const parameters = new URLSearchParams({ dateFrom: applied.dateFrom, dateTo: applied.dateTo });
    if (applied.costCenterId) parameters.set("costCenterId", applied.costCenterId);
    await downloadFile(`/reports/cost-centers/export/${format}?${parameters}`, `cost-center-activity-${applied.dateFrom}-${applied.dateTo}.${format}`);
  }

  const comparisonInvalid = (tab === "position" || tab === "income") && compareEnabled && (!compareDateFrom || !compareDateTo || compareDateFrom > compareDateTo);
  const invalid = !dateFrom || !dateTo || dateFrom > dateTo || comparisonInvalid || (tab === "ledger" && !statementSubjectId);
  const hasData = tab === "cash" ? cashFlow : tab === "tax" ? taxSummary : tab === "costCenters" ? costCenterActivity : tab === "trial" ? trial : tab === "journal" ? journal : tab === "ledger" ? ledger : tab === "position" ? position : income;
  return <section className="workspace-page reports-page">
    <PageHeader kicker={t("pages.reports.003")} title={t("pages.reports.004")} description={t("pages.reports.005")} />
    <div className="section-tabs report-tabs" role="tablist">
      <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>{t("pages.reports.006")}</button>
      <button className={tab === "tax" ? "active" : ""} onClick={() => setTab("tax")}>{t("taxSummary.tab")}</button>
      <button className={tab === "costCenters" ? "active" : ""} onClick={() => setTab("costCenters")}>{t("costCenterActivity.tab")}</button>
      <button className={tab === "trial" ? "active" : ""} onClick={() => setTab("trial")}>{t("pages.reports.007")}</button>
      <button className={tab === "journal" ? "active" : ""} onClick={() => setTab("journal")}>{t("pages.reports.008")}</button>
      <button className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>{t("accountStatement.tab")}</button>
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
      {tab === "tax" && <label><span>{t("taxSummary.statusFilter")}</span><select value={taxStatus} onChange={(event) => setTaxStatus(event.target.value as "" | TaxSummaryStatus)}><option value="">{t("taxSummary.allLedger")}</option><option value="POSTED">{t("status.POSTED")}</option><option value="REVERSED">{t("status.REVERSED")}</option><option value="DRAFT">{t("status.DRAFT")}</option><option value="CANCELLED">{t("status.CANCELLED")}</option></select></label>}
      {tab === "costCenters" && <label className="cost-center-report-filter"><span>{t("costCenterActivity.filter")}</span><ReferenceCombobox<CostCenter> endpoint="/cost-centers" value={costCenterId} selectedLabel={costCenterLabel} onChange={(value) => { setCostCenterId(value?.id ?? ""); setCostCenterLabel(value ? `${value.code} — ${localizedReferenceName(value)}` : ""); }} optionLabel={(value) => `${value.code} — ${localizedReferenceName(value)}`} placeholder={t("costCenterActivity.allCenters")} searchLabel={t("costCenterActivity.filter")} optionalLabel={t("costCenterActivity.allCenters")} /></label>}
      {tab === "journal" && <>
        <label><span>{t("pages.purchase-invoices.023")}</span><select value={journalDocumentType} onChange={(event) => setJournalDocumentType(event.target.value)}><option value="">{t("pages.reports.020")}</option><option value="MANUAL_JOURNAL">{t("pages.reports.021")}</option><option value="INVENTORY_ADJUSTMENT">{t("pages.reports.025")}</option><option value="RECEIPT">{t("pages.reports.022")}</option><option value="PAYMENT">{t("pages.reports.023")}</option><option value="SALES_INVOICE">{t("pages.sales-invoices.025")}</option><option value="SALES_CREDIT_NOTE">{t("pages.sales-invoices.015")}</option><option value="PURCHASE_INVOICE">{t("pages.purchase-invoices.025")}</option><option value="PURCHASE_DEBIT_NOTE">{t("pages.purchase-invoices.015")}</option><option value="PERIOD_CLOSE">{t("pages.reports.024")}</option></select></label>
        <label><span>{t("pages.accounts.043")}</span><select value={journalStatus} onChange={(event) => setJournalStatus(event.target.value)}><option value="">{t("pages.reports.026")}</option><option value="POSTED">{t("pages.dashboard.045")}</option><option value="REVERSED">{t("pages.dashboard.047")}</option></select></label>
        <label><span>{t("pages.accounts.039")}</span><select value={journalAccountId} onChange={(event) => setJournalAccountId(event.target.value)}><option value="">{t("pages.reports.030")}</option>{accounts.filter((account) => account.allowsPosting).map((account) => <option key={account.id} value={account.id}>{account.code} - {localizedReferenceName(account)}</option>)}</select></label>
        <label><span>{t("pages.accounts.026")}</span><input value={journalSearch} onChange={(event) => setJournalSearch(event.target.value)} placeholder={t("pages.reports.032")} /></label>
      </>}
      {tab === "ledger" && <>
        <label><span>{t("accountStatement.subjectType")}</span><select value={statementSubjectType} onChange={(event) => { setStatementSubjectType(event.target.value as AccountStatementSubjectType); setStatementSubjectId(""); setStatementSubjectLabel(""); setLedger(null); }}><option value="customer">{t("accountStatement.customer")}</option><option value="supplier">{t("accountStatement.supplier")}</option><option value="account">{t("accountStatement.ledgerAccount")}</option></select></label>
        <label className="account-statement-subject"><span>{t("accountStatement.subject")}</span>
          {statementSubjectType === "customer" ? <ReferenceCombobox<Customer> endpoint="/customers" value={statementSubjectId} selectedLabel={statementSubjectLabel} onChange={(value) => { setStatementSubjectId(value?.id ?? ""); setStatementSubjectLabel(value ? `${value.code} — ${localizedReferenceName(value)}` : ""); }} optionLabel={(value) => `${value.code} — ${localizedReferenceName(value)}`} placeholder={t("accountStatement.selectCustomer")} searchLabel={t("pages.customers.015")} required />
            : statementSubjectType === "supplier" ? <ReferenceCombobox<Supplier> endpoint="/suppliers" value={statementSubjectId} selectedLabel={statementSubjectLabel} onChange={(value) => { setStatementSubjectId(value?.id ?? ""); setStatementSubjectLabel(value ? `${value.code} — ${localizedReferenceName(value)}` : ""); }} optionLabel={(value) => `${value.code} — ${localizedReferenceName(value)}`} placeholder={t("accountStatement.selectSupplier")} searchLabel={t("pages.suppliers.014")} required />
              : <ReferenceCombobox<Account> endpoint="/accounts?allowsPosting=true" value={statementSubjectId} selectedLabel={statementSubjectLabel} onChange={(value) => { setStatementSubjectId(value?.id ?? ""); setStatementSubjectLabel(value ? `${value.code} — ${localizedReferenceName(value)}` : ""); }} optionLabel={(value) => `${value.code} — ${localizedReferenceName(value)}`} placeholder={t("accountStatement.selectAccount")} searchLabel={t("pages.accounts.025")} required />}
        </label>
      </>}
      <Button disabled={invalid} onClick={applyFilters}>{t("pages.purchase-invoices.114")}</Button>
    </div>
    {loading && !hasData ? <Spinner label={t("pages.reports.034")} /> : error && !hasData ? <div className="error-panel" role="alert"><h3>{t("pages.reports.035")}</h3><p>{error}</p><Button onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : <>
      {error && <div className="inline-notice">{error}</div>}
      {tab === "cash" && <CashFlowView report={cashFlow} onExport={(format) => void exportCashFlow(format)} onConfigure={() => setMappingOpen(true)} onLedger={(id) => void openLedger(id)} />}
      {tab === "tax" && <TaxSummaryView report={taxSummary} onExport={(format) => void exportTaxSummary(format)} />}
      {tab === "costCenters" && <CostCenterActivityView report={costCenterActivity} onExport={(format) => void exportCostCenterActivity(format)} onLedger={(accountId, centerId) => void openLedger(accountId, centerId)} />}
      {tab === "trial" && <TrialBalanceView report={trial} onDownload={downloadTrialCsv} />}
      {tab === "journal" && <JournalReportView report={journal} onExport={() => void exportJournal()} onPageChange={setJournalPage} />}
      {tab === "ledger" && (ledger ? <LedgerView report={ledger} onExport={(format) => void exportAccountStatement(format)} onPageChange={setStatementPage} /> : <EmptyState title={t("accountStatement.emptyTitle")} description={t("accountStatement.emptyDescription")} />)}
      {tab === "position" && position && <FinancialPositionView report={position} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {tab === "income" && income && <IncomeStatementView report={income} onLedger={(id) => void openLedger(id)} onExport={(format) => void exportReport(format)} />}
      {ledgerLoading && <Spinner label={t("pages.reports.037")} />}
      {tab !== "ledger" && ledger && <LedgerView report={ledger} onClose={() => setLedger(null)} />}
    </>}
    {mappingOpen && <CashFlowMappingModal onClose={() => setMappingOpen(false)} onChanged={() => void load()} />}
  </section>;
}

function CashFlowView({ report, onExport, onConfigure, onLedger }: { report: IndirectCashFlowReport | null; onExport: (format: "csv" | "xlsx" | "pdf") => void; onConfigure: () => void; onLedger: (id: string) => void }) {
  if (!report) return null;
  return <>
    <div className="metric-grid statement-metrics cash-flow-metrics"><Metric label={t("cashFlow.openingCash")} value={report.cash.opening} /><Metric label={t("cashFlow.netChange")} value={report.cash.netChange} tone={moneyTone(report.cash.netChange)} /><Metric label={t("cashFlow.closingCash")} value={report.cash.closing} /><Metric label={t("cashFlow.difference")} value={report.cash.difference} tone={report.cash.reconciled ? "positive" : "negative"} /></div>
    <article className="panel report-section cash-flow-report"><header><div><h2>{t("cashFlow.title")}</h2><p>{t("cashFlow.description")}</p></div><div className="report-export-actions"><Button variant="secondary" onClick={onConfigure}>{t("cashFlow.configure")}</Button><ExportActions onExport={onExport} /></div></header>
      <div className={`cash-flow-reconciliation ${report.cash.reconciled ? "ready" : "blocked"}`}><strong>{report.cash.reconciled ? t("cashFlow.reconciled") : t("cashFlow.notReconciled")}</strong><span>{t("cashFlow.difference")}: {formatMoney(report.cash.difference)} {report.baseCurrency.code}</span></div>
      {report.mapping.cashAccountCount === 0 && <div className="inline-notice" role="alert">{t("cashFlow.noCashAccounts")}</div>}
      {report.mapping.unmappedAccounts.length > 0 && <div className="inline-notice" role="alert">{t("cashFlow.mappingIncomplete", { value1: report.mapping.unmappedAccounts.length })}</div>}
      <CashFlowSection title={t("cashFlow.operating")} rows={[{ accountId: "NET-INCOME", code: "", nameAr: t("cashFlow.netIncome"), nameEn: null, amount: report.sections.operating.netIncome }, ...report.sections.operating.adjustments, ...report.sections.operating.workingCapital]} totalLabel={t("cashFlow.operatingTotal")} total={report.sections.operating.total} onLedger={onLedger} />
      <CashFlowSection title={t("cashFlow.investing")} rows={report.sections.investing.rows} totalLabel={t("cashFlow.investingTotal")} total={report.sections.investing.total} onLedger={onLedger} />
      <CashFlowSection title={t("cashFlow.financing")} rows={report.sections.financing.rows} totalLabel={t("cashFlow.financingTotal")} total={report.sections.financing.total} onLedger={onLedger} />
    </article>
  </>;
}

function TaxSummaryView({ report, onExport }: { report: TaxSummaryReport | null; onExport: (format: "csv" | "xlsx" | "pdf") => void }) {
  if (!report) return null;
  return <>
    <div className="metric-grid statement-metrics tax-summary-metrics"><Metric label={t("taxSummary.outputTax")} value={report.totals.outputTax} tone={moneyTone(report.totals.outputTax)} /><Metric label={t("taxSummary.inputTax")} value={report.totals.inputTax} tone={moneyTone(report.totals.inputTax)} /><Metric label={t("taxSummary.netTaxDue")} value={report.totals.netTaxDue} tone={moneyTone(report.totals.netTaxDue)} /><article className="metric-card"><span>{t("taxSummary.documents")}</span><strong>{report.totals.documentCount}</strong><small>{t("taxSummary.documents")}</small></article></div>
    <article className="panel report-section tax-summary-report"><header><div><h2>{t("taxSummary.title")}</h2><p>{t("taxSummary.description")}</p></div><ExportActions onExport={onExport} /></header>
      <div className="tax-summary-basis"><strong>{report.filter.basis === "LEDGER" ? t("taxSummary.ledgerBasis") : `${t("taxSummary.statusFilter")}: ${taxStatusLabel(report.filter.status!)}`}</strong><span>{t("taxSummary.jurisdictionNotice")}</span></div>
      {report.rows.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("taxSummary.title")}><table className="data-table tax-summary-table"><thead><tr><th>{t("taxSummary.usage")}</th><th>{t("taxSummary.documentType")}</th><th>{t("taxSummary.status")}</th><th>{t("taxSummary.taxRate")}</th><th>{t("taxSummary.rate")}</th><th>{t("taxSummary.documents")}</th><th>{t("taxSummary.taxableBase")}</th><th>{t("taxSummary.taxBase")}</th></tr></thead><tbody>{report.rows.map((row) => <tr key={`${row.usage}-${row.documentType}-${row.status}-${row.taxRateId ?? "none"}-${row.rate}`}><td><span className={`status-badge tax-${row.usage.toLowerCase()}`}>{taxUsageLabel(row.usage)}</span></td><td>{taxDocumentTypeLabel(row.documentType)}</td><td>{taxStatusLabel(row.status)}</td><td>{row.taxCode ? <><span className="code-pill">{row.taxCode}</span>{row.taxNameAr}</> : t("taxSummary.noTax")}</td><td className="money-cell">{formatMoney(row.rate)}%</td><td>{row.documentCount}</td><td className={`money-cell ${moneyTone(row.taxableBase)}-text`}>{formatMoney(row.taxableBase)}</td><td className={`money-cell ${moneyTone(row.taxBase)}-text`}>{formatMoney(row.taxBase)}</td></tr>)}</tbody></table></div> : <EmptyState title={t("taxSummary.title")} description={t("taxSummary.empty")} />}
    </article>
  </>;
}

function CostCenterActivityView({ report, onExport, onLedger }: { report: CostCenterActivityReport | null; onExport: (format: "csv" | "xlsx" | "pdf") => void; onLedger: (accountId: string, costCenterId: string) => void }) {
  if (!report) return null;
  return <>
    <div className="metric-grid statement-metrics cost-center-activity-metrics">
      <article className="metric-card"><span>{t("costCenterActivity.centers")}</span><strong>{report.totals.costCenterCount.toLocaleString(activeIntlLocale())}</strong><small>{t("costCenterActivity.actualOnly")}</small></article>
      <article className="metric-card"><span>{t("costCenterActivity.movementLines")}</span><strong>{report.totals.movementLineCount.toLocaleString(activeIntlLocale())}</strong><small>{t("costCenterActivity.accountsCount", { value1: report.totals.accountCount })}</small></article>
      <Metric label={t("costCenterActivity.debit")} value={report.totals.debit} />
      <Metric label={t("costCenterActivity.credit")} value={report.totals.credit} />
    </div>
    <article className="panel report-section cost-center-activity-report"><header><div><h2>{t("costCenterActivity.title")}</h2><p>{t("costCenterActivity.description")}</p></div><ExportActions onExport={onExport} /></header>
      <div className="cost-center-activity-basis"><strong>{t("costCenterActivity.ledgerBasis")}</strong><span>{t("costCenterActivity.periodNet")}: {formatMoney(report.totals.net)} {report.baseCurrency.code}</span></div>
      {report.data.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("costCenterActivity.title")}><table className="data-table cost-center-activity-table"><thead><tr><th>{t("costCenterActivity.account")}</th><th>{t("costCenterActivity.movementLines")}</th><th>{t("costCenterActivity.debit")}</th><th>{t("costCenterActivity.credit")}</th><th>{t("costCenterActivity.net")}</th></tr></thead><tbody>{report.data.map((center) => <Fragment key={center.costCenter.id}><tr className="statement-section-row"><th colSpan={5}><span className="code-pill">{center.costCenter.code}</span>{localizedReferenceName(center.costCenter)}</th></tr>{center.accounts.map((account) => <tr key={`${center.costCenter.id}-${account.accountId}`}><td><button className="account-drilldown" title={t("costCenterActivity.openLedger")} onClick={() => onLedger(account.accountId, center.costCenter.id)}><span className="code-pill">{account.code}</span>{localizedReferenceName(account)}</button></td><td>{account.movementLineCount.toLocaleString(activeIntlLocale())}</td><td className="money-cell">{formatMoney(account.debit)}</td><td className="money-cell">{formatMoney(account.credit)}</td><td className={`money-cell ${moneyTone(account.net)}-text`}>{formatMoney(account.net)}</td></tr>)}<tr className="statement-total-row"><th>{t("costCenterActivity.centerTotal")}</th><th>{center.totals.movementLineCount.toLocaleString(activeIntlLocale())}</th><th>{formatMoney(center.totals.debit)}</th><th>{formatMoney(center.totals.credit)}</th><th>{formatMoney(center.totals.net)}</th></tr></Fragment>)}</tbody><tfoot><tr><th>{t("costCenterActivity.periodTotal")}</th><th>{report.totals.movementLineCount.toLocaleString(activeIntlLocale())}</th><th>{formatMoney(report.totals.debit)}</th><th>{formatMoney(report.totals.credit)}</th><th>{formatMoney(report.totals.net)}</th></tr></tfoot></table></div> : <EmptyState title={t("costCenterActivity.emptyTitle")} description={t("costCenterActivity.emptyDescription")} />}
    </article>
  </>;
}

const taxUsageLabel = (value: TaxSummaryReport["rows"][number]["usage"]) => value === "OUTPUT" ? t("taxSummary.usage.OUTPUT") : t("taxSummary.usage.INPUT");
const taxStatusLabel = (value: TaxSummaryStatus) => ({ POSTED: t("status.POSTED"), REVERSED: t("status.REVERSED"), DRAFT: t("status.DRAFT"), CANCELLED: t("status.CANCELLED") }[value]);
const taxDocumentTypeLabel = (value: TaxSummaryReport["rows"][number]["documentType"]) => ({ SALES_INVOICE: t("taxSummary.documentType.SALES_INVOICE"), SALES_CREDIT_NOTE: t("taxSummary.documentType.SALES_CREDIT_NOTE"), PURCHASE_INVOICE: t("taxSummary.documentType.PURCHASE_INVOICE"), PURCHASE_DEBIT_NOTE: t("taxSummary.documentType.PURCHASE_DEBIT_NOTE") }[value]);

function CashFlowSection({ title, rows, totalLabel, total, onLedger }: { title: string; rows: CashFlowReportLine[]; totalLabel: string; total: string; onLedger: (id: string) => void }) {
  return <section className="cash-flow-section"><h3>{title}</h3>{rows.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={title}><table className="data-table"><thead><tr><th>{t("cashFlow.account")}</th><th>{t("pages.reports.084")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.accountId}><td>{row.accountId === "NET-INCOME" ? <strong>{row.nameAr}</strong> : <button className="account-drilldown" onClick={() => onLedger(row.accountId)}><span className="code-pill">{row.code}</span>{localizedReferenceName(row)}</button>}</td><td className={`money-cell ${moneyTone(row.amount)}-text`}>{formatMoney(row.amount)}</td></tr>)}</tbody><tfoot><tr className="statement-total-row"><th>{totalLabel}</th><th>{formatMoney(total)}</th></tr></tfoot></table></div> : <EmptyState title={title} description={t("cashFlow.emptySection")} />}</section>;
}

function CashFlowMappingModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<CashFlowMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CashFlowMappingClassification>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => { void api<{ data: CashFlowMapping[] }>("/reports/cash-flow/mappings").then((result) => setRows(result.data)).catch((cause) => setError(cause instanceof Error ? cause.message : t("pages.reports.001"))).finally(() => setLoading(false)); }, []);
  async function save(row: CashFlowMapping) {
    const classification = drafts[row.accountId] ?? (row.classification === "CASH_AND_CASH_EQUIVALENTS" || row.classification == null ? undefined : row.classification);
    if (!classification) return;
    setSavingId(row.accountId); setError(""); setSuccess("");
    try {
      const saved = await api<CashFlowMapping>(`/reports/cash-flow/mappings/${row.accountId}`, { method: "PUT", body: JSON.stringify({ classification, version: row.version }) });
      setRows((current) => current.map((item) => item.accountId === saved.accountId ? saved : item));
      setDrafts((current) => { const next = { ...current }; delete next[row.accountId]; return next; });
      setSuccess(t("cashFlow.saved")); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.reports.001")); }
    finally { setSavingId(""); }
  }
  return <Modal title={t("cashFlow.mappingTitle")} description={t("cashFlow.mappingDescription")} onClose={onClose} wide>{loading ? <Spinner /> : <>{error && <div className="form-error" role="alert">{error}</div>}{success && <div className="inline-notice neutral">{success}</div>}<div className="data-table-wrap cash-flow-mapping-table" role="region" tabIndex={0} aria-label={t("cashFlow.mappingTitle")}><table className="data-table"><thead><tr><th>{t("cashFlow.account")}</th><th>{t("cashFlow.classification")}</th><th>{t("cashFlow.source")}</th><th>{t("pages.accounts.047")}</th></tr></thead><tbody>{rows.map((row) => { const options = mappingOptions(row); const value = drafts[row.accountId] ?? row.classification ?? options[0]!; return <tr key={row.accountId}><td><span className="code-pill">{row.code}</span>{localizedReferenceName(row)}</td><td><select aria-label={`${t("cashFlow.classification")}: ${localizedReferenceName(row)}`} value={value} disabled={!row.editable || savingId === row.accountId} onChange={(event) => setDrafts((current) => ({ ...current, [row.accountId]: event.target.value as CashFlowMappingClassification }))}>{row.classification === "CASH_AND_CASH_EQUIVALENTS" && <option value="CASH_AND_CASH_EQUIVALENTS">{classificationLabel("CASH_AND_CASH_EQUIVALENTS")}</option>}{options.map((classification) => <option key={classification} value={classification}>{classificationLabel(classification)}</option>)}</select></td><td>{sourceLabel(row.source)}</td><td><Button variant="secondary" disabled={!row.editable || !drafts[row.accountId] || savingId === row.accountId} onClick={() => void save(row)}>{savingId === row.accountId ? t("cashFlow.saving") : t("cashFlow.save")}</Button></td></tr>; })}</tbody></table></div></>}</Modal>;
}

const mappingOptions = (row: CashFlowMapping): CashFlowMappingClassification[] => row.accountClass === "REVENUE" || row.accountClass === "EXPENSE" ? ["NET_INCOME", "OPERATING_ADJUSTMENT"] : ["OPERATING_WORKING_CAPITAL", "INVESTING", "FINANCING", "EXCLUDED"];
const classificationLabel = (value: CashFlowMapping["classification"] | "UNMAPPED") => ({ CASH_AND_CASH_EQUIVALENTS: t("cashFlow.classifications.CASH_AND_CASH_EQUIVALENTS"), NET_INCOME: t("cashFlow.classifications.NET_INCOME"), OPERATING_ADJUSTMENT: t("cashFlow.classifications.OPERATING_ADJUSTMENT"), OPERATING_WORKING_CAPITAL: t("cashFlow.classifications.OPERATING_WORKING_CAPITAL"), INVESTING: t("cashFlow.classifications.INVESTING"), FINANCING: t("cashFlow.classifications.FINANCING"), EXCLUDED: t("cashFlow.classifications.EXCLUDED"), UNMAPPED: t("cashFlow.classifications.UNMAPPED") }[value ?? "UNMAPPED"]);
const sourceLabel = (value: CashFlowMapping["source"]) => ({ TREASURY: t("cashFlow.sources.TREASURY"), EXPLICIT: t("cashFlow.sources.EXPLICIT"), TEMPLATE: t("cashFlow.sources.TEMPLATE"), SYSTEM: t("cashFlow.sources.SYSTEM"), UNMAPPED: t("cashFlow.sources.UNMAPPED") }[value]);
const moneyTone = (value: string) => value.startsWith("-") ? "negative" : "positive";
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
function LedgerView({ report, onClose, onExport, onPageChange }: { report: LedgerReport; onClose?: () => void; onExport?: (format: "csv" | "xlsx" | "pdf") => void; onPageChange?: (page: number) => void }) {
  return <article className="panel report-section ledger-panel"><header><div><h2>{t("pages.reports.089")}{localizedReferenceName(report.subject)}</h2><p>{report.subject.code}{report.costCenter ? ` · ${t("costCenterActivity.center")}: ${report.costCenter.code} — ${localizedReferenceName(report.costCenter)}` : ""}{t("pages.reports.090")}{report.range.dateFrom}{t("pages.payments.051")}{report.range.dateTo}{t("accountStatement.currency", { value1: report.baseCurrency.code })}</p></div>{onExport ? <ExportActions onExport={onExport} /> : onClose ? <Button variant="secondary" onClick={onClose}>{t("pages.audit-logs.037")}</Button> : null}</header><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.dashboard.037")}</th><th>{t("pages.purchase-invoices.037")}</th><th>{t("pages.manual-journals.032")}</th><th>{t("pages.manual-journals.060")}</th><th>{t("pages.manual-journals.061")}</th><th>{t("pages.reports.092")}</th><th>{t("pages.reports.093")}</th></tr></thead><tbody><tr className="statement-total-row"><td colSpan={3}>{t("pages.reports.094")}</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td><td>{formatMoney(report.openingDebit)}</td><td>{formatMoney(report.openingCredit)}</td></tr>{report.data.map((row) => <tr key={row.id}><td>{row.date}</td><td><span className="code-pill">{row.documentNumber}</span></td><td>{row.description}</td><td className="money-cell">{formatMoney(row.debit)}</td><td className="money-cell">{formatMoney(row.credit)}</td><td className="money-cell">{formatMoney(row.runningDebit)}</td><td className="money-cell">{formatMoney(row.runningCredit)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>{t("pages.reports.095")}</th><th>{formatMoney(report.closingDebit)}</th><th>{formatMoney(report.closingCredit)}</th></tr></tfoot></table></div>{onPageChange && <Pagination {...report.meta} page={report.meta.page} onChange={onPageChange} />}</article>;
}
function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{formatMoney(value)}</strong><small>{t("pages.reports.096")}</small></article>; }
function ExportActions({ onExport }: { onExport: (format: "csv" | "xlsx" | "pdf") => void }) { return <div className="report-export-actions"><Button variant="secondary" onClick={() => onExport("csv")}>CSV</Button><Button variant="secondary" onClick={() => onExport("xlsx")}>Excel</Button><Button variant="secondary" onClick={() => onExport("pdf")}>PDF</Button></div>; }
const classLabel = (value: string) => ({ ASSET: t("pages.reports.097"), LIABILITY: t("pages.reports.098"), EQUITY: t("pages.reports.099"), REVENUE: t("pages.reports.100"), EXPENSE: t("pages.reports.101") }[value] ?? value);
const documentTypeLabel = (value: string) => ({ MANUAL_JOURNAL: t("pages.reports.021"), INVENTORY_ADJUSTMENT: t("pages.reports.025"), RECEIPT: t("pages.reports.022"), PAYMENT: t("pages.reports.023"), SALES_INVOICE: t("pages.sales-invoices.025"), SALES_CREDIT_NOTE: t("pages.sales-invoices.015"), PURCHASE_INVOICE: t("pages.purchase-invoices.025"), PURCHASE_DEBIT_NOTE: t("pages.purchase-invoices.015"), PERIOD_CLOSE: t("pages.reports.024") }[value] ?? value);
const previousYear = (value: string) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
const rangeQuery = (value: { dateFrom: string; dateTo: string }) => new URLSearchParams({ dateFrom: value.dateFrom, dateTo: value.dateTo });
