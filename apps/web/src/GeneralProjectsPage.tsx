import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, idempotencyKey } from "./api";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Button, EmptyState, PageHeader, Pagination, Spinner, TableRegion } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Status = "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
type Role = "MANAGER" | "CONTRIBUTOR";
type Customer = { id: string; code: string; nameAr: string; nameEn: string | null };
type Employee = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null; status: string };
type Project = { id: string; code: string; nameAr: string; nameEn: string | null; description: string | null; status: Status; priority: string;
  customer: Customer | null; plannedStartDate: string | null; targetEndDate: string | null; memberCount: number; version: number; planVersion: number };
type Member = { id: string; employee: Employee; role: Role; isActive: boolean; version: number };
type PhaseStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type Phase = { id: string; sequence: number; title: string; description: string | null; status: PhaseStatus; version: number;
  plannedStartDate: string | null; targetEndDate: string | null };
type PhaseList = { data: Phase[]; planVersion: number; meta: List["meta"] };
type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
type Task = { id: string; sequence: number; title: string; priority: string; status: TaskStatus; version: number };
type TaskList = { data: Task[]; planVersion: number; meta: List["meta"] };
type Detail = { project: Project; members: Member[] };
type List = { data: Project[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };

export function GeneralProjectsPage({ notify }: { notify: Notice }) {
  const { selectedCompany, user, permissionSet } = useAuthorization();
  return <GeneralProjectsWorkspace key={JSON.stringify([user.id, selectedCompany?.id, [...permissionSet].sort()])} notify={notify} />;
}

function GeneralProjectsWorkspace({ notify }: { notify: Notice }) {
  const { t } = useI18n();
  const { permissionSet } = useAuthorization();
  const canManage = permissionSet.has("general_projects.manage");
  const canReadCustomers = permissionSet.has("customers.view");
  const [projects, setProjects] = useState<Project[]>([]);
  const [meta, setMeta] = useState<List["meta"]>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [phases, setPhases] = useState<(PhaseList & { projectId: string }) | null>(null);
  const phaseRequestSequence = useRef(0);
  const [phasePage, setPhasePage] = useState(1);
  const [newPhaseTitle, setNewPhaseTitle] = useState("");
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [tasks, setTasks] = useState<(TaskList & { projectId: string; phaseId: string }) | null>(null);
  const taskRequestSequence = useRef(0);
  const [taskPage, setTaskPage] = useState(1);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [pickedCustomers, setPickedCustomers] = useState<Customer[]>([]);
  const [pickedEmployees, setPickedEmployees] = useState<Employee[]>([]);
  const [newName, setNewName] = useState("");
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newManagerId, setNewManagerId] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("CONTRIBUTOR");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (search.trim()) query.set("search", search.trim());
      if (status) query.set("status", status);
      const result = await api<List>(`/general-projects?${query}`);
      setProjects(result.data); setMeta(result.meta);
      setSelectedId(current => result.data.some(project => project.id === current) ? current : result.data[0]?.id ?? "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("generalProjects.loadingError")); }
    finally { setLoading(false); }
  }, [page, search, status, t]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    try { setDetail(await api<Detail>(`/general-projects/${selectedId}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error"); }
  }, [selectedId, notify, t]);

  const loadPhases = useCallback(async () => {
    const sequence = ++phaseRequestSequence.current;
    if (!selectedId) { setPhases(null); return; }
    try {
      const result = await api<PhaseList>(`/general-projects/${selectedId}/phases?page=${phasePage}&pageSize=10`);
      if (sequence === phaseRequestSequence.current) setPhases({ ...result, projectId: selectedId });
    } catch (cause) {
      if (sequence === phaseRequestSequence.current) {
        setPhases(null); notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error");
      }
    }
  }, [selectedId, phasePage, notify, t]);
  const loadTasks = useCallback(async () => {
    const sequence = ++taskRequestSequence.current;
    if (!selectedId || !selectedPhaseId) { setTasks(null); return; }
    try {
      const result = await api<TaskList>(`/general-projects/${selectedId}/phases/${selectedPhaseId}/tasks?page=${taskPage}&pageSize=10`);
      if (sequence === taskRequestSequence.current) setTasks({ ...result, projectId: selectedId, phaseId: selectedPhaseId });
    } catch (cause) {
      if (sequence === taskRequestSequence.current) {
        setTasks(null); notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error");
      }
    }
  }, [selectedId, selectedPhaseId, taskPage, notify, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);
  useEffect(() => { setPhases(null); setPhasePage(1); setSelectedPhaseId(""); setTasks(null); }, [selectedId]);
  useEffect(() => { void loadPhases(); }, [loadPhases]);
  useEffect(() => { setTasks(null); setTaskPage(1); }, [selectedPhaseId]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => {
    setEditName(detail?.project.nameAr ?? "");
    setEditDescription(detail?.project.description ?? "");
    setEditCustomerId(detail?.project.customer?.id ?? "");
  }, [detail?.project.id, detail?.project.version]);
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = employeeSearch.trim() ? `?search=${encodeURIComponent(employeeSearch.trim())}` : "";
      void api<{ data: Employee[] }>(`/general-projects/employee-options${query}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setEmployees(result.data); })
        .catch(cause => { if (!controller.signal.aborted) notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canManage, employeeSearch, notify, t]);
  useEffect(() => {
    if (!canManage || !canReadCustomers) { setCustomers([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = customerSearch.trim() ? `?search=${encodeURIComponent(customerSearch.trim())}` : "";
      void api<{ data: Customer[] }>(`/general-projects/customer-options${query}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setCustomers(result.data); })
        .catch(cause => { if (!controller.signal.aborted) notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canManage, canReadCustomers, customerSearch, notify, t]);

  const employeeOptions = [...pickedEmployees, ...employees].filter((employee, index, all) => all.findIndex(candidate => candidate.id === employee.id) === index);
  const customerOptions = [...pickedCustomers, ...customers].filter((customer, index, all) => all.findIndex(candidate => candidate.id === customer.id) === index);
  const selectEmployee = (id: string, setter: (value: string) => void) => {
    setter(id);
    const employee = employeeOptions.find(option => option.id === id);
    if (employee) setPickedEmployees(current => current.some(option => option.id === id) ? current : [...current, employee]);
  };
  const selectCustomer = (id: string, setter: (value: string) => void) => {
    setter(id);
    const customer = customerOptions.find(option => option.id === id);
    if (customer) setPickedCustomers(current => current.some(option => option.id === id) ? current : [...current, customer]);
  };

  const execute = async (work: () => Promise<unknown>, message: string) => {
    setWorking(true);
    try { await work(); await load(); await loadDetail(); await loadPhases(); await loadTasks(); notify(message); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("generalProjects.loadingError"), "error"); }
    finally { setWorking(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || !newManagerId) return;
    void execute(async () => {
      const result = await api<{ project: Project }>("/general-projects", { method: "POST", idempotencyKey: idempotencyKey("general-project-create", newManagerId),
        body: JSON.stringify({ nameAr: newName.trim(), managerEmployeeId: newManagerId,
          ...(canReadCustomers && newCustomerId ? { customerId: newCustomerId } : {}) }) });
      setNewName(""); setNewCustomerId(""); setSelectedId(result.project.id);
    }, t("generalProjects.saved"));
  };
  const assign = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !memberId) return;
    void execute(() => api(`/general-projects/${detail.project.id}/members`, { method: "POST", idempotencyKey: idempotencyKey("general-project-assign", detail.project.id),
      body: JSON.stringify({ version: detail.project.version, employeeId: memberId, role: memberRole }) }), t("generalProjects.memberSaved"));
  };
  const update = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !editName.trim()) return;
    void execute(() => api(`/general-projects/${detail.project.id}`, { method: "PATCH", idempotencyKey: idempotencyKey("general-project-update", detail.project.id),
      body: JSON.stringify({ version: detail.project.version, nameAr: editName.trim(), description: editDescription.trim() || null,
        ...(canReadCustomers && editCustomerId !== (detail.project.customer?.id ?? "") ? { customerId: editCustomerId || null } : {}) }) }), t("generalProjects.saved"));
  };
  const unassign = (member: Member) => {
    if (!detail || reason.trim().length < 10) return;
    void execute(() => api(`/general-projects/${detail.project.id}/members/${member.id}/unassign`, { method: "POST", idempotencyKey: idempotencyKey("general-project-unassign", member.id),
      body: JSON.stringify({ version: detail.project.version, reason: reason.trim() }) }), t("generalProjects.memberSaved"));
  };
  const transition = (next: Status) => {
    if (!detail) return;
    if ((next === "CANCELLED" || next === "ON_HOLD" || detail.project.status === "ON_HOLD") && reason.trim().length < 10) return;
    void execute(() => api(`/general-projects/${detail.project.id}/transition`, { method: "POST", idempotencyKey: idempotencyKey("general-project-transition", detail.project.id),
      body: JSON.stringify({ version: detail.project.version, status: next, ...(reason.trim() ? { reason: reason.trim() } : {}) }) }), t("generalProjects.updated"));
  };
  const transitions: Record<Status, Status[]> = { DRAFT: ["ACTIVE", "CANCELLED"], ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
    ON_HOLD: ["ACTIVE", "CANCELLED"], COMPLETED: [], CANCELLED: [] };
  const phaseTransitions: Record<PhaseStatus, PhaseStatus[]> = { PLANNED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [] };
  const createPhase = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !phases || phases.projectId !== detail.project.id || !newPhaseTitle.trim()) return;
    void execute(async () => {
      await api(`/general-projects/${detail.project.id}/phases`, { method: "POST",
        idempotencyKey: idempotencyKey("general-project-phase-create", detail.project.id),
        body: JSON.stringify({ expectedPlanVersion: phases.planVersion, title: newPhaseTitle.trim() }) });
      setNewPhaseTitle("");
    }, t("generalProjects.phaseSaved"));
  };
  const changePhase = (phase: Phase, to: PhaseStatus) => {
    if (!detail || !phases || phases.projectId !== detail.project.id || (to === "CANCELLED" && reason.trim().length < 10)) return;
    void execute(() => api(`/general-projects/${detail.project.id}/phases/${phase.id}/transition`, { method: "POST",
      idempotencyKey: idempotencyKey("general-project-phase-transition", phase.id),
      body: JSON.stringify({ expectedPlanVersion: phases.planVersion, expectedVersion: phase.version, to,
        ...(to === "CANCELLED" ? { reason: reason.trim() } : {}) }) }), t("generalProjects.phaseSaved"));
  };
  const createTask = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !phases || phases.projectId !== detail.project.id || !selectedPhaseId || !newTaskTitle.trim()) return;
    void execute(async () => {
      await api(`/general-projects/${detail.project.id}/phases/${selectedPhaseId}/tasks`, { method: "POST",
        idempotencyKey: idempotencyKey("general-project-task-create", selectedPhaseId),
        body: JSON.stringify({ expectedPlanVersion: phases.planVersion, title: newTaskTitle.trim() }) });
      setNewTaskTitle("");
    }, t("generalProjects.taskSaved"));
  };

  return <div className="page-content">
    <PageHeader kicker={t("nav.generalProjects")} title={t("generalProjects.title")} description={t("generalProjects.description")} />
    {canManage && <section className="card">
      <h2>{t("generalProjects.new")}</h2>
      <form onSubmit={create} className="form-grid">
        <label>{t("generalProjects.name")}<input required maxLength={200} value={newName} onChange={event => setNewName(event.target.value)} /></label>
        {canReadCustomers && <label>{t("common.search")} — {t("generalProjects.customer")}<input type="search" maxLength={200} value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} /></label>}
        <label>{t("generalProjects.customer")}<select disabled={!canReadCustomers} value={newCustomerId} onChange={event => selectCustomer(event.target.value, setNewCustomerId)}><option value="">—</option>{customerOptions.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.nameAr}</option>)}</select></label>
        <label>{t("common.search")} — {t("generalProjects.manager")}<input type="search" maxLength={200} value={employeeSearch} onChange={event => setEmployeeSearch(event.target.value)} /></label>
        <label>{t("generalProjects.manager")}<select required value={newManagerId} onChange={event => selectEmployee(event.target.value, setNewManagerId)}><option value="">—</option>{employeeOptions.map(employee => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.nameAr}</option>)}</select></label>
        <Button type="submit" disabled={working || !newManagerId}>{t("generalProjects.create")}</Button>
      </form>
    </section>}
    <section className="card">
      <div className="form-grid">
        <input aria-label={t("common.search")} value={search} onChange={event => { setPage(1); setSearch(event.target.value); }} />
        <select aria-label={t("generalProjects.title")} value={status} onChange={event => { setPage(1); setStatus(event.target.value as Status | ""); }}>
          <option value="">—</option>{(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const).map(value => <option key={value} value={value}>{t(`generalProjects.status.${value}`)}</option>)}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? <Spinner /> : projects.length === 0 ? <EmptyState title={t("generalProjects.empty")} description={t("generalProjects.description")} /> : <TableRegion>
        <table className="data-table"><thead><tr><th>{t("generalProjects.name")}</th><th>{t("generalProjects.customer")}</th><th>{t("generalProjects.role")}</th></tr></thead><tbody>
          {projects.map(project => <tr key={project.id}><td><Button variant="ghost" onClick={() => setSelectedId(project.id)}>{project.code} · {project.nameAr}</Button></td><td>{project.customer?.nameAr ?? "—"}</td><td>{t(`generalProjects.status.${project.status}`)}</td></tr>)}
        </tbody></table>
      </TableRegion>}
      <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </section>
    {detail && detail.project.id === selectedId && <section className="card">
      <h2>{detail.project.code} · {detail.project.nameAr}</h2>
      <p>{t(`generalProjects.status.${detail.project.status}`)} · {detail.project.description ?? ""}</p>
      {canManage && transitions[detail.project.status].length > 0 && <form onSubmit={update} className="form-grid">
        <label>{t("generalProjects.name")}<input required maxLength={200} value={editName} onChange={event => setEditName(event.target.value)} /></label>
        <label>{t("generalProjects.description")}<textarea maxLength={1000} value={editDescription} onChange={event => setEditDescription(event.target.value)} /></label>
        {canReadCustomers && <label>{t("common.search")} — {t("generalProjects.customer")}<input type="search" maxLength={200} value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} /></label>}
        <label>{t("generalProjects.customer")}<select disabled={!canReadCustomers} value={editCustomerId} onChange={event => selectCustomer(event.target.value, setEditCustomerId)}><option value="">—</option>{detail.project.customer && !customerOptions.some(customer => customer.id === detail.project.customer!.id) && <option value={detail.project.customer.id}>{detail.project.customer.code} · {detail.project.customer.nameAr}</option>}{customerOptions.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.nameAr}</option>)}</select></label>
        <Button type="submit" disabled={working || !editName.trim()}>{t("common.save")}</Button>
      </form>}
      {canManage && transitions[detail.project.status].length > 0 && <div>
        <label>{t("generalProjects.reason")}<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        {transitions[detail.project.status].map(next => <Button key={next} variant="secondary" disabled={working} onClick={() => transition(next)}>{t(`generalProjects.status.${next}`)}</Button>)}
      </div>}
      <h3>{t("generalProjects.member")}</h3>
      {detail.members.map(member => <div key={member.id}>
        {member.employee.employeeNumber} · {member.employee.nameAr} · {t(`generalProjects.role.${member.role}`)}{!member.isActive && " · —"}
        {canManage && member.isActive && transitions[detail.project.status].length > 0 && <Button variant="ghost" disabled={working || reason.trim().length < 10} onClick={() => unassign(member)}>{t("generalProjects.unassign")}</Button>}
      </div>)}
      {canManage && transitions[detail.project.status].length > 0 && <form onSubmit={assign} className="form-grid">
        <label>{t("common.search")} — {t("generalProjects.member")}<input type="search" maxLength={200} value={employeeSearch} onChange={event => setEmployeeSearch(event.target.value)} /></label>
        <label>{t("generalProjects.member")}<select value={memberId} onChange={event => selectEmployee(event.target.value, setMemberId)}><option value="">—</option>{employeeOptions.map(employee => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.nameAr}</option>)}</select></label>
        <label>{t("generalProjects.role")}<select value={memberRole} onChange={event => setMemberRole(event.target.value as Role)}><option value="MANAGER">{t("generalProjects.role.MANAGER")}</option><option value="CONTRIBUTOR">{t("generalProjects.role.CONTRIBUTOR")}</option></select></label>
        <Button type="submit" disabled={working || !memberId}>{t("generalProjects.assign")}</Button>
      </form>}
      <h3>{t("generalProjects.phases")}</h3>
      {phases?.projectId === selectedId && phases.data.length === 0 && <p>{t("generalProjects.noPhases")}</p>}
      {phases?.projectId === selectedId && phases.data.map(phase => <div key={phase.id}>
        <Button variant="ghost" onClick={() => setSelectedPhaseId(phase.id)}>
          {phase.sequence}. {phase.title} · {t(`generalProjects.phaseStatus.${phase.status}`)}
        </Button>
        {canManage && detail.project.status === "ACTIVE" && phaseTransitions[phase.status].map(next =>
          <Button key={next} variant="secondary" disabled={working || (next === "CANCELLED" && reason.trim().length < 10)}
            onClick={() => changePhase(phase, next)}>{t(`generalProjects.phaseStatus.${next}`)}</Button>)}
      </div>)}
      {phases?.projectId === selectedId && <Pagination page={phases.meta.page} totalPages={phases.meta.totalPages} total={phases.meta.total} onChange={setPhasePage} />}
      {canManage && phases?.projectId === selectedId && detail.project.status !== "COMPLETED" && detail.project.status !== "CANCELLED" &&
        <form onSubmit={createPhase} className="form-grid">
          <label>{t("generalProjects.phaseTitle")}<input required maxLength={200} value={newPhaseTitle}
            onChange={event => setNewPhaseTitle(event.target.value)} /></label>
          <Button type="submit" disabled={working || !newPhaseTitle.trim()}>{t("generalProjects.addPhase")}</Button>
        </form>}
      {selectedPhaseId && phases?.projectId === selectedId && phases.data.some(phase => phase.id === selectedPhaseId) && <div>
        <h3>{t("generalProjects.tasks")}</h3>
        {tasks?.projectId === selectedId && tasks.phaseId === selectedPhaseId && tasks.data.length === 0 &&
          <p>{t("generalProjects.noTasks")}</p>}
        {tasks?.projectId === selectedId && tasks.phaseId === selectedPhaseId && tasks.data.map(task =>
          <div key={task.id}>{task.sequence}. {task.title} · {t(`generalProjects.taskStatus.${task.status}`)}</div>)}
        {tasks?.projectId === selectedId && tasks.phaseId === selectedPhaseId &&
          <Pagination page={tasks.meta.page} totalPages={tasks.meta.totalPages} total={tasks.meta.total} onChange={setTaskPage} />}
        {canManage && detail.project.status !== "COMPLETED" && detail.project.status !== "CANCELLED" &&
          phases.data.find(phase => phase.id === selectedPhaseId)?.status !== "COMPLETED" &&
          phases.data.find(phase => phase.id === selectedPhaseId)?.status !== "CANCELLED" &&
          <form onSubmit={createTask} className="form-grid">
            <label>{t("generalProjects.taskTitle")}<input required maxLength={200} value={newTaskTitle}
              onChange={event => setNewTaskTitle(event.target.value)} /></label>
            <Button type="submit" disabled={working || !newTaskTitle.trim()}>{t("generalProjects.addTask")}</Button>
          </form>}
      </div>}
    </section>}
  </div>;
}
