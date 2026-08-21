import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { CompanyCurrencySetting, CompanyDetails, CompanyExchangeRate, PageMeta } from "./types";
import { Button, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CompanySettingsPage({ notify }: { notify: Notice }) {
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
        setMakerChecker(settings.data[0]?.value ?? true);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "تعذر تحميل الإعدادات."))
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
      notify("تم حفظ إعدادات الشركة وتسجيل التغيير.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ الإعدادات.");
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
      notify("تم تحديث العملات المتاحة لهذه الشركة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحديث العملات.");
    } finally {
      setSavingCurrencies(false);
    }
  }

  async function saveRate(event: FormEvent) {
    event.preventDefault();
    if (!rateCurrencyId) return;
    setSavingRate(true);
    setError("");
    try {
      const numericRate = Number(rate);
      if (!Number.isFinite(numericRate) || numericRate <= 0) throw new Error("يجب أن يكون سعر الصرف رقمًا موجبًا.");
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
      notify("تم حفظ سعر الصرف وتسجيل العملية.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ سعر الصرف.");
    } finally {
      setSavingRate(false);
    }
  }

  if (loading) return <Spinner label="جارٍ تحميل إعدادات الشركة" />;

  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">إعدادات مساحة العمل</span>
          <h1>إعدادات الشركة</h1>
          <p>البيانات الأساسية والضوابط المحاسبية والعملات المطبقة على الشركة الحالية فقط.</p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <form className="settings-card" onSubmit={submitCompany}>
        <div className="form-grid">
          <label>
            <span>اسم الشركة</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>المنطقة الزمنية (IANA)</span>
            <input dir="ltr" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Riyadh" required />
          </label>
          <label>
            <span>العملة الأساسية</span>
            <input value={`${company?.baseCurrency.code} — ${company?.baseCurrency.nameAr}`} disabled />
          </label>
          <label className="check-field full setting-switch">
            <input type="checkbox" checked={makerChecker} onChange={(event) => setMakerChecker(event.target.checked)} />
            <span>
              <strong>فصل منشئ القيد عن مرحّله</strong>
              <small>عند التفعيل لا يستطيع منشئ القيد اليدوي ترحيله بنفسه، حتى لو امتلك صلاحية الترحيل.</small>
            </span>
          </label>
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ الإعدادات"}</Button>
        </div>
      </form>

      <section className="settings-card currency-settings-card">
        <div className="card-heading">
          <div>
            <h2>عملات الشركة</h2>
            <p>اختر العملات التي يسمح بإصدار المستندات بها. لا يمكن تعطيل العملة الأساسية.</p>
          </div>
        </div>
        <div className="currency-selection-grid">
          {currencies.map((currency) => {
            const checked = selectedCurrencyIds.includes(currency.id) || currency.isBase;
            return (
              <label className={`currency-option${currency.isBase ? " base" : ""}`} key={currency.id}>
                <input type="checkbox" checked={checked} disabled={currency.isBase} onChange={() => toggleCurrency(currency)} />
                <span>
                  <strong dir="ltr">{currency.code}</strong>
                  <small>{currency.nameAr}{currency.isBase ? " — العملة الأساسية" : ""}</small>
                  {!currency.isBase && currency.latestExchangeRate && (
                    <small>آخر سعر: {currency.latestExchangeRate} في {currency.latestExchangeRateDate}</small>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className="form-actions">
          <Button type="button" disabled={savingCurrencies} onClick={() => void saveCurrencies()}>
            {savingCurrencies ? "جارٍ الحفظ…" : "حفظ العملات"}
          </Button>
        </div>
      </section>

      <section className="settings-card currency-settings-card">
        <div className="card-heading">
          <div>
            <h2>أسعار الصرف</h2>
            <p>أدخل قيمة وحدة واحدة من العملة الأجنبية مقابل العملة الأساسية، مع تاريخ المصدر.</p>
          </div>
        </div>
        {enabledForeignCurrencies.length === 0 ? (
          <p className="currency-empty">فعّل عملة أجنبية أولًا لإضافة سعر صرف لها.</p>
        ) : (
          <form className="exchange-rate-form" onSubmit={saveRate}>
            <label>
              <span>العملة</span>
              <select value={rateCurrencyId} onChange={(event) => setRateCurrencyId(event.target.value)} required>
                {enabledForeignCurrencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {currency.nameAr}</option>)}
              </select>
            </label>
            <label>
              <span>تاريخ السعر</span>
              <input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required />
            </label>
            <label>
              <span>سعر الصرف</span>
              <input dir="ltr" type="number" min="0.00000001" step="0.00000001" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="3.75000000" required />
            </label>
            <label>
              <span>المصدر (اختياري)</span>
              <input value={rateSource} onChange={(event) => setRateSource(event.target.value)} maxLength={100} placeholder="البنك المركزي" />
            </label>
            <Button type="submit" disabled={savingRate}>{savingRate ? "جارٍ الحفظ…" : "حفظ السعر"}</Button>
          </form>
        )}

        <div className="data-table-wrap currency-rates-table">
          <table className="data-table">
            <thead><tr><th>العملة</th><th>التاريخ</th><th>السعر</th><th>المصدر</th><th>آخر تحديث</th></tr></thead>
            <tbody>
              {rates.map((item) => (
                <tr key={item.id}>
                  <td><strong dir="ltr">{item.currency.code}</strong><small>{item.currency.nameAr}</small></td>
                  <td>{item.rateDate}</td>
                  <td dir="ltr">{item.rate}</td>
                  <td>{item.source || "—"}</td>
                  <td>{item.updatedBy.displayName}<small>{new Date(item.updatedAt).toLocaleString("ar-SA")}</small></td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={5}>لا توجد أسعار صرف مسجلة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
        {rateMeta.totalPages > 1 && (
          <div className="currency-rate-pagination">
            <Button type="button" variant="secondary" disabled={rateMeta.page <= 1} onClick={() => void loadCurrencyData(rateMeta.page - 1)}>السابق</Button>
            <span>صفحة {rateMeta.page.toLocaleString("ar-SA")} من {rateMeta.totalPages.toLocaleString("ar-SA")}</span>
            <Button type="button" variant="secondary" disabled={rateMeta.page >= rateMeta.totalPages} onClick={() => void loadCurrencyData(rateMeta.page + 1)}>التالي</Button>
          </div>
        )}
      </section>
    </section>
  );
}
