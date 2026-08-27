import { useCallback, useEffect, useState } from "react";
import { api, idempotencyKey } from "./api";
import { activeIntlLocale, translate as t } from "./i18n";
import type { ApprovalRequest, ListResponse } from "./types";
import { Button, EmptyState, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type ApprovalStatus = ApprovalRequest["status"] | "";

export function ApprovalsPage({ notify }: { notify: Notice }) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ApprovalStatus>("PENDING");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (status) query.set("status", status);
      const result = await api<ListResponse<ApprovalRequest>>(`/approval-requests?${query}`);
      setRequests(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("approvals.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(request: ApprovalRequest, decision: "approve" | "reject") {
    let reason: string | undefined;
    if (decision === "approve") {
      if (!window.confirm(t("approvals.approveConfirm"))) return;
    } else {
      reason = window.prompt(t("approvals.rejectPrompt"))?.trim();
      if (!reason || reason.length < 10) {
        notify(t("approvals.reasonRequired"), "error");
        return;
      }
    }
    setWorking(request.id);
    try {
      await api(`/approval-requests/${request.id}/${decision}`, {
        method: "POST",
        idempotencyKey: idempotencyKey(`approval-${decision}`, request.id),
        body: JSON.stringify({ version: request.version, ...(reason ? { reason } : {}) }),
      });
      notify(t(decision === "approve" ? "approvals.approveSuccess" : "approvals.rejectSuccess"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("approvals.actionError"), "error");
      await load();
    } finally {
      setWorking("");
    }
  }

  return <section className="workspace-page">
    <PageHeader kicker={t("approvals.kicker")} title={t("approvals.title")} description={t("approvals.description")} />
    <div className="toolbar approvals-toolbar">
      <label><span>{t("approvals.statusFilter")}</span><select value={status} onChange={(event) => { setStatus(event.target.value as ApprovalStatus); setPage(1); }}>
        <option value="PENDING">{t("approvals.status.PENDING")}</option>
        <option value="APPROVED">{t("approvals.status.APPROVED")}</option>
        <option value="REJECTED">{t("approvals.status.REJECTED")}</option>
        <option value="CANCELLED">{t("approvals.status.CANCELLED")}</option>
        <option value="">{t("approvals.status.ALL")}</option>
      </select></label>
    </div>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("common.retry")}</Button></div>
      : loading ? <Spinner label={t("approvals.loading")} />
      : requests.length === 0 ? <EmptyState title={t("approvals.emptyTitle")} description={t("approvals.emptyDescription")} />
      : <>
        <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
          <table className="data-table approvals-table">
            <thead><tr><th>{t("approvals.subject")}</th><th>{t("approvals.requestedBy")}</th><th>{t("approvals.requestedAt")}</th><th>{t("approvals.statusLabel")}</th><th>{t("approvals.decision")}</th><th>{t("approvals.actions")}</th></tr></thead>
            <tbody>{requests.map((request) => <tr key={request.id}>
              <td><strong>{t("approvals.subject.FINANCIAL_CLOSE_RUN")}</strong><small className="approval-reference">{request.subjectId}</small></td>
              <td>{request.requestedBy.displayName}<small>{request.makerCheckerRequired ? t("approvals.separationRequired") : ""}</small></td>
              <td>{new Date(request.createdAt).toLocaleString(activeIntlLocale())}</td>
              <td><span className={`status-chip ${request.status.toLowerCase()}`}>{t(`approvals.status.${request.status}`)}</span></td>
              <td>{request.decision ? <><strong>{request.decision.actor.displayName}</strong><small>{request.decision.reason ?? t("approvals.noReason")}</small></> : <span>{t("approvals.pendingDecision")}</span>}</td>
              <td className="row-actions">{request.status === "PENDING" ? <>
                <Button disabled={working === request.id} onClick={() => void decide(request, "approve")}>{t("approvals.approve")}</Button>
                <Button variant="danger" disabled={working === request.id} onClick={() => void decide(request, "reject")}>{t("approvals.reject")}</Button>
              </> : <span>—</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination {...meta} page={page} onChange={setPage} />
      </>}
  </section>;
}
