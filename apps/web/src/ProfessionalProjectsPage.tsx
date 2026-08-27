import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, idempotencyKey } from "./api";
import { localizedReferenceName, useI18n } from "./i18n";
import type {
  ListResponse,
  ProfessionalCustomerOption,
  ProfessionalPerson,
  ProfessionalProject,
  ProfessionalProjectMember,
  ProfessionalProjectMemberRole,
  ProfessionalProjectStatus,
  ProfessionalTimeEntry,
  ProfessionalTimeEntryList,
} from "./types";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type ProjectDetail = { project: ProfessionalProject; members: ProfessionalProjectMember[] };
const today = () => new Date().toISOString().slice(0, 10);

export function ProfessionalProjectsPage({ notify }: { notify: Notice }) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProfessionalProject[]>([]);
  const [projectMeta, setProjectMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [projectPage, setProjectPage] = useState(1);
  const [status, setStatus] = useState<ProfessionalProjectStatus | "">("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [timeEntries, setTimeEntries] = useState<ProfessionalTimeEntry[]>([]);
  const [timeMeta, setTimeMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [timeSummary, setTimeSummary] = useState({ trackedMinutes: 0, billableMinutes: 0, nonBillableMinutes: 0 });
  const [timePage, setTimePage] = useState(1);
  const [customers, setCustomers] = useState<ProfessionalCustomerOption[]>([]);
  const [people, setPeople] = useState<ProfessionalPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(projectPage), pageSize: "10" });
      if (status) query.set("status", status);
      const result = await api<ListResponse<ProfessionalProject>>(`/professional-projects?${query}`);
      setProjects(result.data);
      setProjectMeta(result.meta);
      setSelectedId((current) => result.data.some((project) => project.id === current) ? current : result.data[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("professional.loadError"));
    } finally {
      setLoading(false);
    }
  }, [projectPage, status, t]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api<ProjectDetail>(`/professional-projects/${selectedId}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.detailError"), "error");
    }
  }, [notify, selectedId, t]);

  const loadTime = useCallback(async () => {
    if (!selectedId) {
      setTimeEntries([]);
      setTimeSummary({ trackedMinutes: 0, billableMinutes: 0, nonBillableMinutes: 0 });
      return;
    }
    try {
      const result = await api<ProfessionalTimeEntryList>(`/professional-time-entries?projectId=${selectedId}&page=${timePage}&pageSize=10`);
      setTimeEntries(result.data);
      setTimeMeta(result.meta);
      setTimeSummary(result.summary);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timeLoadError"), "error");
    }
  }, [notify, selectedId, t, timePage]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void Promise.all([loadDetail(), loadTime()]); }, [loadDetail, loadTime]);
  useEffect(() => {
    void Promise.all([
      api<{ data: ProfessionalCustomerOption[] }>("/professional-projects/customer-options"),
      api<{ data: ProfessionalPerson[] }>("/professional-projects/member-options"),
    ]).then(([customerResult, peopleResult]) => {
      setCustomers(customerResult.data);
      setPeople(peopleResult.data);
    }).catch((cause) => notify(cause instanceof Error ? cause.message : t("professional.optionsError"), "error"));
  }, [notify, t]);

  const formatDuration = (minutes: number) => t("professional.duration", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });

  async function refreshAll() {
    await loadProjects();
    await Promise.all([loadDetail(), loadTime()]);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      const result = await api<{ project: ProfessionalProject }>("/professional-projects", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-project", crypto.randomUUID()),
        body: JSON.stringify({
          customerId: String(data.get("customerId") ?? ""),
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          kind: String(data.get("kind") ?? ""),
          billingModel: String(data.get("billingModel") ?? ""),
          startDate: String(data.get("startDate") ?? ""),
          targetEndDate: String(data.get("targetEndDate") ?? "") || null,
          description: String(data.get("description") ?? "").trim() || null,
        }),
      });
      setCreateOpen(false);
      setSelectedId(result.project.id);
      notify(t("professional.createSuccess"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.createError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function assignMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api(`/professional-projects/${detail.project.id}/members`, {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-member", crypto.randomUUID()),
        body: JSON.stringify({
          projectVersion: detail.project.version,
          userId: String(data.get("userId") ?? ""),
          role: String(data.get("role") ?? "PROFESSIONAL"),
        }),
      });
      notify(t("professional.memberAssigned"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.memberError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function unassign(member: ProfessionalProjectMember) {
    if (!detail) return;
    const reason = window.prompt(t("professional.unassignPrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/professional-projects/${detail.project.id}/members/${member.user.id}/unassign`, {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-unassign", crypto.randomUUID()),
        body: JSON.stringify({ projectVersion: detail.project.version, memberVersion: member.version, reason }),
      });
      notify(t("professional.memberUnassigned"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.memberError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function transition(next: ProfessionalProjectStatus) {
    if (!detail) return;
    const reason = window.prompt(t("professional.transitionPrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/professional-projects/${detail.project.id}/transition`, {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-transition", crypto.randomUUID()),
        body: JSON.stringify({ version: detail.project.version, status: next, reason }),
      });
      notify(t("professional.transitionSuccess"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.transitionError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function logTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking(true);
    try {
      await api("/professional-time-entries", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-time", crypto.randomUUID()),
        body: JSON.stringify({
          projectId: detail.project.id,
          workDate: String(data.get("workDate") ?? ""),
          minutes: Number(data.get("minutes")),
          isBillable: data.get("isBillable") === "on",
          description: String(data.get("description") ?? "").trim(),
        }),
      });
      form.reset();
      notify(t("professional.timeCreated"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timeError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function deleteTime(entry: ProfessionalTimeEntry) {
    const reason = window.prompt(t("professional.deleteTimePrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/professional-time-entries/${entry.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: entry.version, reason }),
      });
      notify(t("professional.timeDeleted"));
      await refreshAll();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timeError"), "error");
    } finally {
      setWorking(false);
    }
  }

  return <section className="workspace-page professional-workspace">
    <PageHeader
      kicker={t("professional.kicker")}
      title={t("professional.title")}
      description={t("professional.description")}
      actions={<Button icon="plus" onClick={() => setCreateOpen(true)}>{t("professional.newProject")}</Button>}
    />
    <div className="toolbar professional-toolbar">
      <label><span>{t("professional.statusFilter")}</span><select value={status} onChange={(event) => { setStatus(event.target.value as ProfessionalProjectStatus | ""); setProjectPage(1); }}>
        <option value="">{t("professional.status.ALL")}</option>
        {(["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const).map((value) => <option key={value} value={value}>{t(`professional.status.${value}`)}</option>)}
      </select></label>
    </div>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadProjects()}>{t("common.retry")}</Button></div>
      : loading ? <Spinner label={t("professional.loading")} />
      : projects.length === 0 ? <EmptyState title={t("professional.emptyTitle")} description={t("professional.emptyDescription")} action={<Button icon="plus" onClick={() => setCreateOpen(true)}>{t("professional.newProject")}</Button>} />
      : <div className="professional-layout">
        <article className="panel professional-project-list">
          <header><div><h2>{t("professional.projects")}</h2><p>{t("professional.projectsDescription")}</p></div></header>
          <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
            <table className="data-table"><thead><tr><th>{t("professional.project")}</th><th>{t("professional.customer")}</th><th>{t("professional.kindLabel")}</th><th>{t("professional.statusLabel")}</th><th>{t("professional.time")}</th></tr></thead>
              <tbody>{projects.map((project) => <tr key={project.id} className={selectedId === project.id ? "selected-row" : ""}>
                <td><button className="professional-project-select" type="button" onClick={() => { setSelectedId(project.id); setTimePage(1); }}><strong>{project.code}</strong><small>{localizedReferenceName(project)}</small></button></td>
                <td>{project.customer.code}<small>{localizedReferenceName(project.customer)}</small></td>
                <td>{t(`professional.kind.${project.kind}`)}</td>
                <td><span className={`status-chip ${project.status.toLowerCase()}`}>{t(`professional.status.${project.status}`)}</span></td>
                <td>{formatDuration(project.trackedMinutes)}<small>{t("professional.billableSummary", { duration: formatDuration(project.billableMinutes) })}</small></td>
              </tr>)}</tbody>
            </table>
          </div>
          <Pagination {...projectMeta} page={projectPage} onChange={setProjectPage} />
        </article>
        {detail && <aside className="panel professional-detail">
          <header><div><h2>{localizedReferenceName(detail.project)}</h2><p>{detail.project.code}</p></div><span className={`status-chip ${detail.project.status.toLowerCase()}`}>{t(`professional.status.${detail.project.status}`)}</span></header>
          <dl className="detail-list"><div><dt>{t("professional.billingModel")}</dt><dd>{t(`professional.billing.${detail.project.billingModel}`)}</dd></div><div><dt>{t("professional.startDate")}</dt><dd>{detail.project.startDate}</dd></div><div><dt>{t("professional.members")}</dt><dd>{detail.project.memberCount}</dd></div></dl>
          <div className="row-actions professional-transitions">
            {detail.project.status === "ACTIVE" && <><Button variant="secondary" disabled={working} onClick={() => void transition("ON_HOLD")}>{t("professional.hold")}</Button><Button disabled={working} onClick={() => void transition("COMPLETED")}>{t("professional.complete")}</Button><Button variant="danger" disabled={working} onClick={() => void transition("CANCELLED")}>{t("professional.cancelProject")}</Button></>}
            {detail.project.status === "ON_HOLD" && <><Button disabled={working} onClick={() => void transition("ACTIVE")}>{t("professional.activate")}</Button><Button variant="danger" disabled={working} onClick={() => void transition("CANCELLED")}>{t("professional.cancelProject")}</Button></>}
          </div>
          <h3>{t("professional.team")}</h3>
          <ul className="professional-members">{detail.members.map((member) => <li key={member.user.id}><div><strong>{member.user.displayName}</strong><span>{t(`professional.role.${member.role}`)}</span></div>{member.isActive ? <Button variant="ghost" disabled={working} onClick={() => void unassign(member)}>{t("professional.unassign")}</Button> : <span className="muted">{t("professional.unassigned")}</span>}</li>)}</ul>
          {(["ACTIVE", "ON_HOLD"] as ProfessionalProjectStatus[]).includes(detail.project.status) && <form className="compact-form professional-member-form" onSubmit={assignMember}>
            <label><span>{t("professional.person")}</span><select name="userId" required><option value="" />{people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
            <label><span>{t("professional.roleLabel")}</span><select name="role" defaultValue="PROFESSIONAL">{(["MANAGER", "PROFESSIONAL", "REVIEWER"] as ProfessionalProjectMemberRole[]).map((role) => <option key={role} value={role}>{t(`professional.role.${role}`)}</option>)}</select></label>
            <Button type="submit" icon="plus" disabled={working}>{t("professional.assign")}</Button>
          </form>}
        </aside>}
      </div>}

    {detail && <article className="panel professional-time-panel">
      <header><div><h2>{t("professional.timeEntries")}</h2><p>{t("professional.timeDescription")}</p></div><div className="professional-time-summary"><span>{t("professional.totalTime")} <strong>{formatDuration(timeSummary.trackedMinutes)}</strong></span><span>{t("professional.billableTime")} <strong>{formatDuration(timeSummary.billableMinutes)}</strong></span></div></header>
      {detail.project.status === "ACTIVE" && <form className="professional-time-form" onSubmit={logTime}>
        <label><span>{t("professional.workDate")}</span><input name="workDate" type="date" defaultValue={today()} required /></label>
        <label><span>{t("professional.minutes")}</span><input name="minutes" type="number" min={1} max={1440} defaultValue={60} required /></label>
        <label className="professional-time-description"><span>{t("professional.workDescription")}</span><input name="description" minLength={1} maxLength={1000} required /></label>
        <label className="checkbox-row"><input name="isBillable" type="checkbox" defaultChecked={detail.project.billingModel !== "NON_BILLABLE"} disabled={detail.project.billingModel === "NON_BILLABLE"} /><span>{t("professional.billable")}</span></label>
        <Button type="submit" icon="plus" disabled={working}>{t("professional.logTime")}</Button>
      </form>}
      {timeEntries.length === 0 ? <EmptyState title={t("professional.timeEmptyTitle")} description={t("professional.timeEmptyDescription")} /> : <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("professional.workDate")}</th><th>{t("professional.person")}</th><th>{t("professional.workDescription")}</th><th>{t("professional.time")}</th><th>{t("professional.billable")}</th><th>{t("professional.actions")}</th></tr></thead><tbody>{timeEntries.map((entry) => <tr key={entry.id}><td>{entry.workDate}</td><td>{entry.user.displayName}</td><td>{entry.description}</td><td>{formatDuration(entry.minutes)}</td><td>{entry.isBillable ? t("professional.yes") : t("professional.no")}</td><td>{entry.editable ? <Button variant="ghost" icon="trash" disabled={working} onClick={() => void deleteTime(entry)}>{t("professional.deleteTime")}</Button> : <span className="muted">{t("professional.readOnly")}</span>}</td></tr>)}</tbody></table></div><Pagination {...timeMeta} page={timePage} onChange={setTimePage} /></>}
    </article>}

    {createOpen && <Modal title={t("professional.createTitle")} description={t("professional.createDescription")} onClose={() => setCreateOpen(false)} wide>
      <form className="modal-form form-grid" onSubmit={createProject}>
        <label><span>{t("professional.customer")}</span><select name="customerId" required><option value="" />{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {localizedReferenceName(customer)}</option>)}</select></label>
        <label><span>{t("professional.nameAr")}</span><input name="nameAr" maxLength={200} required /></label>
        <label><span>{t("professional.nameEn")}</span><input name="nameEn" maxLength={200} dir="ltr" /></label>
        <label><span>{t("professional.kindLabel")}</span><select name="kind" defaultValue="LEGAL_MATTER">{(["LEGAL_MATTER", "CONSULTING_ENGAGEMENT", "PROFESSIONAL_PROJECT"] as const).map((kind) => <option key={kind} value={kind}>{t(`professional.kind.${kind}`)}</option>)}</select></label>
        <label><span>{t("professional.billingModel")}</span><select name="billingModel" defaultValue="TIME_AND_MATERIALS">{(["TIME_AND_MATERIALS", "FIXED_FEE", "NON_BILLABLE"] as const).map((model) => <option key={model} value={model}>{t(`professional.billing.${model}`)}</option>)}</select></label>
        <label><span>{t("professional.startDate")}</span><input name="startDate" type="date" defaultValue={today()} required /></label>
        <label><span>{t("professional.targetEndDate")}</span><input name="targetEndDate" type="date" /></label>
        <label className="full-span"><span>{t("professional.projectDescription")}</span><textarea name="description" rows={3} maxLength={1000} /></label>
        <div className="modal-actions full-span"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={working}>{working ? t("common.saving") : t("professional.create")}</Button></div>
      </form>
    </Modal>}
  </section>;
}
