import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import { Button, Spinner } from "../ui";
import { confirmedGroupCompanyResult, type GroupCompanyResult } from "./result";

type Options = { currencies: Array<{ code: string; nameAr: string }>; timezones: string[] };
type Attempt = { key: string; body: string };

export function CreateGroupCompany({ organizationId, onCreated, onPendingChange }: { organizationId: string; onCreated: () => Promise<void>; onPendingChange: (pending: boolean) => void }) {
  const { t } = useI18n();
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<GroupCompanyResult | null>(null);
  const active = useRef(true);
  const flight = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    api<Options>(`/organizations/${organizationId}/company-options`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setOptions(value); setError(""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("organization.create.failed")); });
    return () => { active.current = false; controller.abort(); };
  }, [organizationId, reload, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current || result) return;
    const fields = new FormData(event.currentTarget);
    const request = attempt ?? { key: crypto.randomUUID(), body: JSON.stringify({
      companyName: String(fields.get("companyName")).trim(), timezone: String(fields.get("timezone")), baseCurrencyCode: String(fields.get("baseCurrencyCode")),
    }) };
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
      if (active.current) {
        setResult(created);
        onPendingChange(false);
        // A refresh failure must never turn a committed create into a new request.
        await onCreated();
      }
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : t("organization.create.failed"));
        if (cause instanceof ApiError && [400, 401, 403, 422].includes(cause.status)) {
          setAttempt(null);
          onPendingChange(false);
        }
      }
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }

  return <article className="panel group-company-create">
    <h2>{t("organization.create.title")}</h2>
    <p>{t("organization.create.description")}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {result ? <div role="status"><strong>{t("organization.create.created", { name: result.company.name })}</strong><p>{t("organization.create.openHint")}</p><Button variant="secondary" onClick={() => void onCreated()}>{t("common.refresh")}</Button><Button variant="ghost" onClick={() => { setResult(null); setAttempt(null); setError(""); }}>{t("organization.create.title")}</Button></div> : <>
      {!options ? error ? <Button onClick={() => setReload(value => value + 1)}>{t("common.retry")}</Button> : <Spinner label={t("organization.loading")} /> :
        <form onSubmit={event => void submit(event)}>
          <fieldset disabled={attempt !== null}>
            <label><span>{t("registration.companyName")}</span><input name="companyName" required maxLength={200} /></label>
            <label><span>{t("registration.timezone")}</span><select name="timezone" defaultValue={options.timezones.includes(Intl.DateTimeFormat().resolvedOptions().timeZone) ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"}>{options.timezones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
            <label><span>{t("registration.baseCurrency")}</span><select name="baseCurrencyCode" required>{options.currencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} — {currency.nameAr}</option>)}</select></label>
          </fieldset>
          {attempt && <p role="status">{t("organization.create.retryHint")}</p>}
          <Button type="submit" disabled={busy || options.currencies.length === 0}>{busy ? t("common.saving") : attempt ? t("common.retry") : t("organization.create.submit")}</Button>
        </form>}
    </>}
  </article>;
}
