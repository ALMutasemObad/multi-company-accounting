import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, idempotencyKey } from "./api";
import { localizedReferenceName, useI18n } from "./i18n";
import type {
  Employee,
  EmploymentContract,
  HrContractType,
  HrEmploymentStatus,
  HrEmploymentType,
  HrIdentityReference,
  HrStructureReference,
  ListResponse,
} from "./types";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
const today = () => new Date().toISOString().slice(0, 10);

export function HumanResourcesPage({ notify }: { notify: Notice }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"employees" | "structure">("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<HrEmploymentStatus | "">("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<EmploymentContract[]>([]);
  const [departments, setDepartments] = useState<HrStructureReference[]>([]);
  const [positions, setPositions] = useState<HrStructureReference[]>([]);
  const [users, setUsers] = useState<HrIdentityReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [createEmployeeOpen, setCreateEmployeeOpen] = useState(false);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (status) query.set("status", status);
      const result = await api<ListResponse<Employee>>(`/hr/employees?${query}`);
      setEmployees(result.data);
      setMeta(result.meta);
      setSelectedId((current) => result.data.some((employee) => employee.id === current) ? current : result.data[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("hr.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, status, t]);

  const loadStructure = useCallback(async () => {
    try {
      const [departmentResult, positionResult, userResult] = await Promise.all([
        api<{ data: HrStructureReference[] }>("/hr/departments"),
        api<{ data: HrStructureReference[] }>("/hr/positions"),
        api<{ data: HrIdentityReference[] }>("/hr/user-options"),
      ]);
      setDepartments(departmentResult.data);
      setPositions(positionResult.data);
      setUsers(userResult.data);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.optionsError"), "error");
    }
  }, [notify, t]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setSelected(null);
      setContracts([]);
      return;
    }
    try {
      const [employeeResult, contractResult] = await Promise.all([
        api<{ employee: Employee }>(`/hr/employees/${selectedId}`),
        api<{ data: EmploymentContract[] }>(`/hr/employees/${selectedId}/contracts`),
      ]);
      setSelected(employeeResult.employee);
      setContracts(contractResult.data);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("hr.detailError"), "error");
    }
  }, [notify, selectedId, t]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => { void loadStructure(); }, [loadStructure]);
  useEffect(() => { void loadSelected(); }, [loadSelected]);

  async function refresh() {
    await Promise.all([loadEmployees(), loadStructure()]);
    await loadSelected();
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      const result = await api<{ employee: Employee }>("/hr/employees", {
        method: "POST",
        idempotencyKey: idempotencyKey("hr-employee", crypto.randomUUID()),
        body: JSON.stringify({
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          userId: String(data.get("userId") ?? "") || null,
          departmentId: String(data.get("departmentId") ?? "") || null,
          positionId: String(data.get("positionId") ?? "") || null,
          managerEmployeeId: String(data.get("managerEmployeeId") ?? "") || null,
          employmentType: String(data.get("employmentType") ?? "FULL_TIME"),
          hireDate: String(data.get("hireDate") ?? ""),
          workLocation: String(data.get("workLocation") ?? "").trim() || null,
        }),
      });
      setCreateEmployeeOpen(false);
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
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await api(`/hr/employees/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: selected.version,
          nameAr: String(data.get("nameAr") ?? "").trim(),
          nameEn: String(data.get("nameEn") ?? "").trim() || null,
          userId: String(data.get("userId") ?? "") || null,
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
    if (!selected) return;
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
    if (!selected) return;
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
    if (!selected) return;
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

  const activeDepartments = departments.filter((item) => item.isActive);
  const activePositions = positions.filter((item) => item.isActive);
  const availableManagers = employees.filter((item) => item.status !== "TERMINATED");
  const managerOptions = availableManagers.filter((item) => item.id !== selected?.id);
  const linkedUserOptions = selected?.linkedUser && !users.some((user) => user.id === selected.linkedUser?.id)
    ? [selected.linkedUser, ...users]
    : users;

  return <section className="workspace-page hr-workspace">
    <PageHeader kicker={t("hr.kicker")} title={t("hr.title")} description={t("hr.description")}
      actions={<Button icon="plus" onClick={() => setCreateEmployeeOpen(true)}>{t("hr.newEmployee")}</Button>} />
    <div className="section-tabs hr-tabs" role="tablist">
      <button type="button" className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>{t("hr.tab.employees")}</button>
      <button type="button" className={tab === "structure" ? "active" : ""} onClick={() => setTab("structure")}>{t("hr.tab.structure")}</button>
    </div>

    {tab === "employees" && <>
      <div className="toolbar hr-toolbar"><label><span>{t("hr.statusFilter")}</span><select value={status} onChange={(event) => { setStatus(event.target.value as HrEmploymentStatus | ""); setPage(1); }}>
        <option value="">{t("hr.status.ALL")}</option>
        {(["ACTIVE", "ON_LEAVE", "TERMINATED"] as HrEmploymentStatus[]).map((value) => <option key={value} value={value}>{t(`hr.status.${value}`)}</option>)}
      </select></label></div>
      {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadEmployees()}>{t("common.retry")}</Button></div>
        : loading ? <Spinner label={t("hr.loading")} />
        : employees.length === 0 ? <EmptyState title={t("hr.emptyTitle")} description={t("hr.emptyDescription")} action={<Button icon="plus" onClick={() => setCreateEmployeeOpen(true)}>{t("hr.newEmployee")}</Button>} />
        : <div className="hr-layout">
          <article className="panel hr-employee-list"><header><div><h2>{t("hr.employees")}</h2><p>{t("hr.emptyDescription")}</p></div></header>
            <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("hr.employee")}</th><th>{t("hr.department")}</th><th>{t("hr.position")}</th><th>{t("hr.statusLabel")}</th><th>{t("hr.contracts")}</th></tr></thead><tbody>
              {employees.map((employee) => <tr key={employee.id} className={selectedId === employee.id ? "selected-row" : ""}>
                <td><button type="button" className="hr-employee-select" onClick={() => setSelectedId(employee.id)}><strong>{employee.employeeNumber}</strong><small>{localizedReferenceName(employee)}</small></button></td>
                <td>{employee.department ? localizedReferenceName(employee.department) : t("hr.notAssigned")}</td>
                <td>{employee.position ? localizedReferenceName(employee.position) : t("hr.notAssigned")}</td>
                <td><span className={`status-chip ${employee.status.toLowerCase()}`}>{t(`hr.status.${employee.status}`)}</span></td>
                <td>{employee.hasActiveContract ? t("hr.activeContract") : t("hr.noActiveContract")}</td>
              </tr>)}
            </tbody></table></div><Pagination {...meta} page={page} onChange={setPage} />
          </article>
          {selected && <aside className="panel hr-detail"><header><div><h2>{localizedReferenceName(selected)}</h2><p>{selected.employeeNumber}</p></div><span className={`status-chip ${selected.status.toLowerCase()}`}>{t(`hr.status.${selected.status}`)}</span></header>
            <dl className="detail-list">
              <div><dt>{t("hr.typeLabel")}</dt><dd>{t(`hr.employmentType.${selected.employmentType}`)}</dd></div>
              <div><dt>{t("hr.hireDate")}</dt><dd>{selected.hireDate}</dd></div>
              <div><dt>{t("hr.manager")}</dt><dd>{selected.manager ? localizedReferenceName(selected.manager) : t("hr.notAssigned")}</dd></div>
              <div><dt>{t("hr.workLocation")}</dt><dd>{selected.workLocation ?? t("hr.notAssigned")}</dd></div>
              <div><dt>{t("hr.linkedUser")}</dt><dd>{selected.linkedUser?.displayName ?? t("hr.notLinked")}</dd></div>
            </dl>
            {selected.status !== "TERMINATED" && <div className="row-actions hr-actions"><Button variant="secondary" onClick={() => setEditEmployeeOpen(true)} disabled={working}>{t("hr.editEmployee")}</Button>
              {selected.status === "ACTIVE" ? <Button variant="secondary" disabled={working} onClick={() => void transition("ON_LEAVE")}>{t("hr.onLeave")}</Button> : <Button disabled={working} onClick={() => void transition("ACTIVE")}>{t("hr.activate")}</Button>}
              <Button variant="danger" disabled={working} onClick={() => void transition("TERMINATED")}>{t("hr.terminate")}</Button>
            </div>}
          </aside>}
        </div>}
      {selected && <article className="panel hr-contracts"><header><div><h2>{t("hr.contracts")}</h2><p>{t("hr.contractsDescription")}</p></div>
        {selected.status !== "TERMINATED" && !selected.hasActiveContract && <Button icon="plus" onClick={() => setContractOpen(true)}>{t("hr.newContract")}</Button>}</header>
        {contracts.length === 0 ? <p className="muted">{t("hr.noContracts")}</p> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("hr.contractTitle")}</th><th>{t("hr.contractType")}</th><th>{t("hr.startDate")}</th><th>{t("hr.endDate")}</th><th>{t("hr.statusLabel")}</th><th /></tr></thead><tbody>
          {contracts.map((contract) => <tr key={contract.id}><td>{localizedReferenceName({ nameAr: contract.titleAr, nameEn: contract.titleEn })}</td><td>{t(`hr.contractType.${contract.contractType}`)}</td><td>{contract.startDate}</td><td>{contract.endDate ?? "—"}</td><td><span className={`status-chip ${contract.status.toLowerCase()}`}>{t(`hr.contractStatus.${contract.status}`)}</span></td><td>{contract.status === "ACTIVE" && <Button variant="ghost" disabled={working} onClick={() => void endContract(contract)}>{t("hr.endContract")}</Button>}</td></tr>)}
        </tbody></table></div>}
      </article>}
    </>}

    {tab === "structure" && <div className="hr-structure-grid">
      <StructurePanel title={t("hr.departments")} addLabel={t("hr.addDepartment")} items={departments} working={working} onCreate={(event) => void createStructure("departments", event)} onDeactivate={(item) => void deactivateStructure("departments", item)} />
      <StructurePanel title={t("hr.positions")} addLabel={t("hr.addPosition")} items={positions} working={working} onCreate={(event) => void createStructure("positions", event)} onDeactivate={(item) => void deactivateStructure("positions", item)} />
    </div>}

    {createEmployeeOpen && <EmployeeModal title={t("hr.createTitle")} description={t("hr.createDescription")} employees={availableManagers} departments={activeDepartments} positions={activePositions} users={users} working={working} onClose={() => setCreateEmployeeOpen(false)} onSubmit={createEmployee} />}
    {editEmployeeOpen && selected && <EmployeeModal key={selected.id} title={t("hr.editEmployee")} description={t("hr.editDescription")} employee={selected} employees={managerOptions} departments={activeDepartments} positions={activePositions} users={linkedUserOptions} working={working} onClose={() => setEditEmployeeOpen(false)} onSubmit={editEmployee} />}
    {contractOpen && <Modal title={t("hr.newContract")} description={t("hr.contractsDescription")} onClose={() => setContractOpen(false)} wide><form className="modal-form form-grid" onSubmit={createContract}>
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

function StructurePanel({ title, addLabel, items, working, onCreate, onDeactivate }: {
  title: string;
  addLabel: string;
  items: HrStructureReference[];
  working: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDeactivate: (item: HrStructureReference) => void;
}) {
  const { t } = useI18n();
  return <article className="panel hr-structure-panel"><header><div><h2>{title}</h2><p>{t("hr.structureDescription")}</p></div></header>
    <form className="compact-form hr-structure-form" onSubmit={onCreate}>
      <label><span>{t("hr.nameAr")}</span><input name="nameAr" maxLength={160} required /></label>
      <label><span>{t("hr.nameEn")}</span><input name="nameEn" maxLength={160} dir="ltr" /></label>
      <label><span>{t("hr.referenceDescription")}</span><input name="description" maxLength={500} /></label>
      <Button type="submit" icon="plus" disabled={working}>{addLabel}</Button>
    </form>
    <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("hr.code")}</th><th>{t("hr.nameAr")}</th><th>{t("hr.statusLabel")}</th><th /></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td>{item.code}</td><td>{localizedReferenceName(item)}</td><td>{item.isActive ? t("hr.active") : t("hr.inactive")}</td><td>{item.isActive && <Button variant="ghost" disabled={working} onClick={() => onDeactivate(item)}>{t("hr.deactivate")}</Button>}</td></tr>)}
    </tbody></table></div>
  </article>;
}

function EmployeeModal({ title, description, employee, employees, departments, positions, users, working, onClose, onSubmit }: {
  title: string;
  description: string;
  employee?: Employee;
  employees: Employee[];
  departments: HrStructureReference[];
  positions: HrStructureReference[];
  users: HrIdentityReference[];
  working: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  return <Modal title={title} description={description} onClose={onClose} wide><form className="modal-form form-grid" onSubmit={onSubmit}>
    <label><span>{t("hr.nameAr")}</span><input name="nameAr" maxLength={160} defaultValue={employee?.nameAr ?? ""} required /></label>
    <label><span>{t("hr.nameEn")}</span><input name="nameEn" maxLength={160} dir="ltr" defaultValue={employee?.nameEn ?? ""} /></label>
    <label><span>{t("hr.linkedUser")}</span><select name="userId" defaultValue={employee?.linkedUser?.id ?? ""}><option value="">{t("hr.notLinked")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label>
    <label><span>{t("hr.department")}</span><select name="departmentId" defaultValue={employee?.department?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.position")}</span><select name="positionId" defaultValue={employee?.position?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.manager")}</span><select name="managerEmployeeId" defaultValue={employee?.manager?.id ?? ""}><option value="">{t("hr.notAssigned")}</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.employeeNumber} — {localizedReferenceName(item)}</option>)}</select></label>
    <label><span>{t("hr.typeLabel")}</span><select name="employmentType" defaultValue={employee?.employmentType ?? "FULL_TIME"}>{(["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN"] as HrEmploymentType[]).map((value) => <option key={value} value={value}>{t(`hr.employmentType.${value}`)}</option>)}</select></label>
    <label><span>{t("hr.hireDate")}</span><input name="hireDate" type="date" defaultValue={employee?.hireDate ?? today()} required /></label>
    <label className="form-span-2"><span>{t("hr.workLocation")}</span><input name="workLocation" maxLength={160} defaultValue={employee?.workLocation ?? ""} /></label>
    <div className="modal-actions form-span-2"><Button variant="secondary" type="button" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={working}>{employee ? t("hr.save") : t("hr.newEmployee")}</Button></div>
  </form></Modal>;
}
