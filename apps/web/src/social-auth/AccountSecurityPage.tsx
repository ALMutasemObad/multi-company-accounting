import { useEffect, useState } from "react";
import {
  socialAccounts,
  startSocialAccountLink,
  unlinkSocialAccount,
  type SocialAccount,
} from "../api";
import { activeIntlLocale, useI18n } from "../i18n";
import { assertRequestActive } from "../request-scope";
import { Button, Spinner } from "../ui";
import "./social-auth.css";

type ProviderSlug = "google" | "apple";

const providerSlug = (provider: SocialAccount["provider"]): ProviderSlug =>
  provider === "GOOGLE" ? "google" : "apple";

export function AccountSecurityPage({ notify }: {
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const { dir, t } = useI18n();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [recentAuthenticationRequired, setRecentAuthenticationRequired] = useState(false);
  const [confirmed, setConfirmed] = useState<SocialAccount["provider"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SocialAccount["provider"] | null>(null);

  async function refresh(signal?: AbortSignal) {
    const result = await socialAccounts({ signal });
    assertRequestActive(signal);
    setAccounts(result.data);
    setRecentAuthenticationRequired(result.recentAuthenticationRequired);
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(location.search);
    const socialResult = params.get("social");
    if (socialResult === "linked" || socialResult === "success") notify(t("accountSecurity.linked"));
    else if (socialResult === "cancelled") notify(t("accountSecurity.cancelled"), "error");
    else if (socialResult === "error") notify(t("accountSecurity.failed"), "error");
    if (params.has("social") || params.has("account")) {
      params.delete("social");
      params.delete("account");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    }
    void refresh(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) notify(error instanceof Error ? error.message : t("accountSecurity.failed"), "error");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function link(account: SocialAccount) {
    if (confirmed !== account.provider) return;
    setBusy(account.provider);
    try {
      const result = await startSocialAccountLink(providerSlug(account.provider));
      location.assign(result.authorizationUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : t("accountSecurity.failed"), "error");
      setBusy(null);
    }
  }

  async function unlink(account: SocialAccount) {
    if (confirmed !== account.provider) return;
    setBusy(account.provider);
    try {
      await unlinkSocialAccount(providerSlug(account.provider));
      await refresh();
      setConfirmed(null);
      notify(t("accountSecurity.unlinked"));
    } catch (error) {
      notify(error instanceof Error ? error.message : t("accountSecurity.failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="workspace-page social-account-security loading"><Spinner /><span>{t("accountSecurity.loading")}</span></div>;

  return (
    <section className="workspace-page social-account-security" dir={dir}>
      <header>
        <h1>{t("accountSecurity.title")}</h1>
        <p>{t("accountSecurity.description")}</p>
      </header>
      {recentAuthenticationRequired && <p className="social-account-warning" role="alert">{t("accountSecurity.recentRequired")}</p>}
      <div className="social-account-grid">
        {accounts.map((account) => {
          const linked = account.status === "LINKED";
          const selected = confirmed === account.provider;
          return (
            <article className="social-account-card" key={account.provider}>
              <div>
                <h2>{t(account.provider === "GOOGLE" ? "accountSecurity.google" : "accountSecurity.apple")}</h2>
                <p>{linked ? t("accountSecurity.connected") : t("accountSecurity.notConnected")}</p>
                {account.linkedAt && <p>{t("accountSecurity.linkedAt", { date: new Intl.DateTimeFormat(activeIntlLocale(), { dateStyle: "medium" }).format(new Date(account.linkedAt)) })}</p>}
              </div>
              <label className="social-account-consent">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={recentAuthenticationRequired || busy !== null}
                  onChange={(event) => setConfirmed(event.target.checked ? account.provider : null)}
                />
                <span>{t(linked ? "accountSecurity.confirmUnlink" : "accountSecurity.confirmLink")}</span>
              </label>
              <Button
                type="button"
                variant={linked ? "secondary" : "primary"}
                disabled={!selected || recentAuthenticationRequired || busy !== null}
                onClick={() => void (linked ? unlink(account) : link(account))}
              >
                {busy === account.provider
                  ? t("accountSecurity.working")
                  : t(linked ? "accountSecurity.unlink" : "accountSecurity.link")}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
