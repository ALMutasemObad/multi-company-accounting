import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/500.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import { storageKey } from "./branding";
import { I18nProvider, loadLocale, resolveLocale } from "./i18n";
import { readLocalStorageItem, writeLocalStorageItem } from "./safe-local-storage";
import { captureSubscriptionPlanPreference, isPublicPlansLocation } from "./public-plans";
import { Spinner } from "./ui";
import { useI18n } from "./i18n";
import "./styles.css";

const App = lazy(() => import("./App"));
const PublicPlansPage = lazy(() => import("./PublicPlansPage").then((module) => ({ default: module.PublicPlansPage })));

function EntryPage() {
  const { t } = useI18n();
  const [publicPage, setPublicPage] = useState(() => isPublicPlansLocation(location.pathname, location.hash));
  useEffect(() => {
    const route = () => {
      captureSubscriptionPlanPreference(location.hash);
      setPublicPage(isPublicPlansLocation(location.pathname, location.hash));
    };
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    return () => { window.removeEventListener("hashchange", route); window.removeEventListener("popstate", route); };
  }, []);
  return <Suspense fallback={<Spinner label={t("common.loading")} />}>{publicPage ? <PublicPlansPage /> : <App />}</Suspense>;
}

async function bootstrap() {
  let initialLocale = resolveLocale(readLocalStorageItem(storageKey("locale")));
  await loadLocale("ar");
  if (initialLocale !== "ar") {
    try {
      await loadLocale(initialLocale);
    } catch (error) {
      initialLocale = "ar";
      writeLocalStorageItem(storageKey("locale"), initialLocale);
      console.error("initial_locale_dictionary_load_failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider initialLocale={initialLocale}>
        <EntryPage />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error("application_bootstrap_failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
});
