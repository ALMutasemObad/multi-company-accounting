import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/noto-kufi-arabic/arabic-400.css";
import "@fontsource/noto-kufi-arabic/arabic-500.css";
import "@fontsource/noto-kufi-arabic/arabic-600.css";
import "@fontsource/noto-kufi-arabic/arabic-700.css";
import "@fontsource/noto-sans-arabic/arabic-400.css";
import "@fontsource/noto-sans-arabic/arabic-500.css";
import "@fontsource/noto-sans-arabic/arabic-600.css";
import "@fontsource/noto-sans-arabic/arabic-700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import App from "./App";
import { storageKey } from "./branding";
import { I18nProvider, loadLocale, resolveLocale } from "./i18n";
import "./styles.css";

async function bootstrap() {
  const requestedLocale = resolveLocale(window.localStorage.getItem(storageKey("locale")));
  await loadLocale("ar");
  if (requestedLocale !== "ar") {
    try {
      await loadLocale(requestedLocale);
    } catch (error) {
      window.localStorage.setItem(storageKey("locale"), "ar");
      console.error("initial_locale_dictionary_load_failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    }
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error("application_bootstrap_failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
});
