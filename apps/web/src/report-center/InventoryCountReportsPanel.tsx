import { useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { localizedCopyFor, useI18n } from "../i18n";
import { reportCenterCopy } from "../i18n/locales/report-center";
import { Button, Spinner } from "../ui";
import "./report-center.css";

type Session = { id: string; countDate: string; status: "DRAFT" | "SUBMITTED" | "APPROVED" | "SETTLED"; approvedByName: string | null };
type SessionList = { data: Session[]; meta: { total: number; totalPages: number } };

export function InventoryCountReportsPanel({ canExportExcel = false }: { canExportExcel?: boolean }) {
  const { locale } = useI18n();
  const labels = localizedCopyFor(reportCenterCopy, locale, "ar");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<SessionList>(`/reports/inventory-counts?page=${page}&pageSize=25`);
      setSessions(result.data);
      setTotalPages(Math.max(1, result.meta.totalPages));
    } catch (cause) { setError(cause instanceof Error ? cause.message : labels.error); }
    finally { setLoading(false); }
  }, [labels.error, page]);
  useEffect(() => { void load(); }, [load]);

  async function download(sessionId: string, format: "pdf" | "xlsx") {
    setBusyId(sessionId); setError("");
    try {
      const path = format === "pdf" ? `/reports/inventory-counts/${sessionId}/pdf` : `/inventory-count-sessions/${sessionId}/report.xlsx`;
      await downloadFile(path, `inventory-count-${sessionId}.${format}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : labels.error); }
    finally { setBusyId(""); }
  }

  return <section className="panel report-center-counts" aria-labelledby="report-center-counts-title">
    <header><div><h2 id="report-center-counts-title">{labels.countTitle}</h2><p>{labels.countDescription}</p></div></header>
    {error && <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{labels.retry}</Button></div>}
    {loading ? <Spinner label={labels.loading} /> : sessions.length === 0 ? <p className="report-center-empty">{labels.empty}</p> : <>
      <div className="report-center-records" role="list">
        {sessions.map((session) => {
          const status = { DRAFT: labels.draft, SUBMITTED: labels.submitted, APPROVED: labels.approved, SETTLED: labels.settled }[session.status];
          return <article className="report-center-record" role="listitem" key={session.id}>
            <div className="report-center-record-main"><strong>{labels.session} #{session.id}</strong><span>{labels.date}: <bdi dir="ltr">{session.countDate}</bdi></span><span>{labels.status}: {status}</span><span>{labels.approver}: {session.approvedByName ?? labels.notApproved}</span></div>
            <div className="report-center-record-actions" aria-label={labels.actions}>
              <a className="button secondary" href={`/api/v1/reports/inventory-counts/${session.id}/pdf`} target="_blank" rel="noopener noreferrer">{labels.preview}</a>
              <Button variant="secondary" disabled={busyId === session.id} onClick={() => void download(session.id, "pdf")}>{labels.pdf}</Button>
              {canExportExcel && <Button variant="secondary" disabled={busyId === session.id} onClick={() => void download(session.id, "xlsx")}>{labels.excel}</Button>}
            </div>
          </article>;
        })}
      </div>
      <div className="report-center-pagination"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{labels.previous}</Button><span>{labels.page} {page} {labels.of} {totalPages}</span><Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{labels.next}</Button></div>
    </>}
  </section>;
}
