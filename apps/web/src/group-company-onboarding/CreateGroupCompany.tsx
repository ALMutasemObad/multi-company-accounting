import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import type { OrganizationDashboardCompany } from "../types";
import { Button, Spinner } from "../ui";
import { confirmedGroupCompanyResult, type GroupCompanyResult } from "./result";

type Options = {
  currencies: Array<{ code: string; nameAr: string }>; timezones: string[];
  countries: Array<{ code: string; nameAr: string; nameEn: string }>;
  businessActivities: Array<{ code: string; nameAr: string; nameEn: string }>;
  chartTemplates: Array<{ code: string; nameAr: string; nameEn: string }>;
};
type Attempt = { key: string; body: string };
type Draft = { companyName: string; timezone: string; baseCurrencyCode: string; phone: string; countryCode: string; primaryBusinessActivityCode: string; chartTemplateCode: string };
const validOptions = (value: Options) => Array.isArray(value?.currencies)
  && value.currencies.every(currency => typeof currency?.code === "string" && typeof currency?.nameAr === "string")
  && Array.isArray(value?.countries) && value.countries.every(country => typeof country?.code === "string")
  && Array.isArray(value?.businessActivities) && value.businessActivities.every(activity => typeof activity?.code === "string")
  && Array.isArray(value?.chartTemplates) && value.chartTemplates.every(template => typeof template?.code === "string")
  && Array.isArray(value?.timezones) && value.timezones.every(zone => typeof zone === "string");

export function CreateGroupCompany({ organizationId, onCreated, onOpenCreated, onPendingChange }: {
  organizationId: string;
  onCreated: (result: GroupCompanyResult) => Promise<OrganizationDashboardCompany | null>;
  onOpenCreated: (company: OrganizationDashboardCompany) => Promise<void>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<GroupCompanyResult | null>(null);
  const [createdCompany, setCreatedCompany] = useState<OrganizationDashboardCompany | null>(null);
  const [draft, setDraft] = useState<Draft>({ companyName: "", timezone: "", baseCurrencyCode: "", phone: "", countryCode: "", primaryBusinessActivityCode: "", chartTemplateCode: "" });
  const mounted = useRef(true);
  const flight = useRef(false);
  const optionsGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const [reload, setReload] = useState(0);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    const generation = ++optionsGeneration.current;
    const controller = new AbortController();
    api<Options>(`/organizations/${organizationId}/company-options`, { signal: controller.signal })
      .then(value => {
        if (!validOptions(value)) throw new Error(t("organization.create.failed"));
        if (!controller.signal.aborted && generation === optionsGeneration.current) {
          setOptions(value);
          setDraft(current => ({
            companyName: current.companyName,
            timezone: value.timezones.includes(current.timezone) ? current.timezone : value.timezones.includes(Intl.DateTimeFormat().resolvedOptions().timeZone) ? Intl.DateTimeFormat().resolvedOptions().timeZone : value.timezones[0] ?? "UTC",
            baseCurrencyCode: value.currencies.some(currency => currency.code === current.baseCurrencyCode) ? current.baseCurrencyCode : value.currencies[0]?.code ?? "",
            phone: current.phone,
            countryCode: value.countries.some(country => country.code === current.countryCode) ? current.countryCode : value.countries.find(country => country.code === "YE")?.code ?? value.countries[0]?.code ?? "",
            primaryBusinessActivityCode: value.businessActivities.some(activity => activity.code === current.primaryBusinessActivityCode) ? current.primaryBusinessActivityCode : value.businessActivities[0]?.code ?? "",
            chartTemplateCode: value.chartTemplates.some(template => template.code === current.chartTemplateCode) ? current.chartTemplateCode : value.chartTemplates[0]?.code ?? "",
          }));
          setError("");
        }
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted && generation === optionsGeneration.current) setError(cause instanceof Error ? cause.message : t("organization.create.failed")); });
    return () => { controller.abort(); };
  }, [organizationId, reload, t]);

  const refreshCreatedCompany = useCallback(async (created: GroupCompanyResult) => {
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    setRefreshError("");
    try {
      const company = await onCreated(created);
      if (!mounted.current || generation !== refreshGeneration.current) return;
      setCreatedCompany(company);
      if (!company) setRefreshError(t("organization.create.refreshMissing"));
    } catch {
      if (mounted.current && generation === refreshGeneration.current) setRefreshError(t("organization.create.refreshFailed"));
    } finally {
      if (mounted.current && generation === refreshGeneration.current) setRefreshing(false);
    }
  }, [onCreated, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current || result) return;
    const request = attempt ?? { key: crypto.randomUUID(), body: JSON.stringify({ ...draft, companyName: draft.companyName.trim() }) };
    flight.current = true;
    onPendingChange(true);
    setAttempt(request);
    setBusy(true);
    setError("");
    try {
      const response = await api<unknown>(`/organizations/${organizationId}/companies`, {
        method: "POST", headers: { "Idempotency-Key": request.key }, body: request.body,
      });
      const created = confirmedGroupCompanyResult(response, organizationId);
      if (mounted.current) {
        setResult(created);
        onPendingChange(false);
        void refreshCreatedCompany(created);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : t("organization.create.failed"));
        if (cause instanceof ApiError && [400, 401, 403, 422].includes(cause.status)) {
          setAttempt(null);
          onPendingChange(false);
        }
      }
    } finally { flight.current = false; if (mounted.current) setBusy(false); }
  }

  async function openCreatedCompany() {
    if (!createdCompany || opening) return;
    setOpening(true);
    setRefreshError("");
    try { await onOpenCreated(createdCompany); }
    catch { if (mounted.current) setRefreshError(t("organization.create.openFailed")); }
    finally { if (mounted.current) setOpening(false); }
  }

  return <article id="group-company-create" className="panel group-company-create">
    <h2>{t("organization.create.title")}</h2>
    <p>{t("organization.create.description")}</p>
    <p className="group-company-boundary">{t("organization.create.boundary")}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {result ? <div className="group-company-result" role="status"><strong>{t("organization.create.created", { name: result.company.name })}</strong><p>{createdCompany ? t("organization.create.openReady") : t("organization.create.openHint")}</p>{refreshError && <div className="form-error" role="alert">{refreshError}</div>}<div className="group-company-result-actions">{createdCompany && <Button variant="secondary" disabled={opening} onClick={() => void openCreatedCompany()}>{opening ? t("common.loading") : t("organization.openCompany")}</Button>}<Button variant="ghost" disabled={refreshing} onClick={() => void refreshCreatedCompany(result)}>{refreshing ? t("common.loading") : t("organization.create.refresh")}</Button><Button variant="ghost" disabled={refreshing || opening} onClick={() => { setResult(null); setCreatedCompany(null); setAttempt(null); setError(""); setRefreshError(""); setDraft({ companyName: "", timezone: options?.timezones[0] ?? "UTC", baseCurrencyCode: options?.currencies[0]?.code ?? "", phone: "", countryCode: options?.countries.find(country => country.code === "YE")?.code ?? options?.countries[0]?.code ?? "", primaryBusinessActivityCode: options?.businessActivities[0]?.code ?? "", chartTemplateCode: options?.chartTemplates[0]?.code ?? "" }); }}>{t("organization.create.another")}</Button></div></div> : <>
      {!options ? error ? <Button onClick={() => setReload(value => value + 1)}>{t("common.retry")}</Button> : <Spinner label={t("organization.loading")} /> :
        <form onSubmit={event => void submit(event)}>
          <fieldset disabled={attempt !== null}>
            <label><span>{t("registration.companyName")}</span><input name="companyName" required maxLength={200} value={draft.companyName} onChange={event => setDraft(current => ({ ...current, companyName: event.target.value }))} /></label>
            <label><span>{t("companyProfile.phone")}</span><input name="phone" type="tel" dir="ltr" required minLength={5} maxLength={40} value={draft.phone} onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} /></label>
            <label><span>{t("companyProfile.country")}</span><select name="countryCode" required value={draft.countryCode} onChange={event => setDraft(current => ({ ...current, countryCode: event.target.value }))}>{options.countries.map(country => <option key={country.code} value={country.code}>{country.code} — {country.nameAr}</option>)}</select></label>
            <label><span>{t("companyProfile.primaryActivity")}</span><select name="primaryBusinessActivityCode" required value={draft.primaryBusinessActivityCode} onChange={event => setDraft(current => ({ ...current, primaryBusinessActivityCode: event.target.value }))}>{options.businessActivities.map(activity => <option key={activity.code} value={activity.code}>{activity.nameAr}</option>)}</select></label>
            <label><span>{t("registration.chartTemplate")}</span><select name="chartTemplateCode" required value={draft.chartTemplateCode} onChange={event => setDraft(current => ({ ...current, chartTemplateCode: event.target.value }))}>{options.chartTemplates.map(template => <option key={template.code} value={template.code}>{template.nameAr}</option>)}</select></label>
            <label><span>{t("registration.timezone")}</span><select name="timezone" value={draft.timezone} onChange={event => setDraft(current => ({ ...current, timezone: event.target.value }))}>{options.timezones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
            <label><span>{t("registration.baseCurrency")}</span><select name="baseCurrencyCode" required value={draft.baseCurrencyCode} onChange={event => setDraft(current => ({ ...current, baseCurrencyCode: event.target.value }))}>{options.currencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} — {currency.nameAr}</option>)}</select></label>
          </fieldset>
          {attempt && <p role="status">{t("organization.create.retryHint")}</p>}
          <Button type="submit" disabled={busy || options.currencies.length === 0 || options.businessActivities.length === 0 || options.chartTemplates.length === 0}>{busy ? t("common.saving") : attempt ? t("common.retry") : t("organization.create.submit")}</Button>
        </form>}
    </>}
  </article>;
}
