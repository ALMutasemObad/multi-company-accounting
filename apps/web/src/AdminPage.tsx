import {
  localizedReferenceName,
  activeIntlLocale,
  translate as t } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import { api, idempotencyKey } from "./api";
import { allows } from "./authorization";
import { Can, useAuthorization } from "./authorization-context";
import {
  adminPermissionPolicies,
  visibleAdminTabs,
  type AdminTab,
} from "./admin-permission-policies";
import type { AdminUser,
  EmployeeAccountOption,
  ListResponse,
  Permission,
  Role,
  UserRole,
  UserSession } from "./types";
import { Button,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
export function AdminPage({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const [tab, setTab] = useState<AdminTab>("users");
  const tabs = visibleAdminTabs(permissionSet);
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  const labels: Record<AdminTab, Parameters<typeof t>[0]> = {
    users: "pages.admin.004",
    roles: "pages.admin.005",
    sessions: "pages.admin.006",
  };
  return <section className="workspace-page"><PageHeader kicker={t("pages.admin.001")} title={t("pages.admin.002")} description={t("pages.admin.003")} /><div className="section-tabs">{tabs.map((availableTab) => <button key={availableTab} className={activeTab === availableTab ? "active" : ""} onClick={() => setTab(availableTab)}>{t(labels[availableTab])}</button>)}</div>{activeTab === "users" ? <UsersTab notify={notify} /> : activeTab === "roles" ? <RolesTab notify={notify} /> : activeTab === "sessions" ? <SessionsTab notify={notify} /> : null}</section>;
}

function UsersTab({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const canView = allows(permissionSet, adminPermissionPolicies.tabs.users);
  const canAssignRoles = allows(permissionSet, adminPermissionPolicies.users.assignRoles);
  const [rows, setRows] = useState<AdminUser[]>([]), [roles, setRoles] = useState<Role[]>([]), [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(1), [total, setTotal] = useState(0);
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null), [roleUser, setRoleUser] = useState<AdminUser | null>(null), [linkUser, setLinkUser] = useState<AdminUser | null>(null);
  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search.trim()) query.set("search", search.trim());
      if (status) query.set("status", status);
      const users = await api<ListResponse<AdminUser>>(`/users?${query}`);
      const roleResult = canAssignRoles
        ? await api<{ data: Role[] }>("/roles")
        : { data: [] };
      setRows(users.data);
      setTotal(users.meta.total);
      setTotalPages(users.meta.totalPages);
      setRoles(roleResult.data.filter((item) => item.isActive));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.admin.007"));
    } finally {
      setLoading(false);
    }
  }, [canAssignRoles, canView, page, search, status]);
  useEffect(() => { void load(); }, [load]);
  async function disable(user: AdminUser) {
    if (!allows(permissionSet, adminPermissionPolicies.users.disable)) return;
    const reason = window.prompt(t("pages.accounts.002", { value1: localizedReferenceName(user) }));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/users/${user.id}/disable`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      notify(t("pages.admin.009"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.accounts.005"), "error");
    }
  }
  return <>{<div className="toolbar"><form className="search-box" onSubmit={(e) => { e.preventDefault(); setPage(1); void load(); }}><input aria-label={t("pages.admin.011")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pages.admin.011")}/><button type="submit">{t("pages.accounts.026")}</button></form><select aria-label={t("pages.accounts.027")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t("pages.accounts.027")}</option><option value="ACTIVE">{t("pages.accounts.028")}</option><option value="LOCKED">{t("pages.admin.015")}</option><option value="DISABLED">{t("pages.accounts.029")}</option></select><Can policy={adminPermissionPolicies.users.create}><Button icon="plus" onClick={() => setEditing("new")}>{t("pages.admin.017")}</Button></Can></div>}{error ? <div className="error-panel" role="alert">{error}</div> : loading ? <Spinner label={t("pages.admin.018")}/> : !rows.length ? <EmptyState title={t("pages.admin.019")} description={t("pages.admin.020")}/> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.admin.021")}</th><th>{t("pages.admin.066")}</th><th>{t("pages.accounts.043")}</th><th>{t("pages.admin.023")}</th><th></th></tr></thead><tbody>{rows.map((user) => <tr key={user.id}><td><strong>{localizedReferenceName(user)}</strong><small dir="ltr">{user.email}</small></td><td>{user.employee ? <><strong>{user.employee.employeeNumber}</strong><small>{localizedReferenceName(user.employee)}</small></> : <span className="muted">{t("pages.admin.067")}</span>}</td><td><span className={`status-chip ${user.status === "ACTIVE" ? "active" : "inactive"}`}>{user.status === "ACTIVE" ? t("pages.accounts.028") : user.status === "LOCKED" ? t("pages.admin.015") : t("pages.accounts.029")}</span></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString(activeIntlLocale()) : t("pages.admin.024")}</td><td><div className="inline-actions">{!user.employee && <><Can policy={adminPermissionPolicies.users.update}><Button variant="ghost" icon="edit" onClick={() => setEditing(user)}>{t("pages.accounts.048")}</Button></Can><Can policy={adminPermissionPolicies.users.linkEmployee}><Button variant="ghost" onClick={() => setLinkUser(user)}>{t("pages.admin.068")}</Button></Can></>}<Can policy={adminPermissionPolicies.users.assignRoles}><Button variant="ghost" onClick={() => setRoleUser(user)}>{t("pages.admin.026")}</Button></Can>{user.status !== "DISABLED" && <Can policy={adminPermissionPolicies.users.disable}><Button variant="ghost" icon="ban" onClick={() => void disable(user)}>{t("pages.accounts.049")}</Button></Can>}</div></td></tr>)}</tbody></table></div>}<Pagination page={page} totalPages={totalPages} total={total} onChange={setPage}/>{editing && allows(permissionSet, editing === "new" ? adminPermissionPolicies.users.create : adminPermissionPolicies.users.update) && <UserForm user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); notify(t("pages.admin.028")); await load(); }}/>} {linkUser && allows(permissionSet, adminPermissionPolicies.users.linkEmployee) && <EmployeeLinkForm user={linkUser} onClose={() => setLinkUser(null)} onSaved={async () => { setLinkUser(null); notify(t("pages.admin.069")); await load(); }}/>} {roleUser && canAssignRoles && <UserRoles user={roleUser} roles={roles} onClose={() => setRoleUser(null)} onSaved={async () => { setRoleUser(null); notify(t("pages.admin.029")); await load(); }}/>}</>;
}

function UserForm({ user, onClose, onSaved }: { user: AdminUser | null; onClose: () => void; onSaved: () => void }) {
  const { permissionSet } = useAuthorization();
  const policy = user ? adminPermissionPolicies.users.update : adminPermissionPolicies.users.create;
  const authorized = allows(permissionSet, policy);
  const [nameAr, setNameAr] = useState(user?.nameAr ?? ""), [nameEn, setNameEn] = useState(user?.nameEn ?? ""), [email, setEmail] = useState(user?.email ?? ""), [password, setPassword] = useState(""), [employeeId, setEmployeeId] = useState(""), [employees, setEmployees] = useState<EmployeeAccountOption[]>([]), [loadingEmployees, setLoadingEmployees] = useState(!user), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => { if (user || !authorized) return; void api<{ data: EmployeeAccountOption[] }>("/users/employee-options").then((result) => { setEmployees(result.data); setEmployeeId(result.data[0]?.id ?? ""); }).catch((cause) => setError(cause instanceof Error ? cause.message : t("pages.admin.070"))).finally(() => setLoadingEmployees(false)); }, [authorized, user]);
  async function submit(e: FormEvent) { e.preventDefault(); if (!allows(permissionSet, policy)) return; setSaving(true); setError(""); try { await api(user ? `/users/${user.id}` : "/users", { method: user ? "PATCH" : "POST", ...(user ? {} : { idempotencyKey: idempotencyKey("employee-user", crypto.randomUUID()) }), body: JSON.stringify(user ? { nameAr: nameAr.trim(), nameEn: nameEn.trim() || null } : { employeeId, email: email.trim(), temporaryPassword: password }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.admin.030")); } finally { setSaving(false); } }
  return <Modal title={user ? t("pages.admin.031") : t("pages.admin.017")} description={!user ? t("pages.admin.071") : undefined} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">{user ? <><label><span>{t("pages.accounts.061")}</span><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required/></label><label><span>{t("pages.accounts.055")}</span><input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)}/></label></> : loadingEmployees ? <Spinner label={t("pages.admin.072")}/> : employees.length === 0 ? <div className="inline-notice neutral full">{t("pages.admin.073")}</div> : <><label className="full"><span>{t("pages.admin.066")}</span><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} — {localizedReferenceName(employee)}</option>)}</select></label><label><span>{t("pages.admin.034")}</span><input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required/></label><label><span>{t("pages.admin.035")}</span><input dir="ltr" type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required/><small>{t("pages.admin.036")}</small></label></>}</div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving || (!user && !employeeId)}>{saving ? t("pages.accounts.066") : t("pages.accounts.067")}</Button></div></form></Modal>;
}

function EmployeeLinkForm({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const { permissionSet } = useAuthorization();
  const authorized = allows(permissionSet, adminPermissionPolicies.users.linkEmployee);
  const [employees, setEmployees] = useState<EmployeeAccountOption[]>([]), [employeeId, setEmployeeId] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => { if (!authorized) return; void api<{ data: EmployeeAccountOption[] }>("/users/employee-options").then((result) => { setEmployees(result.data); setEmployeeId(result.data[0]?.id ?? ""); }).catch((cause) => setError(cause instanceof Error ? cause.message : t("pages.admin.070"))).finally(() => setLoading(false)); }, [authorized]);
  async function submit(e: FormEvent) { e.preventDefault(); if (!allows(permissionSet, adminPermissionPolicies.users.linkEmployee) || !employeeId) return; setSaving(true); setError(""); try { await api(`/users/${user.id}/employee-link`, { method: "POST", idempotencyKey: idempotencyKey("employee-user-link", crypto.randomUUID()), body: JSON.stringify({ employeeId }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.admin.074")); } finally { setSaving(false); } }
  return <Modal title={t("pages.admin.068")} description={t("pages.admin.075", { value1: user.email })} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}{loading ? <Spinner label={t("pages.admin.072")}/> : employees.length === 0 ? <div className="inline-notice neutral">{t("pages.admin.073")}</div> : <label><span>{t("pages.admin.066")}</span><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} — {localizedReferenceName(employee)}</option>)}</select></label>}<div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving || !employeeId}>{saving ? t("pages.accounts.066") : t("pages.admin.068")}</Button></div></form></Modal>;
}

function UserRoles({ user, roles, onClose, onSaved }: { user: AdminUser; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { permissionSet } = useAuthorization();
  const authorized = allows(permissionSet, adminPermissionPolicies.users.assignRoles);
  const [selected, setSelected] = useState<string[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => { if (!authorized) return; void api<{ data: UserRole[] }>(`/users/${user.id}/roles`).then((result) => setSelected(result.data.map((item) => item.roleId))).catch((cause) => setError(cause instanceof Error ? cause.message : t("pages.admin.040"))).finally(() => setLoading(false)); }, [authorized, user.id]);
  async function save() { if (!allows(permissionSet, adminPermissionPolicies.users.assignRoles)) return; try { await api(`/users/${user.id}/roles`, { method: "PUT", body: JSON.stringify({ roleIds: selected }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.admin.041")); } }
  return <Modal title={t("pages.admin.042", { value1: localizedReferenceName(user) })} description={t("pages.admin.043")} onClose={onClose}>{loading ? <Spinner/> : <div className="selection-list">{error && <div className="form-error" role="alert">{error}</div>}{roles.map((role) => <label className="check-field" key={role.id}><input type="checkbox" checked={selected.includes(role.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, role.id] : selected.filter((id) => id !== role.id))}/><span><strong>{localizedReferenceName(role)}</strong><small>{role.permissions.length.toLocaleString(activeIntlLocale())}{t("pages.admin.044")}</small></span></label>)}</div>}<div className="form-actions"><Button variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button onClick={() => void save()} disabled={loading}>{t("pages.admin.045")}</Button></div></Modal>;
}

function RolesTab({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const canView = allows(permissionSet, adminPermissionPolicies.tabs.roles);
  const [roles, setRoles] = useState<Role[]>([]), [permissions, setPermissions] = useState<Permission[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [editing, setEditing] = useState<Role | "new" | null>(null);
  const load = useCallback(async () => { if (!canView) { setLoading(false); return; } setLoading(true); try { const [r, p] = await Promise.all([api<{ data: Role[] }>("/roles"), api<{ data: Permission[] }>("/permissions")]); setRoles(r.data); setPermissions(p.data); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.admin.040")); } finally { setLoading(false); } }, [canView]);
  useEffect(() => { void load(); }, [load]);
  async function deactivate(role: Role) { if (!allows(permissionSet, adminPermissionPolicies.roles.manage)) return; const reason = window.prompt(t("pages.admin.046", { value1: localizedReferenceName(role) })); if (!reason || reason.trim().length < 3) return; try { await api(`/roles/${role.id}/deactivate`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }); notify(t("pages.admin.047")); await load(); } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.admin.048"), "error"); } }
  return <>{<div className="toolbar"><p>{t("pages.admin.049")}</p><Can policy={adminPermissionPolicies.roles.manage}><Button icon="plus" onClick={() => setEditing("new")}>{t("pages.admin.050")}</Button></Can></div>}{error ? <div className="error-panel" role="alert">{error}</div> : loading ? <Spinner/> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.admin.051")}</th><th>{t("pages.admin.004")}</th><th>{t("pages.admin.052")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{roles.map((role) => <tr key={role.id}><td><strong>{localizedReferenceName(role)}</strong><small dir="ltr">{role.code}{role.isSystemRole ? t("common.systemRole") : ""}</small></td><td>{role.assignedUsers.toLocaleString(activeIntlLocale())}</td><td>{role.permissions.length.toLocaleString(activeIntlLocale())}</td><td><span className={`status-chip ${role.isActive ? "active" : "inactive"}`}>{role.isActive ? t("pages.accounts.028") : t("pages.accounts.029")}</span></td><td>{!role.isSystemRole && role.isActive && <Can policy={adminPermissionPolicies.roles.manage}><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setEditing(role)}>{t("pages.accounts.048")}</Button><Button variant="ghost" icon="ban" onClick={() => void deactivate(role)}>{t("pages.accounts.049")}</Button></div></Can>}</td></tr>)}</tbody></table></div>}{editing && allows(permissionSet, adminPermissionPolicies.roles.manage) && <RoleForm role={editing === "new" ? null : editing} permissions={permissions} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); notify(t("pages.admin.053")); await load(); }}/>}</>;
}

function RoleForm({ role, permissions, onClose, onSaved }: { role: Role | null; permissions: Permission[]; onClose: () => void; onSaved: () => void }) {
  const { permissionSet } = useAuthorization();
  const [nameAr, setNameAr] = useState(role?.nameAr ?? ""), [nameEn, setNameEn] = useState(role?.nameEn ?? ""), [selected, setSelected] = useState(role?.permissionIds ?? []), [error, setError] = useState("");
  const groups = useMemo(() => Object.entries(permissions.reduce<Record<string, Permission[]>>((result, item) => { (result[item.module] ??= []).push(item); return result; }, {})), [permissions]);
  async function submit(e: FormEvent) { e.preventDefault(); if (!allows(permissionSet, adminPermissionPolicies.roles.manage)) return; setError(""); try { if (role) { await api(`/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ nameAr: nameAr.trim(), nameEn: nameEn.trim() || null }) }); await api(`/roles/${role.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissionIds: selected }) }); } else await api("/roles", { method: "POST", body: JSON.stringify({ nameAr: nameAr.trim(), nameEn: nameEn.trim() || null, permissionIds: selected }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.admin.054")); } }
  return <Modal wide title={role ? t("pages.admin.055") : t("pages.admin.050")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">{role ? <label><span>{t("pages.accounts.059")}</span><input dir="ltr" value={role.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("pages.accounts.061")}</span><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required/></label><label><span>{t("pages.accounts.055")}</span><input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)}/></label><div className="full permission-groups">{groups.map(([module, items]) => <fieldset key={module}><legend>{module}</legend>{items?.map((permission) => <label className="check-field" key={permission.id}><input type="checkbox" checked={selected.includes(permission.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, permission.id] : selected.filter((id) => id !== permission.id))}/><span>{permission.descriptionAr}<small dir="ltr">{permission.code}</small></span></label>)}</fieldset>)}</div></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit">{t("pages.accounts.067")}</Button></div></form></Modal>;
}

function SessionsTab({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const canView = allows(permissionSet, adminPermissionPolicies.tabs.sessions);
  const [sessions, setSessions] = useState<UserSession[]>([]), [loading, setLoading] = useState(true);
  const load = useCallback(async () => { if (!canView) { setLoading(false); return; } setLoading(true); try { setSessions((await api<ListResponse<UserSession>>("/auth/sessions?page=1&pageSize=100")).data); } finally { setLoading(false); } }, [canView]);
  useEffect(() => { void load(); }, [load]);
  async function revoke(item: UserSession) { if (!allows(permissionSet, adminPermissionPolicies.sessions.revoke)) return; try { await api(`/auth/sessions/${item.id}/revoke`, { method: "POST" }); notify(t("pages.admin.057")); await load(); } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.admin.058"), "error"); } }
  return loading ? <Spinner label={t("pages.admin.059")}/> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.admin.060")}</th><th>{t("pages.admin.061")}</th><th>{t("pages.admin.062")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{sessions.map((item) => <tr key={item.id}><td>#{item.id}{item.current && <small>{t("pages.admin.063")}</small>}</td><td>{new Date(item.lastActivityAt).toLocaleString(activeIntlLocale())}</td><td>{new Date(item.expiresAt).toLocaleString(activeIntlLocale())}</td><td><span className={`status-chip ${item.revoked ? "inactive" : "active"}`}>{item.revoked ? t("pages.admin.064") : t("pages.admin.065")}</span></td><td>{!item.current && !item.revoked && <Can policy={adminPermissionPolicies.sessions.revoke}><Button variant="ghost" icon="ban" onClick={() => void revoke(item)}>{t("pages.accounts.065")}</Button></Can>}</td></tr>)}</tbody></table></div>;
}
