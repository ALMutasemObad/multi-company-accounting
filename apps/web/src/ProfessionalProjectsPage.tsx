import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, idempotencyKey } from "./api";
import { formatMoney, toMoney, toRate } from "./domain";
import { localizedReferenceName, useI18n } from "./i18n";
import { ReferenceCombobox } from "./ReferenceCombobox";
import type {
  Account,
  CostCenter,
  FiscalPeriod,
  ListResponse,
  ProfessionalBillingCurrency,
  ProfessionalBillingRun,
  ProfessionalCustomerOption,
  ProfessionalPerson,
  ProfessionalProject,
  ProfessionalProjectMember,
  ProfessionalProjectMemberRole,
  ProfessionalProjectStatus,
  ProfessionalServiceContract,
  ProfessionalServiceRate,
  ProfessionalTimeEntry,
  ProfessionalTimeEntryList,
  ProfessionalTimesheet,
  TaxRate,
} from "./types";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type ProjectDetail = { project: ProfessionalProject; members: ProfessionalProjectMember[] };
const today = () => new Date().toISOString().slice(0, 10);
const currentWeekStart = () => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() - value.getDay());
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

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
  const [timesheets, setTimesheets] = useState<ProfessionalTimesheet[]>([]);
  const [timesheetMeta, setTimesheetMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [timesheetPage, setTimesheetPage] = useState(1);
  const [customers, setCustomers] = useState<ProfessionalCustomerOption[]>([]);
  const [people, setPeople] = useState<ProfessionalPerson[]>([]);
  const [contracts, setContracts] = useState<ProfessionalServiceContract[]>([]);
  const [rates, setRates] = useState<ProfessionalServiceRate[]>([]);
  const [billingRuns, setBillingRuns] = useState<ProfessionalBillingRun[]>([]);
  const [billingCurrencies, setBillingCurrencies] = useState<ProfessionalBillingCurrency[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [revenueAccountId, setRevenueAccountId] = useState("");
  const [revenueAccountLabel, setRevenueAccountLabel] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [costCenterLabel, setCostCenterLabel] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [taxRateLabel, setTaxRateLabel] = useState("");
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

  const loadTimesheets = useCallback(async () => {
    try {
      const result = await api<ListResponse<ProfessionalTimesheet>>(`/professional-timesheets?scope=MY&page=${timesheetPage}&pageSize=10`);
      setTimesheets(result.data);
      setTimesheetMeta(result.meta);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timesheetLoadError"), "error");
    }
  }, [notify, t, timesheetPage]);

  const loadCommercial = useCallback(async () => {
    if (!selectedId) {
      setContracts([]);
      setBillingRuns([]);
      setSelectedContractId("");
      return;
    }
    const [contractResult, runResult] = await Promise.allSettled([
      api<{ data: ProfessionalServiceContract[] }>(`/professional-service-contracts?projectId=${selectedId}`),
      api<{ data: ProfessionalBillingRun[] }>(`/professional-billing-runs?projectId=${selectedId}`),
    ]);
    if (contractResult.status === "fulfilled") {
      setContracts(contractResult.value.data);
      setSelectedContractId((current) => contractResult.value.data.some((contract) => contract.id === current)
        ? current
        : contractResult.value.data.find((contract) => contract.status === "ACTIVE")?.id
          ?? contractResult.value.data[0]?.id
          ?? "");
    } else {
      setContracts([]);
      setSelectedContractId("");
    }
    if (runResult.status === "fulfilled") {
      setBillingRuns(runResult.value.data);
    } else {
      setBillingRuns([]);
    }
    if (contractResult.status === "rejected" && runResult.status === "rejected") {
      notify(contractResult.reason instanceof Error ? contractResult.reason.message : t("professional.commercialLoadError"), "error");
    }
  }, [notify, selectedId, t]);

  const loadRates = useCallback(async () => {
    if (!selectedContractId) {
      setRates([]);
      return;
    }
    try {
      setRates((await api<{ data: ProfessionalServiceRate[] }>(`/professional-service-rates?contractId=${selectedContractId}`)).data);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.commercialLoadError"), "error");
    }
  }, [notify, selectedContractId, t]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void Promise.all([loadDetail(), loadTime(), loadCommercial()]); }, [loadCommercial, loadDetail, loadTime]);
  useEffect(() => { void loadRates(); }, [loadRates]);
  useEffect(() => { void loadTimesheets(); }, [loadTimesheets]);
  useEffect(() => {
    void Promise.all([
      api<{ data: ProfessionalCustomerOption[] }>("/professional-projects/customer-options"),
      api<{ data: ProfessionalPerson[] }>("/professional-projects/member-options"),
    ]).then(([customerResult, peopleResult]) => {
      setCustomers(customerResult.data);
      setPeople(peopleResult.data);
    }).catch((cause) => notify(cause instanceof Error ? cause.message : t("professional.optionsError"), "error"));

    void Promise.allSettled([
      api<{ data: ProfessionalBillingCurrency[] }>("/professional-billing/currency-options"),
      api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
    ]).then(([currencyResult, periodResult]) => {
      if (currencyResult.status === "fulfilled") {
        setBillingCurrencies(currencyResult.value.data);
      }
      if (periodResult.status === "fulfilled") {
        setPeriods(periodResult.value.data.filter((period) => period.status !== "CLOSED"));
      }
      if (currencyResult.status === "rejected" && periodResult.status === "rejected") {
        notify(currencyResult.reason instanceof Error ? currencyResult.reason.message : t("professional.optionsError"), "error");
      }
    });
  }, [notify, t]);

  const formatDuration = (minutes: number) => t("professional.duration", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });

  async function refreshAll() {
    await loadProjects();
    await Promise.all([loadDetail(), loadTime(), loadTimesheets(), loadCommercial(), loadRates()]);
  }

  async function createTimesheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api("/professional-timesheets", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-timesheet", crypto.randomUUID()),
        body: JSON.stringify({ periodStart: String(data.get("periodStart") ?? "") }),
      });
      notify(t("professional.timesheetCreated"));
      await loadTimesheets();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timesheetError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function submitTimesheet(timesheet: ProfessionalTimesheet) {
    if (!window.confirm(t("professional.timesheetSubmitConfirm"))) return;
    setWorking(true);
    try {
      await api("/approval-requests", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-timesheet-submit", crypto.randomUUID()),
        body: JSON.stringify({
          subjectType: "PROFESSIONAL_TIMESHEET",
          subjectId: timesheet.id,
          subjectVersion: timesheet.version,
        }),
      });
      notify(t("professional.timesheetSubmitted"));
      await Promise.all([loadTimesheets(), loadTime()]);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.timesheetError"), "error");
    } finally {
      setWorking(false);
    }
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

  async function createContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking(true);
    try {
      const result = await api<{ contract: ProfessionalServiceContract }>("/professional-service-contracts", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-contract", crypto.randomUUID()),
        body: JSON.stringify({
          projectId: detail.project.id,
          currencyId: String(data.get("currencyId") ?? ""),
          contractReference: String(data.get("contractReference") ?? "").trim() || null,
          effectiveFrom: String(data.get("effectiveFrom") ?? ""),
          effectiveTo: String(data.get("effectiveTo") ?? "") || null,
          paymentTermsDays: Number(data.get("paymentTermsDays")),
        }),
      });
      form.reset();
      setSelectedContractId(result.contract.id);
      notify(t("professional.contractCreated"));
      await loadCommercial();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.contractError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function endContract(contract: ProfessionalServiceContract) {
    const effectiveTo = window.prompt(t("professional.endDatePrompt"), today());
    if (!effectiveTo) return;
    const reason = window.prompt(t("professional.endReasonPrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/professional-service-contracts/${contract.id}/end`, {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-contract-end", crypto.randomUUID()),
        body: JSON.stringify({ version: contract.version, effectiveTo, reason }),
      });
      notify(t("professional.contractEnded"));
      await loadCommercial();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.contractError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function createRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedContractId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking(true);
    try {
      await api("/professional-service-rates", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-rate", crypto.randomUUID()),
        body: JSON.stringify({
          contractId: selectedContractId,
          userId: String(data.get("userId") ?? ""),
          hourlyRate: toMoney(String(data.get("hourlyRate") ?? "")),
          effectiveFrom: String(data.get("effectiveFrom") ?? ""),
          effectiveTo: String(data.get("effectiveTo") ?? "") || null,
        }),
      });
      form.reset();
      notify(t("professional.rateCreated"));
      await loadRates();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.rateError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function endRate(rate: ProfessionalServiceRate) {
    const effectiveTo = window.prompt(t("professional.endDatePrompt"), today());
    if (!effectiveTo) return;
    const reason = window.prompt(t("professional.endReasonPrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/professional-service-rates/${rate.id}/end`, {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-rate-end", crypto.randomUUID()),
        body: JSON.stringify({ version: rate.version, effectiveTo, reason }),
      });
      notify(t("professional.rateEnded"));
      await loadRates();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.rateError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function createBillingRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const contract = contracts.find((item) => item.id === selectedContractId);
    if (!contract) return;
    if (!window.confirm(t("professional.billingConfirm"))) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api("/professional-billing-runs", {
        method: "POST",
        idempotencyKey: idempotencyKey("professional-billing", crypto.randomUUID()),
        body: JSON.stringify({
          projectId: detail.project.id,
          contractId: contract.id,
          contractVersion: contract.version,
          sourceDateFrom: String(data.get("sourceDateFrom") ?? ""),
          sourceDateTo: String(data.get("sourceDateTo") ?? ""),
          fiscalPeriodId: String(data.get("fiscalPeriodId") ?? ""),
          documentDate: String(data.get("documentDate") ?? ""),
          exchangeRate: toRate(String(data.get("exchangeRate") ?? "")),
          revenueAccountId,
          costCenterId: costCenterId || null,
          taxRateId: taxRateId || null,
        }),
      });
      notify(t("professional.billingCreated"));
      await Promise.all([loadCommercial(), loadTime()]);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("professional.billingError"), "error");
    } finally {
      setWorking(false);
    }
  }

  const selectedContract = contracts.find((contract) => contract.id === selectedContractId) ?? null;
  const personName = (userId: string) => people.find((person) => person.id === userId)?.displayName ?? userId;

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

    {detail?.project.billingModel === "TIME_AND_MATERIALS" && <article className="panel professional-commercial-panel">
      <header><div><h2>{t("professional.commercialTitle")}</h2><p>{t("professional.commercialDescription")}</p></div></header>
      <div className="professional-commercial-grid">
        <section className="professional-commercial-section">
          <h3>{t("professional.contracts")}</h3>
          <form className="professional-commercial-form" onSubmit={createContract}>
            <label><span>{t("professional.currency")}</span><select name="currencyId" required defaultValue=""><option value="" />{billingCurrencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {currency.nameAr}</option>)}</select></label>
            <label><span>{t("professional.contractReference")}</span><input name="contractReference" maxLength={120} /></label>
            <label><span>{t("professional.effectiveFrom")}</span><input name="effectiveFrom" type="date" defaultValue={detail.project.startDate} required /></label>
            <label><span>{t("professional.effectiveTo")}</span><input name="effectiveTo" type="date" /></label>
            <label><span>{t("professional.paymentTerms")}</span><input name="paymentTermsDays" type="number" min={0} max={365} defaultValue={30} required /></label>
            <Button type="submit" icon="plus" disabled={working}>{t("professional.createContract")}</Button>
          </form>
          {contracts.length === 0 ? <p className="muted professional-commercial-empty">{t("professional.noContracts")}</p> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("professional.contractReference")}</th><th>{t("professional.currency")}</th><th>{t("professional.effectivePeriod")}</th><th>{t("professional.statusLabel")}</th><th>{t("professional.actions")}</th></tr></thead><tbody>{contracts.map((contract) => <tr key={contract.id} className={contract.id === selectedContractId ? "selected-row" : ""}><td><button type="button" className="text-link strong" onClick={() => setSelectedContractId(contract.id)}>{contract.contractReference || t("professional.unreferencedContract")}</button></td><td>{contract.currency.code}</td><td>{contract.effectiveFrom}<small>{contract.effectiveTo ? t("professional.toDate", { date: contract.effectiveTo }) : t("professional.openEnded")}</small></td><td><span className={`status-chip ${contract.status.toLowerCase()}`}>{t(`professional.termStatus.${contract.status}`)}</span></td><td>{contract.status === "ACTIVE" ? <Button variant="ghost" disabled={working} onClick={() => void endContract(contract)}>{t("professional.end")}</Button> : <span className="muted">{contract.endReason}</span>}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="professional-commercial-section">
          <h3>{t("professional.rates")}</h3>
          {selectedContract ? <>
            <form className="professional-commercial-form" onSubmit={createRate}>
              <label><span>{t("professional.person")}</span><select name="userId" required defaultValue=""><option value="" />{detail.members.filter((member) => member.isActive).map((member) => <option key={member.user.id} value={member.user.id}>{member.user.displayName}</option>)}</select></label>
              <label><span>{t("professional.hourlyRate")}</span><input name="hourlyRate" dir="ltr" inputMode="decimal" placeholder="0.0000" required /></label>
              <label><span>{t("professional.effectiveFrom")}</span><input name="effectiveFrom" type="date" defaultValue={selectedContract.effectiveFrom} required /></label>
              <label><span>{t("professional.effectiveTo")}</span><input name="effectiveTo" type="date" /></label>
              <Button type="submit" icon="plus" disabled={working || selectedContract.status !== "ACTIVE"}>{t("professional.createRate")}</Button>
            </form>
            {rates.length === 0 ? <p className="muted professional-commercial-empty">{t("professional.noRates")}</p> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("professional.person")}</th><th>{t("professional.hourlyRate")}</th><th>{t("professional.effectivePeriod")}</th><th>{t("professional.statusLabel")}</th><th>{t("professional.actions")}</th></tr></thead><tbody>{rates.map((rate) => <tr key={rate.id}><td>{personName(rate.userId)}</td><td className="money-cell">{formatMoney(rate.hourlyRate)} {selectedContract.currency.code}</td><td>{rate.effectiveFrom}<small>{rate.effectiveTo ? t("professional.toDate", { date: rate.effectiveTo }) : t("professional.openEnded")}</small></td><td><span className={`status-chip ${rate.status.toLowerCase()}`}>{t(`professional.termStatus.${rate.status}`)}</span></td><td>{rate.status === "ACTIVE" ? <Button variant="ghost" disabled={working} onClick={() => void endRate(rate)}>{t("professional.end")}</Button> : <span className="muted">{rate.endReason}</span>}</td></tr>)}</tbody></table></div>}
          </> : <p className="muted professional-commercial-empty">{t("professional.selectContract")}</p>}
        </section>
      </div>

      <section className="professional-billing-section">
        <header><div><h3>{t("professional.billingRuns")}</h3><p>{t("professional.billingDescription")}</p></div></header>
        {selectedContract && <form className="professional-billing-form" onSubmit={createBillingRun}>
          <label><span>{t("professional.contractReference")}</span><select value={selectedContractId} onChange={(event) => setSelectedContractId(event.target.value)} required>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contractReference || contract.id} — {contract.currency.code}</option>)}</select></label>
          <label><span>{t("professional.sourceFrom")}</span><input name="sourceDateFrom" type="date" defaultValue={selectedContract.effectiveFrom} required /></label>
          <label><span>{t("professional.sourceTo")}</span><input name="sourceDateTo" type="date" defaultValue={today()} required /></label>
          <label><span>{t("professional.fiscalPeriod")}</span><select name="fiscalPeriodId" required defaultValue=""><option value="" />{periods.map((period) => <option key={period.id} value={period.id}>{period.name} — {period.startDate} / {period.endDate}</option>)}</select></label>
          <label><span>{t("professional.documentDate")}</span><input name="documentDate" type="date" defaultValue={today()} required /></label>
          <label><span>{t("professional.exchangeRate")}</span><input name="exchangeRate" dir="ltr" inputMode="decimal" defaultValue="1.00000000" required /></label>
          <label><span>{t("professional.revenueAccount")}</span><ReferenceCombobox<Account> endpoint="/accounts?active=true&allowsPosting=true&accountClasses=REVENUE" value={revenueAccountId} selectedLabel={revenueAccountLabel} onChange={(account) => { setRevenueAccountId(account?.id ?? ""); setRevenueAccountLabel(account ? `${account.code} — ${localizedReferenceName(account)}` : ""); }} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("professional.revenueAccount")} searchLabel={t("professional.revenueAccount")} required /></label>
          <label><span>{t("professional.costCenter")}</span><ReferenceCombobox<CostCenter> endpoint="/cost-centers?active=true" value={costCenterId} selectedLabel={costCenterLabel} onChange={(center) => { setCostCenterId(center?.id ?? ""); setCostCenterLabel(center ? `${center.code} — ${localizedReferenceName(center)}` : ""); }} optionLabel={(center) => `${center.code} — ${localizedReferenceName(center)}`} placeholder={t("professional.optional")} searchLabel={t("professional.costCenter")} optionalLabel={t("professional.optional")} /></label>
          <label><span>{t("professional.taxRate")}</span><ReferenceCombobox<TaxRate> endpoint="/tax-rates?activeOnly=true" value={taxRateId} selectedLabel={taxRateLabel} onChange={(tax) => { setTaxRateId(tax?.id ?? ""); setTaxRateLabel(tax ? `${localizedReferenceName(tax)} (${Number(tax.rate)}%)` : ""); }} optionLabel={(tax) => `${localizedReferenceName(tax)} (${Number(tax.rate)}%)`} optionDisabled={(tax) => !tax.isReady} placeholder={t("professional.optional")} searchLabel={t("professional.taxRate")} optionalLabel={t("professional.optional")} /></label>
          <Button type="submit" icon="check" disabled={working || !revenueAccountId}>{working ? t("common.saving") : t("professional.createBillingRun")}</Button>
        </form>}
        {billingRuns.length === 0 ? <p className="muted professional-commercial-empty">{t("professional.noBillingRuns")}</p> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("professional.invoice")}</th><th>{t("professional.sourcePeriod")}</th><th>{t("professional.entries")}</th><th>{t("professional.time")}</th><th>{t("professional.total")}</th><th>{t("professional.statusLabel")}</th></tr></thead><tbody>{billingRuns.map((run) => <tr key={run.id}><td dir="ltr"><strong>{run.invoice.documentNumber}</strong></td><td>{run.sourceDateFrom}<small>{t("professional.toDate", { date: run.sourceDateTo })}</small></td><td>{run.sourceEntryCount}</td><td>{formatDuration(run.sourceMinutes)}</td><td className="money-cell">{formatMoney(run.invoice.total)} {run.invoice.currency.code}</td><td><span className={`status-chip ${run.invoice.status.toLowerCase()}`}>{run.invoice.status}</span></td></tr>)}</tbody></table></div>}
      </section>
    </article>}

    <article className="panel professional-timesheet-panel">
      <header><div><h2>{t("professional.timesheets")}</h2><p>{t("professional.timesheetsDescription")}</p></div></header>
      <form className="professional-timesheet-form" onSubmit={createTimesheet}>
        <label><span>{t("professional.weekStart")}</span><input name="periodStart" type="date" defaultValue={currentWeekStart()} required /></label>
        <Button type="submit" icon="plus" disabled={working}>{t("professional.createTimesheet")}</Button>
        <small>{t("professional.sundayHint")}</small>
      </form>
      {timesheets.length === 0 ? <EmptyState title={t("professional.timesheetEmptyTitle")} description={t("professional.timesheetEmptyDescription")} /> : <>
        <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
          <table className="data-table"><thead><tr><th>{t("professional.week")}</th><th>{t("professional.statusLabel")}</th><th>{t("professional.entries")}</th><th>{t("professional.time")}</th><th>{t("professional.billable")}</th><th>{t("professional.actions")}</th></tr></thead>
            <tbody>{timesheets.map((timesheet) => <tr key={timesheet.id}>
              <td><strong>{timesheet.periodStart}</strong><small>{t("professional.toDate", { date: timesheet.periodEnd })}</small></td>
              <td><span className={`status-chip ${timesheet.status.toLowerCase()}`}>{t(`professional.timesheetStatus.${timesheet.status}`)}</span></td>
              <td>{timesheet.entryCount}</td>
              <td>{formatDuration(timesheet.trackedMinutes)}</td>
              <td>{formatDuration(timesheet.billableMinutes)}</td>
              <td>{timesheet.editable && timesheet.entryCount > 0
                ? <Button disabled={working} onClick={() => void submitTimesheet(timesheet)}>{t("professional.submitTimesheet")}</Button>
                : <span className="muted">{timesheet.status === "OPEN" ? t("professional.timesheetNeedsEntries") : t("professional.readOnly")}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination {...timesheetMeta} page={timesheetPage} onChange={setTimesheetPage} />
      </>}
    </article>

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
