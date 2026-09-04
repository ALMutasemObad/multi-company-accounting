import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "./api";
import { formatCurrencyDecimal } from "./decimal-format";
import { useI18n } from "./i18n";
import type {
  OrganizationDashboard,
  OrganizationDashboardCompany,
  OrganizationMember,
  OrganizationMembershipRole,
  OrganizationWorkspaceReference,
} from "./types";
import { Button, EmptyState, Icon, PageHeader, Spinner } from "./ui";
import "./organization-owner.css";

const roles: OrganizationMembershipRole[] = ["OWNER", "ADMIN", "VIEWER"];

export function OrganizationOwnerPage({
  onSwitchCompany,
  notify,
}: {
  onSwitchCompany: (company: OrganizationDashboardCompany) => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const { formatNumber, intlLocale, t } = useI18n();
  const [workspaces, setWorkspaces] = useState<OrganizationWorkspaceReference[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [dashboard, setDashboard] = useState<OrganizationDashboard | null>(null);
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [switchingId, setSwitchingId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ data: OrganizationWorkspaceReference[] }>("/organizations/workspaces", { signal: controller.signal })
      .then((result) => {
        setWorkspaces(result.data);
        setOrganizationId((current) => current || result.data[0]?.id || "");
        setError("");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("organization.loadError"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [t]);

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<OrganizationDashboard>(`/organizations/${organizationId}/dashboard?days=${days}`, { signal });
      setDashboard(result);
      if (result.organization.canManageMembers) {
        const memberResult = await api<{ data: OrganizationMember[] }>(`/organizations/${organizationId}/members`, { signal });
        setMembers(memberResult.data);
      } else {
        setMembers(null);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("organization.loadError"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [days, organizationId, t]);

  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    setDashboard(null);
    setMembers(null);
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard, organizationId]);

  const totals = useMemo(() => ({
    documents: dashboard?.companies.reduce((sum, company) => sum + (company.postedDocuments ?? 0), 0) ?? 0,
    companies: dashboard?.companies.length ?? 0,
  }), [dashboard]);

  if (loading && !workspaces) return <Spinner label={t("organization.loading")} />;
  if (workspaces?.length === 0) return <EmptyState title={t("organization.emptyTitle")} description={t("organization.emptyDescription")} />;

  return <section className="workspace-page organization-owner-page">
    <PageHeader
      kicker={t("organization.kicker")}
      title={t("organization.title")}
      description={t("organization.description")}
      actions={<div className="organization-filters">
        <label><span>{t("organization.select")}</span><select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
          {(workspaces ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select></label>
        <label><span>{t("organization.window")}</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as 30 | 90 | 365)}>
          {[30, 90, 365].map((value) => <option key={value} value={value}>{t("organization.days", { days: value })}</option>)}
        </select></label>
      </div>}
    />

    {error && <div className="form-error" role="alert">{error} <Button variant="ghost" onClick={() => void loadDashboard()}>{t("common.retry")}</Button></div>}
    {loading && !dashboard ? <Spinner label={t("organization.loading")} /> : dashboard && <>
      <div className="organization-summary" aria-label={t("organization.title")}>
        <Summary icon="building" label={t("organization.summary.companies")} value={formatNumber(totals.companies)} />
        <Summary icon="users" label={t("organization.summary.members")} value={formatNumber(dashboard.organization.memberCount)} />
        <Summary icon="document" label={t("organization.summary.documents")} value={formatNumber(totals.documents)} />
        <Summary icon="audit" label={t("organization.summary.role")} value={t(`organization.role.${dashboard.organization.role}`)} />
      </div>

      <aside className="organization-boundary">
        <span><Icon name="audit" size={24} /></span>
        <div><strong>{t("organization.boundary.title")}</strong><p>{t("organization.boundary.description")}</p></div>
      </aside>

      <article className="panel organization-companies">
        <header><div><h2>{t("organization.companies.title")}</h2><p>{t("organization.companies.description")}</p></div><span className="code-pill" dir="ltr">{dashboard.period.from} — {dashboard.period.to}</span></header>
        {dashboard.companies.length ? <div className="organization-company-grid">
          {dashboard.companies.map((company) => <article className="organization-company" key={company.id}>
            <header><div className="organization-company-icon"><Icon name="building" /></div><div><h3>{company.name}</h3><span dir="ltr">{company.code} · {company.baseCurrencyCode}</span></div><span className={`status-chip ${company.isActive ? "active" : "inactive"}`}>{t(company.isActive ? "organization.status.active" : "organization.status.inactive")}</span></header>
            <dl>
              <div><dt>{t("organization.users")}</dt><dd title={!company.metricAccess.activeUsers ? t("organization.metricRestricted") : undefined}>{company.activeUsers === null ? "—" : formatNumber(company.activeUsers)}</dd></div>
              <div><dt>{t("organization.documents")}</dt><dd title={!company.metricAccess.postedDocuments ? t("organization.metricRestricted") : undefined}>{company.postedDocuments === null ? "—" : formatNumber(company.postedDocuments)}</dd></div>
              <div><dt>{t("organization.sales")}</dt><dd dir="ltr" title={!company.metricAccess.postedSales ? t("organization.metricRestricted") : undefined}>{company.postedSalesBase === null ? "—" : formatCurrencyDecimal(company.postedSalesBase, company.baseCurrencyCode, intlLocale)}</dd></div>
              <div><dt>{t("organization.purchases")}</dt><dd dir="ltr" title={!company.metricAccess.postedPurchases ? t("organization.metricRestricted") : undefined}>{company.postedPurchasesBase === null ? "—" : formatCurrencyDecimal(company.postedPurchasesBase, company.baseCurrencyCode, intlLocale)}</dd></div>
            </dl>
            <Button
              variant="secondary"
              icon="back"
              disabled={!company.canSwitch || switchingId !== ""}
              onClick={() => {
                setSwitchingId(company.id);
                void onSwitchCompany(company).catch((cause: unknown) => notify(cause instanceof Error ? cause.message : t("app.chooseCompanyError"), "error")).finally(() => setSwitchingId(""));
              }}
            >{company.canSwitch ? t("organization.openCompany") : t("organization.unavailableCompany")}</Button>
          </article>)}
        </div> : <EmptyState title={t("organization.noCompanies")} description={t("organization.emptyDescription")} />}
      </article>

      {dashboard.organization.canManageMembers && members && <MemberManager
        organizationId={organizationId}
        canManageOwners={dashboard.organization.canManageOwners}
        members={members}
        setMembers={setMembers}
        notify={notify}
      />}
    </>}
  </section>;
}

function Summary({ icon, label, value }: { icon: "building" | "users" | "document" | "audit"; label: string; value: string }) {
  return <article><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function MemberManager({
  organizationId,
  canManageOwners,
  members,
  setMembers,
  notify,
}: {
  organizationId: string;
  canManageOwners: boolean;
  members: OrganizationMember[];
  setMembers: (members: OrganizationMember[]) => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const { formatNumber, t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationMembershipRole>("VIEWER");
  const [busy, setBusy] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const member = await api<OrganizationMember>(`/organizations/${organizationId}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setMembers([...members, member]);
      setEmail("");
      notify(t("organization.members.added"));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("organization.loadError"), "error");
    } finally { setBusy(false); }
  };

  const update = async (member: OrganizationMember, nextRole: OrganizationMembershipRole, isActive: boolean) => {
    setBusy(true);
    try {
      const updated = await api<OrganizationMember>(`/organizations/${organizationId}/members/${member.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole, isActive, version: member.version }),
      });
      setMembers(members.map((item) => item.user.id === updated.user.id ? updated : item));
      notify(t("organization.members.updated"));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("organization.loadError"), "error");
    } finally { setBusy(false); }
  };

  const editableRoles = canManageOwners ? roles : ["VIEWER" as const];
  return <article className="panel organization-members">
    <header><div><h2>{t("organization.members.title")}</h2><p>{t("organization.members.description")}</p></div></header>
    <form className="organization-member-add" onSubmit={(event) => void add(event)}>
      <label><span>{t("organization.members.email")}</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label><span>{t("organization.members.role")}</span><select value={role} onChange={(event) => setRole(event.target.value as OrganizationMembershipRole)}>
        {editableRoles.map((item) => <option key={item} value={item}>{t(`organization.role.${item}`)}</option>)}
      </select></label>
      <Button type="submit" icon="plus" disabled={busy}>{t("organization.members.add")}</Button>
    </form>
    <p className="organization-member-notice"><Icon name="audit" size={18} />{t("organization.members.externalNotice")}</p>
    {members.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("organization.members.email")}</th><th>{t("organization.members.role")}</th><th>{t("organization.status")}</th><th>{t("organization.companies.title")}</th><th /></tr></thead><tbody>
      {members.map((member) => <MemberRow key={member.user.id} member={member} canManageOwners={canManageOwners} busy={busy} onUpdate={update} formatNumber={formatNumber} />)}
    </tbody></table></div> : <p className="organization-members-empty">{t("organization.members.empty")}</p>}
  </article>;
}

function MemberRow({
  member,
  canManageOwners,
  busy,
  onUpdate,
  formatNumber,
}: {
  member: OrganizationMember;
  canManageOwners: boolean;
  busy: boolean;
  onUpdate: (member: OrganizationMember, role: OrganizationMembershipRole, isActive: boolean) => Promise<void>;
  formatNumber: (value: number) => string;
}) {
  const { t } = useI18n();
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.isActive);
  const editable = canManageOwners || member.role === "VIEWER";
  useEffect(() => { setRole(member.role); setActive(member.isActive); }, [member]);
  return <tr>
    <td><strong>{member.user.displayName}</strong><small dir="ltr">{member.user.email}</small></td>
    <td><select aria-label={t("organization.members.role")} disabled={!editable || busy} value={role} onChange={(event) => setRole(event.target.value as OrganizationMembershipRole)}>{(canManageOwners ? roles : ["VIEWER" as const]).map((item) => <option key={item} value={item}>{t(`organization.role.${item}`)}</option>)}</select></td>
    <td><label className="organization-active-toggle"><input type="checkbox" disabled={!editable || busy} checked={active} onChange={(event) => setActive(event.target.checked)} /><span>{t(active ? "organization.members.active" : "organization.members.inactive")}</span></label></td>
    <td>{t("organization.members.companyAccess", { count: formatNumber(member.activeCompanyAccess) })}</td>
    <td><Button variant="ghost" disabled={!editable || busy || (role === member.role && active === member.isActive)} onClick={() => void onUpdate(member, role, active)}>{t("organization.members.save")}</Button></td>
  </tr>;
}
