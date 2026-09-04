import {
  companyQuickStarts,
  isNavigationItemVisible,
  visibleNavigationItems,
  visibleSystemGroups,
  type NavigationAccess,
  type View,
} from "./app-navigation";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Button, Icon, PageHeader } from "./ui";
import { RetailOnboardingGuide } from "./RetailOnboardingGuide";
import { showRetailGuide, type RetailSetupTarget } from "./retail-onboarding-model";
import "./retail-onboarding-home.css";

export function SystemHomePage({
  onNavigate,
  onOpenSetupTarget,
  platformOperator,
}: {
  onNavigate: (view: View) => void;
  onOpenSetupTarget?: (target: RetailSetupTarget) => void;
  platformOperator?: boolean;
}) {
  const { t } = useI18n();
  const { moduleSet, permissionSet, selectedCompany, user } = useAuthorization();
  const access: NavigationAccess = {
    moduleSet,
    permissionSet,
    hasSelectedCompany: Boolean(selectedCompany),
    platformOperations: platformOperator === true,
  };
  const groups = visibleSystemGroups(access);
  const visible = visibleNavigationItems(access);
  const pos = visible.find((item) => item.view === "pos");
  const dashboard = visible.find((item) => item.view === "dashboard");
  const quickStarts = companyQuickStarts.filter((item) => isNavigationItemVisible(item, access));
  // Remount synchronously on identity/access changes: no stale evidence or selected
  // setup action survives a tenant, user, entitlement or permission change.
  const scope = JSON.stringify([user.id, selectedCompany?.id, [...moduleSet].sort(), [...permissionSet].sort()]);

  return (
    <section className="workspace-page system-home-page retail-home">
      <div className="system-home-hero">
        <PageHeader
          kicker={t("home.kicker")}
          title={t("home.title")}
          description={t("home.introduction")}
          actions={(dashboard || pos) ? <div className="home-hero-actions">
            {dashboard && <Button onClick={() => onNavigate("dashboard")} icon="dashboard">{t("home.openDashboard")}</Button>}
            {pos && <Button className="retail-cashier" variant="secondary" onClick={() => onNavigate("pos")} icon="wallet">{t(permissionSet.has("pos.checkout") ? "home.openCashier" : "home.reviewSales")}</Button>}
          </div> : undefined}
        />
        {selectedCompany && <span className="retail-company"><Icon name="building" size={18} /><bdi>{selectedCompany.name}</bdi></span>}
      </div>

      {!selectedCompany ? <p className="retail-empty" role="status">{t("home.noCompany")}</p> : <>
        {quickStarts.length > 0 && <section className="home-quick-section" aria-labelledby="home-quick-title">
          <header>
            <div>
              <span className="section-kicker">{t("home.quick.kicker")}</span>
              <h2 id="home-quick-title">{t("home.quick.title")}</h2>
              <p>{t("home.quick.description")}</p>
            </div>
          </header>
          <div className="home-quick-grid">
            {quickStarts.map((item) => (
              <button
                type="button"
                className="home-quick-card"
                key={item.view}
                onClick={() => onNavigate(item.view)}
                aria-label={t("home.quick.open", { value1: t(item.label) })}
              >
                <span className="home-quick-icon"><Icon name={item.icon} size={23} /></span>
                <span className="home-quick-copy"><strong>{t(item.title)}</strong><span>{t(item.description)}</span></span>
                <small>{t(item.path)}</small>
                <Icon name="back" size={18} />
              </button>
            ))}
          </div>
        </section>}

        {showRetailGuide(access) && <RetailOnboardingGuide key={scope} access={access} onNavigate={onNavigate} onOpenSetupTarget={onOpenSetupTarget} />}

        {platformOperator && <aside className="home-platform-entry" aria-label={t("home.platform.aria")}>
          <span className="home-platform-entry-icon"><Icon name="platform" size={28} /></span>
          <div>
            <span className="section-kicker">{t("home.platform.kicker")}</span>
            <h2>{t("home.platform.title")}</h2>
            <p>{t("home.platform.description")}</p>
          </div>
          <Button variant="secondary" icon="platform" onClick={() => onNavigate("platform")}>{t("home.platform.open")}</Button>
        </aside>}

        <header className="retail-directory-header"><h2>{t("home.directory")}</h2><p>{t("home.directoryDescription")}</p></header>
        {groups.length === 0 && <p className="retail-empty" role="status">{t("home.noModules")}</p>}
        {groups.map((group) => (
          <section className="system-group" key={group.key} aria-labelledby={`system-group-${group.key}`}>
            <header>
              <div>
                <h2 id={`system-group-${group.key}`}>{t(group.title)}</h2>
                <p>{t(group.description)}</p>
              </div>
              <span>{t("home.moduleCount", { value1: group.modules.length })}</span>
            </header>
            <div className="system-card-grid">
              {group.modules.map((module) => (
                <button
                  type="button"
                  className="system-card"
                  key={module.view}
                  onClick={() => onNavigate(module.view)}
                  aria-label={t("home.openModule", { value1: t(module.label) })}
                >
                  <span className={`system-card-icon ${group.key}`}><Icon name={module.icon} size={25} /></span>
                  <span className="system-card-copy">
                    <strong>{t(module.label)}</strong>
                    <span>{t(module.description)}</span>
                  </span>
                  <span className="system-card-open">{t("home.open")}<Icon name="back" size={16} /></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </>}
    </section>
  );
}
