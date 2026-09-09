import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { localizedReferenceName, useI18n, type TranslationKey } from "../i18n";
import type { CompanyComplianceResponse, CompanyProfileResponse } from "../types";
import { Button, Spinner } from "../ui";
import "./company-profile.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type View = "business" | "compliance";

function requirementKey(code: string): TranslationKey {
  const keys: Record<string, TranslationKey> = {
    TRADE_NAME: "companyProfile.requirement.tradeName",
    COUNTRY: "companyProfile.requirement.country",
    PRIMARY_BUSINESS_ACTIVITY: "companyProfile.requirement.activity",
    BUSINESS_PHONE: "companyProfile.requirement.phone",
    LEGAL_NAME: "companyProfile.requirement.legalName",
    COMMERCIAL_REGISTRATION: "companyProfile.requirement.commercialRegistration",
    NATIONAL_ADDRESS: "companyProfile.requirement.nationalAddress",
    TAX_REGISTRATION: "companyProfile.requirement.taxRegistration",
    SA_COMMERCIAL_REGISTRATION: "companyProfile.requirement.saCommercialRegistration",
    SA_VAT_REGISTRATION: "companyProfile.requirement.saVat",
    SA_NATIONAL_ADDRESS: "companyProfile.requirement.saNationalAddress",
  };
  return keys[code] ?? "companyProfile.requirement.other";
}

function statusKey(status: CompanyProfileResponse["readiness"]["requirements"][number]["status"]): TranslationKey {
  if (status === "COMPLETE") return "companyProfile.status.complete";
  if (status === "MISSING") return "companyProfile.status.missing";
  if (status === "NOT_APPLICABLE") return "companyProfile.status.notApplicable";
  return "companyProfile.status.optional";
}

function renewalKey(status: "NOT_APPLICABLE" | "CURRENT" | "DUE_SOON" | "EXPIRED"): TranslationKey {
  if (status === "CURRENT") return "companyProfile.renewal.current";
  if (status === "DUE_SOON") return "companyProfile.renewal.dueSoon";
  if (status === "EXPIRED") return "companyProfile.renewal.expired";
  return "companyProfile.renewal.notApplicable";
}

export function CompanyProfilePanel({ notify }: { notify: Notice }) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<View>("business");
  const [profile, setProfile] = useState<CompanyProfileResponse | null>(null);
  const [compliance, setCompliance] = useState<CompanyComplianceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [commercialNumber, setCommercialNumber] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [commercialIssuedAt, setCommercialIssuedAt] = useState("");
  const [commercialExpiresAt, setCommercialExpiresAt] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [taxType, setTaxType] = useState("TAX_REGISTRATION");
  const [taxIssuedAt, setTaxIssuedAt] = useState("");
  const [taxExpiresAt, setTaxExpiresAt] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [displayAddress, setDisplayAddress] = useState("");

  function applyProfile(value: CompanyProfileResponse) {
    setProfile(value);
    setTradeName(value.profile.tradeName ?? "");
    setCountryCode(value.profile.countryCode ?? value.options.countries[0]?.code ?? "");
    setActivityCode(value.profile.primaryBusinessActivity?.code ?? value.options.activities[0]?.code ?? "");
    setPhone(value.profile.phone ?? ""); setEmail(value.profile.email ?? ""); setWebsite(value.profile.website ?? "");
    setContactName(value.profile.primaryContactName ?? "");
  }

  function applyCompliance(value: CompanyComplianceResponse) {
    setCompliance(value); setLegalName(value.legalName ?? ""); setLegalForm(value.legalForm ?? "");
    setIssuingAuthority(value.commercialRegistration?.issuingAuthority ?? "");
    setCommercialIssuedAt(value.commercialRegistration?.issuedAt ?? ""); setCommercialExpiresAt(value.commercialRegistration?.expiresAt ?? "");
    setTaxType(value.taxRegistration?.registrationType ?? "TAX_REGISTRATION");
    setTaxIssuedAt(value.taxRegistration?.issuedAt ?? ""); setTaxExpiresAt(value.taxRegistration?.expiresAt ?? "");
    setAddressLine1(value.nationalAddress?.line1 ?? ""); setAddressLine2(value.nationalAddress?.line2 ?? "");
    setDistrict(value.nationalAddress?.district ?? ""); setCity(value.nationalAddress?.city ?? "");
    setSubdivision(value.nationalAddress?.subdivision ?? ""); setPostalCode(value.nationalAddress?.postalCode ?? "");
    setDisplayAddress(value.nationalAddress?.displayAddress ?? "");
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<CompanyProfileResponse>("/company-profile", { signal: controller.signal }),
      api<CompanyComplianceResponse>("/company-compliance", { signal: controller.signal }),
    ]).then(([profileValue, complianceValue]) => {
      if (controller.signal.aborted) return;
      applyProfile(profileValue); applyCompliance(complianceValue);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("companyProfile.loadError")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!profile || saving) return;
    setSaving(true); setError("");
    try {
      const value = await api<CompanyProfileResponse>("/company-profile", { method: "PATCH", body: JSON.stringify({
        version: profile.profile.version, tradeName, countryCode, primaryBusinessActivityCode: activityCode,
        preferredLocale: locale, phone, email: email || null, website: website || null, primaryContactName: contactName || null,
      }) });
      applyProfile(value); notify(t("companyProfile.saved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("companyProfile.saveError")); }
    finally { setSaving(false); }
  }

  async function saveCompliance(event: FormEvent) {
    event.preventDefault(); if (!compliance || !profile || saving) return;
    setSaving(true); setError("");
    const hasCommercial = Boolean(compliance.commercialRegistration || commercialNumber || issuingAuthority || commercialIssuedAt || commercialExpiresAt);
    const hasTax = Boolean(compliance.taxRegistration || taxNumber || taxIssuedAt || taxExpiresAt);
    const hasAddress = Boolean(compliance.nationalAddress || addressLine1 || addressLine2 || district || city || subdivision || postalCode || displayAddress);
    try {
      const value = await api<CompanyComplianceResponse>("/company-compliance", { method: "PATCH", body: JSON.stringify({
        version: compliance.version, legalName: legalName || null, legalForm: legalForm || null,
        ...(hasCommercial ? { commercialRegistration: {
          documentType: compliance.commercialRegistration?.documentType ?? "COMMERCIAL_REGISTRATION",
          ...(commercialNumber ? { number: commercialNumber } : {}), issuingAuthority: issuingAuthority || null,
          issuedAt: commercialIssuedAt || null, expiresAt: commercialExpiresAt || null,
        } } : {}),
        ...(hasTax ? { taxRegistration: {
          registrationType: taxType, countryCode: profile.profile.countryCode ?? countryCode,
          ...(taxNumber ? { number: taxNumber } : {}), issuedAt: taxIssuedAt || null, expiresAt: taxExpiresAt || null,
        } } : {}),
        ...(hasAddress ? { nationalAddress: {
          line1: addressLine1 || null, line2: addressLine2 || null, district: district || null, city: city || null,
          subdivision: subdivision || null, postalCode: postalCode || null,
          countryCode: profile.profile.countryCode ?? countryCode, displayAddress: displayAddress || null,
        } } : {}),
      }) });
      applyCompliance(value); setCommercialNumber(""); setTaxNumber(""); notify(t("companyProfile.complianceSaved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("companyProfile.saveError")); }
    finally { setSaving(false); }
  }

  if (loading) return <Spinner label={t("companyProfile.loading")} />;
  if (!profile || !compliance) return <div className="form-error" role="alert">{error || t("companyProfile.loadError")}</div>;

  return <section className="settings-card company-profile-shell">
    <div className="card-heading company-profile-heading"><div><h2>{t("companyProfile.title")}</h2><p>{t("companyProfile.description")}</p></div></div>
    <div className="company-profile-tabs" role="tablist" aria-label={t("companyProfile.title")}>
      <Button type="button" variant={view === "business" ? "primary" : "secondary"} onClick={() => setView("business")}>{t("companyProfile.businessTab")}</Button>
      <Button type="button" variant={view === "compliance" ? "primary" : "secondary"} onClick={() => setView("compliance")}>{t("companyProfile.complianceTab")}</Button>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <aside className="company-profile-readiness" aria-label={t("companyProfile.readinessTitle")}>
      <div><strong>{t("companyProfile.readinessTitle")}</strong><span>{t("companyProfile.readinessSummary", { complete: profile.readiness.completedRequirements, total: profile.readiness.totalRequirements })}</span></div>
      {profile.readiness.grandfathered && <p>{t("companyProfile.grandfathered")}</p>}
      <ul>{profile.readiness.requirements.map((item) => <li key={item.code} data-status={item.status}><span>{t(requirementKey(item.code))}</span><strong>{t(statusKey(item.status))}</strong></li>)}</ul>
    </aside>
    {view === "business" ? <form className="company-profile-form" onSubmit={event => void saveProfile(event)}>
      <h3>{t("companyProfile.businessTitle")}</h3>
      <div className="form-grid">
        <label><span>{t("companyProfile.tradeName")}</span><input value={tradeName} onChange={event => setTradeName(event.target.value)} maxLength={200} required /></label>
        <label><span>{t("companyProfile.country")}</span><select value={countryCode} onChange={event => setCountryCode(event.target.value)} required>{profile.options.countries.map(country => <option key={country.code} value={country.code}>{country.code} — {localizedReferenceName(country)}</option>)}</select></label>
        <label><span>{t("companyProfile.primaryActivity")}</span><select value={activityCode} onChange={event => setActivityCode(event.target.value)} required>{profile.options.activities.map(activity => <option key={activity.code} value={activity.code}>{localizedReferenceName(activity)}</option>)}</select></label>
        <label><span>{t("companyProfile.phone")}</span><input type="tel" dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} minLength={5} maxLength={40} required /></label>
        <label><span>{t("companyProfile.email")}</span><input type="email" dir="ltr" value={email} onChange={event => setEmail(event.target.value)} maxLength={320} /></label>
        <label><span>{t("companyProfile.website")}</span><input type="url" dir="ltr" value={website} onChange={event => setWebsite(event.target.value)} maxLength={500} /></label>
        <label><span>{t("companyProfile.contactName")}</span><input value={contactName} onChange={event => setContactName(event.target.value)} maxLength={160} /></label>
        <label><span>{t("companyProfile.chartTemplate")}</span><input value={profile.profile.initialChartTemplateCode ?? "—"} disabled /></label>
      </div>
      <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("companyProfile.save")}</Button></div>
    </form> : <form className="company-profile-form" onSubmit={event => void saveCompliance(event)}>
      <h3>{t("companyProfile.complianceTitle")}</h3>
      <p>{t("companyProfile.sensitiveNumberNote")}</p>
      <div className="form-grid">
        <label><span>{t("companyProfile.legalName")}</span><input value={legalName} onChange={event => setLegalName(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.legalForm")}</span><input value={legalForm} onChange={event => setLegalForm(event.target.value)} maxLength={100} /></label>
        <label><span>{t("companyProfile.commercialNumber")}</span><input dir="ltr" value={commercialNumber} onChange={event => setCommercialNumber(event.target.value)} maxLength={64} placeholder={compliance.commercialRegistration?.numberLast4 ? t("companyProfile.maskedNumber", { last4: compliance.commercialRegistration.numberLast4 }) : undefined} /></label>
        <label><span>{t("companyProfile.issuingAuthority")}</span><input value={issuingAuthority} onChange={event => setIssuingAuthority(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.issuedAt")}</span><input type="date" value={commercialIssuedAt} onChange={event => setCommercialIssuedAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.expiresAt")}</span><input type="date" value={commercialExpiresAt} onChange={event => setCommercialExpiresAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.taxType")}</span><input dir="ltr" value={taxType} onChange={event => setTaxType(event.target.value)} maxLength={80} /></label>
        <label><span>{t("companyProfile.taxNumber")}</span><input dir="ltr" value={taxNumber} onChange={event => setTaxNumber(event.target.value)} maxLength={64} placeholder={compliance.taxRegistration?.numberLast4 ? t("companyProfile.maskedNumber", { last4: compliance.taxRegistration.numberLast4 }) : undefined} /></label>
        <label><span>{t("companyProfile.taxIssuedAt")}</span><input type="date" value={taxIssuedAt} onChange={event => setTaxIssuedAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.taxExpiresAt")}</span><input type="date" value={taxExpiresAt} onChange={event => setTaxExpiresAt(event.target.value)} /></label>
      </div>
      {(compliance.commercialRegistration || compliance.taxRegistration) && <div className="company-renewal-state">
        {compliance.commercialRegistration && <span>{t("companyProfile.commercialRenewal")}: <strong>{t(renewalKey(compliance.commercialRegistration.renewalStatus))}</strong></span>}
        {compliance.taxRegistration && <span>{t("companyProfile.taxRenewal")}: <strong>{t(renewalKey(compliance.taxRegistration.renewalStatus))}</strong></span>}
      </div>}
      <h3>{t("companyProfile.nationalAddress")}</h3>
      <div className="form-grid">
        <label><span>{t("companyProfile.addressLine1")}</span><input value={addressLine1} onChange={event => setAddressLine1(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.addressLine2")}</span><input value={addressLine2} onChange={event => setAddressLine2(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.district")}</span><input value={district} onChange={event => setDistrict(event.target.value)} maxLength={120} /></label>
        <label><span>{t("companyProfile.city")}</span><input value={city} onChange={event => setCity(event.target.value)} maxLength={120} /></label>
        <label><span>{t("companyProfile.subdivision")}</span><input value={subdivision} onChange={event => setSubdivision(event.target.value)} maxLength={120} /></label>
        <label><span>{t("companyProfile.postalCode")}</span><input dir="ltr" value={postalCode} onChange={event => setPostalCode(event.target.value)} maxLength={40} /></label>
        <label className="full"><span>{t("companyProfile.displayAddress")}</span><input value={displayAddress} onChange={event => setDisplayAddress(event.target.value)} maxLength={500} /></label>
      </div>
      <section className="company-branding-capability"><h3>{t("companyProfile.brandingTitle")}</h3><p>{t("companyProfile.brandingDescription")}</p><div>{compliance.brandingAssets.map(asset => <span key={asset.kind}><strong>{asset.kind === "LOGO" ? t("companyProfile.logo") : t("companyProfile.letterhead")}</strong>{t("companyProfile.storagePolicyRequired")}</span>)}</div></section>
      <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("companyProfile.saveCompliance")}</Button></div>
    </form>}
  </section>;
}
