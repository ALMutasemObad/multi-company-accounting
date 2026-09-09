import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { allows } from "./authorization";
import { useAuthorization } from "./authorization-context";
import { localizedReferenceName, useI18n } from "./i18n";
import { arHumanResources, enHumanResources, hiHumanResources, urHumanResources } from "./i18n/locales/human-resources";
import type {
  Employee,
  EmploymentContract,
  HrContractType,
  HrEmploymentStatus,
  HrEmploymentType,
  HrStructureReference,
  ListResponse,
} from "./types";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";
import "./human-resources-experience.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type Tab = "employees" | "structure";
type EmployeeSummary = Record<HrEmploymentStatus, number>;

const today = () => new Date().toISOString().slice(0, 10);
const employeePermissions = {
  view: { permission: "hr.employees.view" },
  manage: { permission: "hr.employees.manage" },
  viewContracts: { permission: "hr.contracts.view" },
  manageContracts: { permission: "hr.contracts.manage" },
  viewStructure: { permission: "hr.structure.view" },
  manageStructure: { permission: "hr.structure.manage" },
} as const;
type HrCopyKey = keyof typeof arHumanResources;
const hrCopyByLocale: Record<string, Record<HrCopyKey, string>> = {
  ar: arHumanResources,
  en: enHumanResources,
  hi: hiHumanResources,
  ur: urHumanResources,
};

function employeePath(input: {
  page: number;
  pageSize: number;
  search?: string;
  status?: HrEmploymentStatus;
  departmentId?: string;
}) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  if (input.departmentId) query.set("departmentId", input.departmentId);
  return `/hr/employees?${query}`;
}

function dateLabel(value: string, locale: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function HumanResourcesPage({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const { formatNumber, intlLocale, locale, t } = useI18n();
  const hrCopy = hrCopyByLocale[locale] ?? arHumanResources;
  const canViewEmployees = allows(permissionSet, employeePermissions.view);
  const canManageEmployees = allows(permissionSet, employeePermissions.manage);
  const canViewContracts = allows(permissionSet, employeePermissions.viewContracts);
  const canManageContracts = allows(permissionSet, employeePermissions.manageContracts);
  const canViewStructure = allows(permissionSet, employeePermissions.viewStructure);
  const canManageStructure = allows(permissionSet, employeePermissions.manageStructure);
  const [tab, setTab] = useState<Tab>(() => canViewEmployees ? "employees" : "structure");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<EmployeeSummary>({ ACTIVE: 0, ON_LEAVE: 0, TERMINATED: 0 });
  const [meta, setMeta] = useState({ page: 1, pageSize: 12, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<HrEmploymentStatus | "">("");
  const [departmentId, setDepartmentId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<EmploymentContract[]>([]);
  const [departments, setDepartments] = useState<HrStructureReference[]>([]);
  const [positions, setPositions] = useState<HrStructureReference[]>([]);
  const [loading, setLoading] = useState(canViewEmployees);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [structureError, setStructureError] = useState("");
  const [createEmployeeOpen, setCreateEmployeeOpen] = useState(false);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  useEffect(() => {
    if (tab === "employees" && !canViewEmployees && canViewStructure) setTab("structure");
    if (tab === "structure" && !canViewStructure && canViewEmployees) setTab("employees");
  }, [canViewEmployees, canViewStructure, tab]);

  const loadEmployees = useCallback(async (signal?: AbortSignal) => {
    if (!canViewEmployees) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const shared = { search: search || undefined, departmentId: departmentId || undefined };
      const [result, active, onLeave, terminated] = await Promise.all([
        api<ListResponse<Employee>>(employeePath({ ...shared, page, pageSize: 12, status: status || undefined }), { signal }),
        api<ListResponse<Employee>>(employeePath({ ...shared, page: 1, pageSize: 1, status: "ACTIVE" }), { signal }),
        api<ListResponse<Employee>>(employeePath({ ...shared, page: 1, pageSize: 1, status: "ON_LEAVE" }), { signal }),
        api<ListResponse<Employee>>(employeePath({ ...shared, page: 1, pageSize: 1, status: "TERMINATED" }), { signal }),
      ]);
      if (signal?.aborted) return;
      setEmployees(result.data);
      setMeta(result.meta);
      setSummary({ ACTIVE: active.meta.total, ON_LEAVE: onLeave.meta.total, TERMINATED: terminated.meta.total });
      setSelectedId((current) => result.data.some((employee) => employee.id === current) ? current : result.data[0]?.id ?? "");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : t("hr.loadError"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [canViewEmployees, departmentId, page, search, status, t]);

  const loadStructure = useCallback(async (signal?: AbortSignal) => {
    if (!canViewStructure) return;
    setStructureError("");
    try {
      const [departmentResult, positionResult] = await Promise.all([
        api<{ data: HrStructureReference[] }>("/hr/departments", { signal }),
        api<{ data: HrStructureReference[] }>("/hr/positions", { signal }),
      ]);
      if (signal?.aborted) return;
      setDepartments(departmentResult.data);
      setPositions(positionResult.data);
    } catch (cause) {
      if (signal?.aborted) return;
      setStructureError(cause instanceof Error ? cause.message : t("hr.optionsError"));
    }
  }, [canViewStructure, t]);

  const loadSelected = useCallback(async (signal?: AbortSignal) => {
    if (!selectedId || !canViewEmployees) {
      setSelected(null);
      setContracts([]);
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    try {
      const [employeeResult, contractResult] = await Promise.all([
        api<{ employee: Employee }>(`/hr/employees/${selectedId}`, { signal }),
        canViewContracts
          ? api<{ data: EmploymentContract[] }>(`/hr/employees/${selectedId}/contracts`, { signal })
          : Promise.resolve({ data: [] }),
      ]);
      if (signal?.aborted) return;
      setSelected(employeeResult.employee);
      setContracts(contractResult.data);
    } catch (cause) {
      if (signal?.aborted) return;
      setDetailError(cause instanceof Error ? cause.message : t("hr.detailError"));
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, [canViewContracts, canViewEmployees, selectedId, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadEmployees(controller.signal);
    return () => controller.abort();
  }, [loadEmployees]);
  useEffect(() => {
    const controller = new AbortController();
    void loadStructure(controller.signal);
    return () => controller.abort();
  }, [loadStructure]);
  useEffect(() => {
    const controller = new AbortController();
    void loadSelected(controller.signal);
    return () => controller.abort();
  }, [loadSelected]);

  async function refresh() {
    await Promise.all([loadEmployees(), loadStructure()]);
    await loadSelected();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageEmployees) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      const result = await api<{ employee: Employee }>("/hr/employees", {
        method: "POST",
        idempotencyKey: idempotencyKey("hr-employee", crypto.randomUUID()),
        body: JSON.stringify({
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          departmentId: String(data.get("departmentId") ?? "") || null,
          positionId: String(data.get("positionId") ?? "") || null,
          managerEmployeeId: String(data.get("managerEmployeeId") ?? "") || null,
          employmentType: String(data.get("employmentType") ?? "FULL_TIME"),
          hireDate: String(data.get("hireDate") ?? ""),
          workLocation: String(data.get("workLocation") ?? "").trim() || null,
        }),
      });
      setCreateEmployeeOpen(false);
      setSearchInput("");
      setSearch("");
      setStatus("");
      setDepartmentId("");
      setPage(1);
      setSelectedId(result.employee.id);
      notify(t("hr.employeeCreated"));
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.employeeError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function editEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManageEmployees) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api(`/hr/employees/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: selected.version,
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          departmentId: String(data.get("departmentId") ?? "") || null,
          positionId: String(data.get("positionId") ?? "") || null,
          managerEmployeeId: String(data.get("managerEmployeeId") ?? "") || null,
          employmentType: String(data.get("employmentType") ?? "FULL_TIME"),
          hireDate: String(data.get("hireDate") ?? ""),
          workLocation: String(data.get("workLocation") ?? "").trim() || null,
        }),
      });
      setEditEmployeeOpen(false);
      notify(t("hr.employeeUpdated"));
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.employeeError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function transition(next: HrEmploymentStatus) {
    if (!selected || !canManageEmployees) return;
    const reason = window.prompt(t("hr.transitionReason"))?.trim();
    if (!reason || reason.length < 3) return;
    const effectiveDate = next === "TERMINATED" ? window.prompt(t("hr.terminationDatePrompt"), today())?.trim() : null;
    if (next === "TERMINATED" && !effectiveDate) return;
    setWorking(true);
    try {
      await api(`/hr/employees/${selected.id}/transition`, {
        method: "POST",
        idempotencyKey: idempotencyKey("hr-transition", crypto.randomUUID()),
        body: JSON.stringify({ version: selected.version, status: next, effectiveDate, reason }),
      });
      notify(t("hr.transitionSuccess"));
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.transitionError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function createContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManageContracts) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api(`/hr/employees/${selected.id}/contracts`, {
        method: "POST",
        idempotencyKey: idempotencyKey("hr-contract", crypto.randomUUID()),
        body: JSON.stringify({
          contractType: String(data.get("contractType") ?? "PERMANENT"),
          titleAr: String(data.get("titleAr") ?? "").trim(),
          titleEn: String(data.get("titleEn") ?? "").trim() || null,
          startDate: String(data.get("startDate") ?? ""),
          endDate: String(data.get("endDate") ?? "") || null,
          notes: String(data.get("notes") ?? "").trim() || null,
        }),
      });
      setContractOpen(false);
      notify(t("hr.contractCreated"));
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.contractError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function endContract(contract: EmploymentContract) {
    if (!selected || !canManageContracts) return;
    const reason = window.prompt(t("hr.endContractReason"))?.trim();
    if (!reason || reason.length < 3) return;
    const endDate = window.prompt(t("hr.endContractDate"), today())?.trim();
    if (!endDate) return;
    setWorking(true);
    try {
      await api(`/hr/employees/${selected.id}/contracts/${contract.id}/end`, {
        method: "POST",
        idempotencyKey: idempotencyKey("hr-contract-end", crypto.randomUUID()),
        body: JSON.stringify({ version: contract.version, endDate, reason }),
      });
      notify(t("hr.contractEnded"));
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.contractError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function createStructure(kind: "departments" | "positions", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageStructure) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking(true);
    try {
      await api(`/hr/${kind}`, {
        method: "POST",
        idempotencyKey: idempotencyKey(`hr-${kind}`, crypto.randomUUID()),
        body: JSON.stringify({
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          description: String(data.get("description") ?? "").trim() || null,
        }),
      });
      form.reset();
      notify(t("hr.structureCreated"));
      await loadStructure();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.structureError"), "error");
    } finally {
      setWorking(false);
    }
  }

  async function deactivateStructure(kind: "departments" | "positions", reference: HrStructureReference) {
    if (!canManageStructure) return;
    const reason = window.prompt(t("hr.deactivatePrompt"))?.trim();
    if (!reason || reason.length < 3) return;
    setWorking(true);
    try {
      await api(`/hr/${kind}/${reference.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: reference.version, isActive: false, reason }),
      });
      notify(t("hr.structureUpdated"));
      await loadStructure();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.structureError"), "error");
    } finally {
      setWorking(false);
    }
  }

  const activeDepartments = useMemo(() => departments.filter((item) => item.isActive), [departments]);
  const activePositions = useMemo(() => positions.filter((item) => item.isActive), [positions]);
  const availableManagers = employees.filter((item) => item.status !== "TERMINATED");
  const managerOptions = availableManagers.filter((item) => item.id !== selected?.id);
  const totalEmployees = summary.ACTIVE + summary.ON_LEAVE + summary.TERMINATED;
  const filtered = Boolean(search || status || departmentId);

  return <section className="workspace-page hr-workspace hr-experience">
    <PageHeader
      kicker={t("hr.kicker")}
      title={hrCopy["hr.experienceTitle"]}
      description={hrCopy["hr.experienceDescription"]}
      actions={canManageEmployees ? <Button icon="plus" onClick={() => setCreateEmployeeOpen(true)}>{t("hr.newEmployee")}</Button> : undefined}
    />

    <div className="section-tabs hr-tabs" role="tablist" aria-label={t("view.humanResources")}>
      {canViewEmployees && <button type="button" role="tab" aria-selected={tab === "employees"} aria-controls="hr-employees-panel" className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>{t("hr.tab.employees")}</button>}
      {canViewStructure && <button type="button" role="tab" aria-selected={tab === "structure"} aria-controls="hr-structure-panel" className={tab === "structure" ? "active" : ""} onClick={() => setTab("structure")}>{t("hr.tab.structure")}</button>}
    </div>

    {tab === "employees" && canViewEmployees && <div id="hr-employees-panel" role="tabpanel" className="hr-tab-panel">
      <div className="hr-summary" aria-live="polite" aria-label={hrCopy["hr.summaryLabel"]}>
        <SummaryButton label={t("hr.employees")} value={totalEmployees} selected={!status} onClick={() => { setStatus(""); setPage(1); }} />
        <SummaryButton label={t("hr.status.ACTIVE")} value={summary.ACTIVE} selected={status === "ACTIVE"} onClick={() => { setStatus("ACTIVE"); setPage(1); }} />
        <SummaryButton label={t("hr.status.ON_LEAVE")} value={summary.ON_LEAVE} selected={status === "ON_LEAVE"} onClick={() => { setStatus("ON_LEAVE"); setPage(1); }} />
        <SummaryButton label={t("hr.status.TERMINATED")} value={summary.TERMINATED} selected={status === "TERMINATED"} onClick={() => { setStatus("TERMINATED"); setPage(1); }} />
      </div>

      <form className="panel hr-filter-bar" role="search" onSubmit={submitSearch}>
        <label className="hr-search-field"><span>{t("common.search")}</span><input name="employeeSearch" type="search" placeholder={hrCopy["hr.searchPlaceholder"]} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} autoComplete="off" /></label>
        <label><span>{t("hr.statusFilter")}</span><select value={status} onChange={(event) => { setStatus(event.target.value as HrEmploymentStatus | ""); setPage(1); }}>
          <option value="">{t("hr.status.ALL")}</option>
          {(["ACTIVE", "ON_LEAVE", "TERMINATED"] as HrEmploymentStatus[]).map((value) => <option key={value} value={value}>{t(`hr.status.${value}`)}</option>)}
        </select></label>
        <label><span>{t("hr.department")}</span><select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}>
          <option value="">{hrCopy["hr.allDepartments"]}</option>
          {departments.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}
        </select></label>
        <Button type="submit" disabled={loading}>{t("common.search")}</Button>
      </form>

      {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadEmployees()}>{t("common.retry")}</Button></div>
        : loading ? <Spinner label={t("hr.loading")} />
        : employees.length === 0 && !filtered ? <EmptyState title={t("hr.emptyTitle")} description={t("hr.emptyDescription")} action={canManageEmployees ? <Button icon="plus" onClick={() => setCreateEmployeeOpen(true)}>{t("hr.newEmployee")}</Button> : undefined} />
        : <div className="hr-layout">
          <article className="panel hr-employee-list">
            <header><div><h2>{t("hr.employees")}</h2><p>{t("common.results", { total: formatNumber(meta.total) })} · {hrCopy["hr.rosterDescription"]}</p></div></header>
            <div className="data-table-wrap hr-list-region" role="region" tabIndex={0} aria-label={t("hr.employees")}>
              {employees.length === 0 ? <div className="hr-no-results" role="status"><strong>{hrCopy["hr.filteredEmptyTitle"]}</strong><p>{hrCopy["hr.filteredEmptyDescription"]}</p></div> : <ul className="hr-person-list">
                {employees.map((employee) => <li key={employee.id}>
                  <button type="button" className="hr-person-card" aria-pressed={selectedId === employee.id} onClick={() => setSelectedId(employee.id)}>
                    <span className="hr-person-heading"><strong>{localizedReferenceName(employee)}</strong><span dir="ltr">{employee.employeeNumber}</span></span>
                    <span className="hr-person-assignment">{employee.department ? localizedReferenceName(employee.department) : t("hr.notAssigned")} · {employee.position ? localizedReferenceName(employee.position) : t("hr.notAssigned")}</span>
                    <span className="hr-person-state"><span className={`status-chip ${employee.status.toLowerCase()}`}>{t(`hr.status.${employee.status}`)}</span><span>{employee.hasActiveContract ? t("hr.activeContract") : t("hr.noActiveContract")}</span></span>
                  </button>
                </li>)}
              </ul>}
            </div>
            <Pagination {...meta} page={page} onChange={setPage} />
          </article>

          <div className="hr-person-workspace">
            {detailError ? <div className="error-panel" role="alert"><p>{detailError}</p><Button variant="secondary" onClick={() => void loadSelected()}>{t("common.retry")}</Button></div>
              : detailLoading ? <Spinner label={t("hr.loading")} />
              : selected && <>
                <article className="panel hr-detail" aria-label={localizedReferenceName(selected)}>
                  <header><div><h2>{localizedReferenceName(selected)}</h2><p dir="ltr">{selected.employeeNumber}</p></div><span className={`status-chip ${selected.status.toLowerCase()}`}>{t(`hr.status.${selected.status}`)}</span></header>
                  <div className="hr-identity-strip"><span><strong>{selected.department ? localizedReferenceName(selected.department) : t("hr.notAssigned")}</strong><small>{t("hr.department")}</small></span><span><strong>{selected.position ? localizedReferenceName(selected.position) : t("hr.notAssigned")}</strong><small>{t("hr.position")}</small></span></div>
                  <dl className="detail-list">
                    <div><dt>{t("hr.typeLabel")}</dt><dd>{t(`hr.employmentType.${selected.employmentType}`)}</dd></div>
                    <div><dt>{t("hr.hireDate")}</dt><dd>{dateLabel(selected.hireDate, intlLocale)}</dd></div>
                    <div><dt>{t("hr.manager")}</dt><dd>{selected.manager ? localizedReferenceName(selected.manager) : t("hr.notAssigned")}</dd></div>
                    <div><dt>{t("hr.workLocation")}</dt><dd>{selected.workLocation ?? t("hr.notAssigned")}</dd></div>
                    <div><dt>{t("hr.linkedUser")}</dt><dd>{selected.linkedUser?.displayName ?? t("hr.notLinked")}</dd></div>
                  </dl>
                  {selected.status !== "TERMINATED" && canManageEmployees && <div className="row-actions hr-actions"><Button variant="secondary" onClick={() => setEditEmployeeOpen(true)} disabled={working}>{t("hr.editEmployee")}</Button>
                    {selected.status === "ACTIVE" ? <Button variant="secondary" disabled={working} onClick={() => void transition("ON_LEAVE")}>{t("hr.onLeave")}</Button> : <Button disabled={working} onClick={() => void transition("ACTIVE")}>{t("hr.activate")}</Button>}
                    <Button variant="danger" disabled={working} onClick={() => void transition("TERMINATED")}>{t("hr.terminate")}</Button>
                  </div>}
                </article>

                {canViewContracts && <article className="panel hr-contracts"><header><div><h2>{t("hr.contracts")}</h2><p>{t("hr.contractsDescription")}</p></div>
                  {canManageContracts && selected.status !== "TERMINATED" && !selected.hasActiveContract && <Button icon="plus" onClick={() => setContractOpen(true)}>{t("hr.newContract")}</Button>}</header>
                  {contracts.length === 0 ? <p className="muted">{t("hr.noContracts")}</p> : <div className="data-table-wrap hr-card-region" role="region" tabIndex={0} aria-label={t("hr.contracts")}><ul className="hr-contract-list">
                      {contracts.map((contract) => <li key={contract.id}>
                        <div><strong>{localizedReferenceName({ nameAr: contract.titleAr, nameEn: contract.titleEn })}</strong><span>{t(`hr.contractType.${contract.contractType}`)}</span></div>
                        <dl><div><dt>{t("hr.startDate")}</dt><dd>{dateLabel(contract.startDate, intlLocale)}</dd></div><div><dt>{t("hr.endDate")}</dt><dd>{contract.endDate ? dateLabel(contract.endDate, intlLocale) : "—"}</dd></div></dl>
                        <div className="hr-contract-state"><span className={`status-chip ${contract.status.toLowerCase()}`}>{t(`hr.contractStatus.${contract.status}`)}</span>{contract.status === "ACTIVE" && canManageContracts && <Button variant="ghost" disabled={working} onClick={() => void endContract(contract)}>{t("hr.endContract")}</Button>}</div>
                      </li>)}
                    </ul></div>}
                </article>}
              </>}
          </div>
        </div>}
    </div>}

    {tab === "structure" && canViewStructure && <div id="hr-structure-panel" role="tabpanel" className="hr-tab-panel">
      {structureError ? <div className="error-panel" role="alert"><p>{structureError}</p><Button variant="secondary" onClick={() => void loadStructure()}>{t("common.retry")}</Button></div> : <>
        <div className="hr-structure-summary" aria-live="polite"><div><span>{t("hr.departments")}</span><strong>{formatNumber(activeDepartments.length)}</strong><small>{t("hr.active")}</small></div><div><span>{t("hr.positions")}</span><strong>{formatNumber(activePositions.length)}</strong><small>{t("hr.active")}</small></div></div>
        <div className="hr-structure-grid">
          <StructurePanel title={t("hr.departments")} description={hrCopy["hr.structurePracticalDescription"]} addLabel={t("hr.addDepartment")} items={departments} working={working} canManage={canManageStructure} onCreate={(event) => void createStructure("departments", event)} onDeactivate={(item) => void deactivateStructure("departments", item)} />
          <StructurePanel title={t("hr.positions")} description={hrCopy["hr.structurePracticalDescription"]} addLabel={t("hr.addPosition")} items={positions} working={working} canManage={canManageStructure} onCreate={(event) => void createStructure("positions", event)} onDeactivate={(item) => void deactivateStructure("positions", item)} />
        </div>
      </>}
    </div>}

    {!canViewEmployees && !canViewStructure && <div className="error-panel" role="alert"><p>{t("hr.loadError")}</p></div>}

    {createEmployeeOpen && canManageEmployees && <EmployeeModal title={t("hr.createTitle")} description={t("hr.createDescription")} employees={availableManagers} departments={activeDepartments} positions={activePositions} working={working} onClose={() => setCreateEmployeeOpen(false)} onSubmit={createEmployee} />}
    {editEmployeeOpen && selected && canManageEmployees && <EmployeeModal key={selected.id} title={t("hr.editEmployee")} description={t("hr.editDescription")} employee={selected} employees={managerOptions} departments={activeDepartments} positions={activePositions} working={working} onClose={() => setEditEmployeeOpen(false)} onSubmit={editEmployee} />}
    {contractOpen && canManageContracts && <Modal title={t("hr.newContract")} description={t("hr.contractsDescription")} onClose={() => setContractOpen(false)} wide><form className="modal-form form-grid" onSubmit={createContract}>
      <label><span>{t("hr.contractTitle")}</span><input name="titleAr" maxLength={200} required /></label>
      <label><span>{t("hr.nameEn")}</span><input name="titleEn" maxLength={200} dir="ltr" /></label>
      <label><span>{t("hr.contractType")}</span><select name="contractType" defaultValue="PERMANENT">{(["PERMANENT", "FIXED_TERM", "CONSULTANT", "INTERNSHIP"] as HrContractType[]).map((value) => <option key={value} value={value}>{t(`hr.contractType.${value}`)}</option>)}</select></label>
      <label><span>{t("hr.startDate")}</span><input name="startDate" type="date" defaultValue={today()} required /></label>
      <label><span>{t("hr.endDate")}</span><input name="endDate" type="date" /></label>
      <label className="form-span-2"><span>{t("hr.notes")}</span><textarea name="notes" maxLength={1000} /></label>
      <div className="modal-actions form-span-2"><Button variant="secondary" type="button" onClick={() => setContractOpen(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={working}>{t("hr.newContract")}</Button></div>
    </form></Modal>}
  </section>;
}

function SummaryButton({ label, value, selected, onClick }: { label: string; value: number; selected: boolean; onClick: () => void }) {
  const { formatNumber } = useI18n();
  return <button type="button" className={selected ? "active" : ""} aria-pressed={selected} onClick={onClick}><span>{label}</span><strong>{formatNumber(value)}</strong></button>;
}

function StructurePanel({ title, description, addLabel, items, working, canManage, onCreate, onDeactivate }: {
  title: string;
  description: string;
  addLabel: string;
  items: HrStructureReference[];
  working: boolean;
  canManage: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDeactivate: (item: HrStructureReference) => void;
}) {
  const { t } = useI18n();
  return <article className="panel hr-structure-panel"><header><div><h2>{title}</h2><p>{description}</p></div></header>
    {canManage && <form className="compact-form hr-structure-form" onSubmit={onCreate}>
      <label><span>{t("hr.nameAr")}</span><input name="nameAr" maxLength={160} required /></label>
      <label><span>{t("hr.nameEn")}</span><input name="nameEn" maxLength={160} dir="ltr" /></label>
      <label><span>{t("hr.referenceDescription")}</span><input name="description" maxLength={500} /></label>
      <Button type="submit" icon="plus" disabled={working}>{addLabel}</Button>
    </form>}
    <div className="data-table-wrap hr-card-region" role="region" tabIndex={0} aria-label={title}><ul className="hr-reference-list">
        {items.map((item) => <li key={item.id}><div><strong>{localizedReferenceName(item)}</strong><span dir="ltr">{item.code}</span></div><div><span className={`status-chip ${item.isActive ? "active" : "inactive"}`}>{item.isActive ? t("hr.active") : t("hr.inactive")}</span>{item.isActive && canManage && <Button variant="ghost" disabled={working} onClick={() => onDeactivate(item)}>{t("hr.deactivate")}</Button>}</div></li>)}
      </ul></div>
  </article>;
}

function EmployeeModal({ title, description, employee, employees, departments, positions, working, onClose, onSubmit }: {
  title: string;
  description: string;
  employee?: Employee;
  employees: Employee[];
  departments: HrStructureReference[];
  positions: HrStructureReference[];
  working: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  return <Modal title={title} description={description} onClose={onClose} wide><form className="modal-form form-grid" onSubmit={onSubmit}>
    <label><span>{t("hr.nameAr")}</span><input name="nameAr" maxLength={160} defaultValue={employee?.nameAr ?? ""} required /></label>
    <label><span>{t("hr.nameEn")}</span><input name="nameEn" maxLength={160} dir="ltr" defaultValue={employee?.nameEn ?? ""} /></label>
    <label><span>{t("hr.department")}</span><select name="departmentId" defaultValue={employee?.department?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.position")}</span><select name="positionId" defaultValue={employee?.position?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.manager")}</span><select name="managerEmployeeId" defaultValue={employee?.manager?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.employeeNumber} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.typeLabel")}</span><select name="employmentType" defaultValue={employee?.employmentType ?? "FULL_TIME"}>{(["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN"] as HrEmploymentType[]).map((value) => <option key={value} value={value}>{t(`hr.employmentType.${value}`)}</option>)}</select></label>
    <label><span>{t("hr.hireDate")}</span><input name="hireDate" type="date" defaultValue={employee?.hireDate ?? today()} required /></label>
    <label className="form-span-2"><span>{t("hr.workLocation")}</span><input name="workLocation" maxLength={160} defaultValue={employee?.workLocation ?? ""} /></label>
    <div className="modal-actions form-span-2"><Button variant="secondary" type="button" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={working}>{employee ? t("hr.save") : t("hr.newEmployee")}</Button></div>
  </form></Modal>;
}
