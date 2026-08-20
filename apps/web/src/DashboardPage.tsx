import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { formatMoney } from "./domain";
import { currentYearRange, monthLabel } from "./reporting";
import type { DashboardReport } from "./types";
import { Button, EmptyState, Icon, Spinner } from "./ui";

export function DashboardPage({ onNavigate }: { onNavigate: (view: "customers" | "receipts" | "suppliers" | "payments" | "reports") => void }) {
  const initial = currentYearRange();
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [applied, setApplied] = useState(initial);
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(applied);
      setReport(await api<DashboardReport>(`/reports/dashboard?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل لوحة التحكم.");
    } finally {
      setLoading(false);
    }
  }, [applied]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !report) return <Spinner label="جارٍ إعداد المؤشرات المالية" />;
  if (error && !report) return <div className="error-panel"><h3>تعذر تحميل لوحة التحكم</h3><p>{error}</p><Button onClick={() => void load()}>إعادة المحاولة</Button></div>;
  if (!report) return null;
  const currency = report.baseCurrency.code;
  const maxMovement = Math.max(1, ...report.cashFlow.flatMap((item) => [Math.abs(Number(item.receipts)), Math.abs(Number(item.payments))]));
  const cards = [
    { label: "المقبوضات المرحّلة", value: formatMoney(report.metrics.receipts), suffix: currency, tone: "positive", icon: "arrowDown" as const },
    { label: "المدفوعات المرحّلة", value: formatMoney(report.metrics.payments), suffix: currency, tone: "negative", icon: "arrowUp" as const },
    { label: "صافي التدفق النقدي", value: formatMoney(report.metrics.netCashFlow), suffix: currency, tone: Number(report.metrics.netCashFlow) >= 0 ? "positive" : "negative", icon: "wallet" as const },
    { label: "مسودات تحتاج متابعة", value: report.metrics.draftDocuments.toLocaleString("ar-SA"), suffix: "سند", tone: "neutral", icon: "document" as const },
  ];
  return (
    <section className="workspace-page dashboard-page">
      <header className="page-heading">
        <div><span className="section-kicker">نظرة مالية فورية</span><h1>لوحة التحكم</h1><p>ملخص تنفيذي للحركة النقدية والأعمال التي تحتاج إلى متابعة.</p></div>
        <div className="period-filter">
          <label><span>من</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>إلى</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <Button disabled={!dateFrom || !dateTo || dateFrom > dateTo} onClick={() => setApplied({ dateFrom, dateTo })}>تحديث</Button>
        </div>
      </header>
      {error && <div className="inline-notice">تعذر تحديث البيانات، وتُعرض آخر نتيجة متاحة.</div>}
      <div className="metric-grid">
        {cards.map((card) => <article className={`metric-card ${card.tone}`} key={card.label}><div className="metric-icon"><Icon name={card.icon} /></div><span>{card.label}</span><strong>{card.value}</strong><small>{card.suffix}</small></article>)}
      </div>
      <div className="dashboard-grid">
        <article className="panel cashflow-panel">
          <header><div><h2>التدفق النقدي الشهري</h2><p>مقارنة المقبوضات والمدفوعات المرحّلة</p></div><button className="text-link strong" onClick={() => onNavigate("reports")}>عرض التقرير</button></header>
          {report.cashFlow.length ? <div className="cashflow-chart" role="img" aria-label="رسم التدفق النقدي الشهري">
            {report.cashFlow.map((item) => <div className="chart-month" key={item.month}><div className="bar-pair"><span className="bar receipt" style={{ height: `${Math.max(4, Math.abs(Number(item.receipts)) / maxMovement * 100)}%` }} title={`مقبوضات ${formatMoney(item.receipts)}`} /><span className="bar payment" style={{ height: `${Math.max(4, Math.abs(Number(item.payments)) / maxMovement * 100)}%` }} title={`مدفوعات ${formatMoney(item.payments)}`} /></div><small>{monthLabel(item.month)}</small></div>)}
          </div> : <EmptyState title="لا توجد حركة نقدية" description="لم تُرحّل سندات قبض أو صرف ضمن الفترة المحددة." />}
          <div className="chart-legend"><span><i className="receipt" />المقبوضات</span><span><i className="payment" />المدفوعات</span></div>
        </article>
        <article className="panel overview-panel">
          <header><div><h2>نطاق العمل</h2><p>ملخص الأطراف والسندات الحالية</p></div></header>
          <button onClick={() => onNavigate("suppliers")}><span>الموردون النشطون</span><strong>{report.metrics.activeSuppliers.toLocaleString("ar-SA")}</strong><Icon name="back" /></button>
          <button onClick={() => onNavigate("customers")}><span>العملاء النشطون</span><strong>{report.metrics.activeCustomers.toLocaleString("ar-SA")}</strong><Icon name="back" /></button>
          <button onClick={() => onNavigate("payments")}><span>مسودات السندات</span><strong>{report.metrics.draftDocuments.toLocaleString("ar-SA")}</strong><Icon name="back" /></button>
        </article>
      </div>
      <article className="panel activity-panel">
        <header><div><h2>أحدث النشاطات</h2><p>آخر سندات القبض والصرف المسجلة</p></div></header>
        {report.recentActivity.length ? <div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>السند</th><th>النوع</th><th>الطرف</th><th>التاريخ</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>{report.recentActivity.map((item) => <tr key={`${item.type}-${item.id}`}><td><strong>{item.documentNumber}</strong><small>{item.description}</small></td><td>{item.type === "RECEIPT" ? "قبض" : "صرف"}</td><td>{item.counterpartyName}</td><td>{item.documentDate}</td><td><span className={`status-chip ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td><td className="money-cell">{formatMoney(item.amount)} {currency}</td></tr>)}</tbody></table></div> : <EmptyState title="لا توجد نشاطات بعد" description="ستظهر هنا أحدث السندات بمجرد إنشائها." />}
      </article>
    </section>
  );
}

const statusLabel = (status: string) => ({ DRAFT: "مسودة", POSTED: "مرحّل", CANCELLED: "ملغي", REVERSED: "معكوس" }[status] ?? status);
