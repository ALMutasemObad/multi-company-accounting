import { visibleNavigationItems, visibleSystemGroups, type NavigationAccess, type View } from "./app-navigation";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Icon, PageHeader } from "./ui";
import { RetailOnboardingGuide } from "./RetailOnboardingGuide";
import { showRetailGuide, type RetailSetupTarget } from "./retail-onboarding-model";
import "./retail-onboarding-home.css";

export function SystemHomePage({ onNavigate, onOpenSetupTarget }: {
  onNavigate: (view: View) => void;
  onOpenSetupTarget?: (target: RetailSetupTarget) => void;
}) {
  const { t } = useI18n();
  const { moduleSet, permissionSet, selectedCompany, user } = useAuthorization();
  const access: NavigationAccess = {
    moduleSet,
    permissionSet,
    hasSelectedCompany: Boolean(selectedCompany),
    platformOperations: false,
  };
  const groups = visibleSystemGroups(access);
  const visible = visibleNavigationItems(access);
  const pos = visible.find((item) => item.view === "pos");
  const quick = ["inventory", "purchases", "sales", "receipts", "reports"]
    .flatMap((view) => visible.filter((item) => item.view === view));
  // Remount synchronously on identity/access changes: no stale evidence or selected
  // setup action survives a tenant, user, entitlement or permission change.
  const scope = JSON.stringify([user.id, selectedCompany?.id, [...moduleSet].sort(), [...permissionSet].sort()]);
  return (
    <section className="workspace-page system-home-page retail-home">
      <div className="retail-home-hero">
        <div><PageHeader kicker="" title={t("home.title")} description={t("home.introduction")} />
          {selectedCompany && <span className="retail-company"><Icon name="building" size={18} /><bdi>{selectedCompany.name}</bdi></span>}
        </div>
        {pos && <button className="retail-button retail-cashier" type="button" onClick={() => onNavigate("pos")}>
          <Icon name="wallet" size={22} />{t(permissionSet.has("pos.checkout") ? "home.openCashier" : "home.reviewSales")}
        </button>}
      </div>
      {!selectedCompany ? <p className="retail-empty" role="status">{t("home.noCompany")}</p> : <>
      {quick.length > 0 && <nav className="retail-quick-links" aria-label={t("home.dailyWork")}>
        {quick.map((item) => <button type="button" className="retail-button" key={item.view} onClick={() => onNavigate(item.view)}>
          <Icon name={item.icon} size={20} />{t(item.label)}
        </button>)}
      </nav>}
      {showRetailGuide(access) && <RetailOnboardingGuide key={scope} access={access} onNavigate={onNavigate} onOpenSetupTarget={onOpenSetupTarget} />}
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
