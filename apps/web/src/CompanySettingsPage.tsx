import {
  FormEvent,
  useEffect,
  useMemo,
  useState } from "react";
import { api,
  ApiError } from "./api";
import { localizedReferenceName,
  useI18n } from "./i18n";
import type { CompanyCurrencySetting,
  CompanyDetails,
  CompanyExchangeRate,
  PageMeta } from "./types";
import { Button,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CompanySettingsPage({ notify }: { notify: Notice }) {
  const { formatDateTime, formatNumber, t } = useI18n();
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [makerChecker, setMakerChecker] = useState(true);
  const [currencies, setCurrencies] = useState<CompanyCurrencySetting[]>([]);
  const [selectedCurrencyIds, setSelectedCurrencyIds] = useState<string[]>([]);
  const [rates, setRates] = useState<CompanyExchangeRate[]>([]);
  const [rateMeta, setRateMeta] = useState<PageMeta>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [rateCurrencyId, setRateCurrencyId] = useState("");
  const [rateDate, setRateDate] = useState(today());
  const [rate, setRate] = useState("");
  const [rateSource, setRateSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCurrencies, setSavingCurrencies] = useState(false);
  const [showCurrencyForm, setShowCurrencyForm] = useState(false);
  const [currencyCode, setCurrencyCode] = useState("");
  const [currencyName, setCurrencyName] = useState("");
  const [currencyDecimals, setCurrencyDecimals] = useState(2);
  const [creatingCurrency, setCreatingCurrency] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [error, setError] = useState("");

  const enabledForeignCurrencies = useMemo(
    () => currencies.filter((currency) => currency.isEnabled && !currency.isBase),
    [currencies],
  );

  async function loadCurrencyData(page = 1) {
    const [currencyResponse, rateResponse] = await Promise.all([
      api<{ data: CompanyCurrencySetting[] }>("/company-currencies"),
      api<{ data: CompanyExchangeRate[]; meta: PageMeta }>(`/exchange-rates?page=${page}&pageSize=20`),
    ]);
    setCurrencies(currencyResponse.data);
    setSelectedCurrencyIds(currencyResponse.data.filter((currency) => currency.isEnabled).map((currency) => currency.id));
    setRates(rateResponse.data);
    setRateMeta(rateResponse.meta);
    const enabledForeign = currencyResponse.data.find((currency) => currency.isEnabled && !currency.isBase);
    setRateCurrencyId((current) =>
      currencyResponse.data.some((currency) => currency.id === current && currency.isEnabled && !currency.isBase)
        ? current
        : enabledForeign?.id || "",
    );
  }

  useEffect(() => {
    void Promise.all([
      api<CompanyDetails>("/companies/current"),
      api<{ data: Array<{ key: string; value: boolean }> }>("/settings"),
      loadCurrencyData(),
    ])
      .then(([details, settings]) => {
        setCompany(details);
        setName(details.name);
        setTimezone(details.timezone);
        setMakerChecker(settings?.data?.[0]?.value ?? details.manualJournalMakerCheckerEnabled ?? true);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("settings.loadError")))
      .finally(() => setLoading(false));
  }, []);

  async function submitCompany(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await api<CompanyDetails>("/companies/current", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), timezone: timezone.trim() }),
      });
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: [{ key: "accounting.manual_journal_maker_checker_enabled", value: makerChecker }],
        }),
      });
      setCompany(updated);
      notify(t("settings.saveSuccess"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  function toggleCurrency(currency: CompanyCurrencySetting) {
    if (currency.isBase) return;
    setSelectedCurrencyIds((current) =>
      current.includes(currency.id) ? current.filter((id) => id !== currency.id) : [...current, currency.id],
    );
  }

  async function saveCurrencies() {
    setSavingCurrencies(true);
    setError("");
    try {
      await api("/company-currencies", {
        method: "PUT",
        body: JSON.stringify({ currencyIds: selectedCurrencyIds }),
      });
      await loadCurrencyData(rateMeta.page);
      notify(t("settings.currenciesSuccess"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.currenciesError"));
    } finally {
      setSavingCurrencies(false);
    }
  }

  function closeCurrencyForm() {
    setShowCurrencyForm(false);
    setCurrencyCode("");
    setCurrencyName("");
    setCurrencyDecimals(2);
  }

  async function createCurrency(event: FormEvent) {
    event.preventDefault();
    setCreatingCurrency(true);
    setError("");
    try {
      await api<CompanyCurrencySetting>("/company-currencies", {
        method: "POST",
        body: JSON.stringify({
          code: currencyCode.trim().toUpperCase(),
          nameAr: currencyName.trim(),
          decimals: currencyDecimals,
        }),
      });
      await loadCurrencyData(rateMeta.page);
      closeCurrencyForm();
      notify(t("settings.createCurrencySuccess"));
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.reason === "CURRENCY_CODE_EXISTS"
          ? t("settings.currencyCodeExists")
          : cause instanceof Error
            ? cause.message
            : t("settings.createCurrencyError"),
      );
    } finally {
      setCreatingCurrency(false);
    }
  }

  async function saveRate(event: FormEvent) {
    event.preventDefault();
    if (!rateCurrencyId) return;
    setSavingRate(true);
    setError("");
    try {
      const numericRate = Number(rate);
      if (!Number.isFinite(numericRate) || numericRate <= 0) throw new Error(t("settings.positiveRate"));
      await api("/exchange-rates", {
        method: "PUT",
        body: JSON.stringify({
          currencyId: rateCurrencyId,
          rateDate,
          rate: numericRate.toFixed(8),
          source: rateSource.trim() || null,
        }),
      });
      await loadCurrencyData(1);
      setRate("");
      setRateSource("");
      notify(t("settings.rateSuccess"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.rateError"));
    } finally {
      setSavingRate(false);
    }
  }

  if (loading) return <Spinner label={t("settings.loading")} />;

  return (
    <section className="workspace-page">
      <PageHeader kicker={t("settings.kicker")} title={t("settings.title")} description={t("settings.description")} />

      {error && <div className="form-error" role="alert">{error}</div>}

      <form className="settings-card" onSubmit={submitCompany}>
        <div className="form-grid">
          <label>
            <span>{t("settings.companyName")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>{t("settings.timezone")}</span>
            <input dir="ltr" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Riyadh" required />
          </label>
          <label>
            <span>{t("settings.baseCurrency")}</span>
            <input value={`${company?.baseCurrency.code} — ${localizedReferenceName(company?.baseCurrency)}`} disabled />
          </label>
          <label className="check-field full setting-switch">
            <input type="checkbox" checked={makerChecker} onChange={(event) => setMakerChecker(event.target.checked)} />
            <span>
              <strong>{t("settings.makerChecker")}</strong>
              <small>{t("settings.makerCheckerDescription")}</small>
            </span>
          </label>
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("settings.save")}</Button>
        </div>
      </form>

      <section className="settings-card currency-settings-card">
        <div className="card-heading">
          <div>
            <h2>{t("settings.companyCurrencies")}</h2>
            <p>{t("settings.companyCurrenciesDescription")}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            icon="plus"
            aria-expanded={showCurrencyForm}
            onClick={() => setShowCurrencyForm((current) => !current)}
          >
            {t("settings.createCurrency")}
          </Button>
        </div>
        {showCurrencyForm && (
          <form className="currency-create-form" onSubmit={createCurrency}>
            <p>{t("settings.createCurrencyDescription")}</p>
            <label>
              <span>{t("settings.currencyCode")}</span>
              <input
                dir="ltr"
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                minLength={3}
                maxLength={3}
                pattern="[A-Z]{3}"
                placeholder="XYE"
                aria-describedby="currency-code-hint"
                required
              />
              <small id="currency-code-hint">{t("settings.currencyCodeHint")}</small>
            </label>
            <label>
              <span>{t("settings.currencyName")}</span>
              <input value={currencyName} onChange={(event) => setCurrencyName(event.target.value)} minLength={2} maxLength={100} placeholder={t("settings.currencyNamePlaceholder")} required />
            </label>
            <label>
              <span>{t("settings.decimalPlaces")}</span>
              <input dir="ltr" type="number" min={0} max={8} step={1} value={currencyDecimals} onChange={(event) => setCurrencyDecimals(Number(event.target.value))} required />
            </label>
            <div className="currency-create-actions">
              <Button type="button" variant="ghost" disabled={creatingCurrency} onClick={closeCurrencyForm}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={creatingCurrency || currencyCode.length !== 3}>{creatingCurrency ? t("settings.creatingCurrency") : t("settings.createCurrency")}</Button>
            </div>
          </form>
        )}
        <div className="currency-selection-grid">
          {currencies.map((currency) => {
            const checked = selectedCurrencyIds.includes(currency.id) || currency.isBase;
            return (
              <label className={`currency-option${currency.isBase ? " base" : ""}`} key={currency.id}>
                <input type="checkbox" checked={checked} disabled={currency.isBase} onChange={() => toggleCurrency(currency)} />
                <span>
                  <strong dir="ltr">{currency.code}</strong>
                  <small>{localizedReferenceName(currency)}{currency.isBase ? ` — ${t("settings.baseCurrencySuffix")}` : ""}</small>
                  {currency.isCustom && <small className="currency-custom-badge">{t("settings.customCurrencySuffix")}</small>}
                  {!currency.isBase && currency.latestExchangeRate && (
                    <small>{t("settings.latestRate", { rate: currency.latestExchangeRate, date: currency.latestExchangeRateDate ?? "—" })}</small>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className="form-actions">
          <Button type="button" disabled={savingCurrencies} onClick={() => void saveCurrencies()}>
            {savingCurrencies ? t("common.saving") : t("settings.saveCurrencies")}
          </Button>
        </div>
      </section>

      <section className="settings-card currency-settings-card">
        <div className="card-heading">
          <div>
            <h2>{t("settings.exchangeRates")}</h2>
            <p>{t("settings.exchangeRatesDescription")}</p>
          </div>
        </div>
        {enabledForeignCurrencies.length === 0 ? (
          <p className="currency-empty">{t("settings.enableForeignCurrency")}</p>
        ) : (
          <form className="exchange-rate-form" onSubmit={saveRate}>
            <label>
              <span>{t("settings.currency")}</span>
              <select value={rateCurrencyId} onChange={(event) => setRateCurrencyId(event.target.value)} required>
                {enabledForeignCurrencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {localizedReferenceName(currency)}</option>)}
              </select>
            </label>
            <label>
              <span>{t("settings.rateDate")}</span>
              <input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required />
            </label>
            <label>
              <span>{t("settings.rate")}</span>
              <input dir="ltr" type="number" min="0.00000001" step="0.00000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="3.75000000" required />
            </label>
            <label>
              <span>{t("settings.sourceOptional")}</span>
              <input value={rateSource} onChange={(event) => setRateSource(event.target.value)} maxLength={100} placeholder={t("settings.sourcePlaceholder")} />
            </label>
            <Button type="submit" disabled={savingRate}>{savingRate ? t("common.saving") : t("settings.saveRate")}</Button>
          </form>
        )}

        <div className="data-table-wrap currency-rates-table" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
          <table className="data-table">
            <thead><tr><th>{t("settings.currency")}</th><th>{t("settings.date")}</th><th>{t("settings.rate")}</th><th>{t("settings.source")}</th><th>{t("settings.lastUpdated")}</th></tr></thead>
            <tbody>
              {rates.map((item) => (
                <tr key={item.id}>
                  <td><strong dir="ltr">{item.currency.code}</strong><small>{localizedReferenceName(item.currency)}</small></td>
                  <td>{item.rateDate}</td>
                  <td dir="ltr">{item.rate}</td>
                  <td>{item.source || "—"}</td>
                  <td>{item.updatedBy.displayName}<small>{formatDateTime(item.updatedAt)}</small></td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={5}>{t("settings.noRates")}</td></tr>}
            </tbody>
          </table>
        </div>
        {rateMeta.totalPages > 1 && (
          <div className="currency-rate-pagination">
            <Button type="button" variant="secondary" disabled={rateMeta.page <= 1} onClick={() => void loadCurrencyData(rateMeta.page - 1)}>{t("common.previous")}</Button>
            <span>{t("settings.pageOf", { page: formatNumber(rateMeta.page), totalPages: formatNumber(rateMeta.totalPages) })}</span>
            <Button type="button" variant="secondary" disabled={rateMeta.page >= rateMeta.totalPages} onClick={() => void loadCurrencyData(rateMeta.page + 1)}>{t("common.next")}</Button>
          </div>
        )}
      </section>
    </section>
  );
}
