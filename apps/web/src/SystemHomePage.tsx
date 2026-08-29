import { visibleSystemGroups, type View } from "./app-navigation";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Icon, PageHeader } from "./ui";

export function SystemHomePage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { t } = useI18n();
  const { permissionSet, selectedCompany } = useAuthorization();
  const groups = visibleSystemGroups({
    permissionSet,
    hasSelectedCompany: Boolean(selectedCompany),
    platformOperations: false,
  });
  return (
    <section className="workspace-page system-home-page">
      <div className="system-home-hero">
        <PageHeader
          kicker={t("home.kicker")}
          title={t("home.title")}
          description={t("home.description")}
        />
        <div className="home-hero-badge"><Icon name="home" size={26} /><span>{t("home.badge")}</span></div>
      </div>
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
                  <small>{t(module.description)}</small>
                </span>
                <span className="system-card-open">{t("home.open")}<Icon name="back" size={16} /></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
