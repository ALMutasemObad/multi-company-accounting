import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api";
import { useAuthorization } from "../authorization-context";
import { localizedReferenceName, useI18n, type TranslationKey } from "../i18n";
import type { CompanyComplianceResponse, CompanyProfileResponse } from "../types";
import { Button, Spinner } from "../ui";
import "./company-profile.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type View = "business" | "compliance";

export function companyProfileTabId(view: View) {
  return `company-profile-${view}-tab`;
}

export function companyProfilePanelId(view: View) {
  return `company-profile-${view}-panel`;
}

export function nextCompanyProfileTab(
  current: View,
  available: readonly View[],
  key: string,
  direction: "ltr" | "rtl",
) {
  if (!available.length || !available.includes(current)) return null;
  if (key === "Home") return available[0]!;
  if (key === "End") return available[available.length - 1]!;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const visualStep = key === "ArrowRight" ? 1 : -1;
  const step = direction === "rtl" ? -visualStep : visualStep;
  const currentIndex = available.indexOf(current);
  return available[(currentIndex + step + available.length) % available.length]!;
}

export function CompanyProfileTabs({
  view,
  available,
  label,
  businessLabel,
  complianceLabel,
  onSelect,
}: {
  view: View;
  available: readonly View[];
  label: string;
  businessLabel: string;
  complianceLabel: string;
  onSelect: (view: View) => void;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, current: View) {
    const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? "rtl" : "ltr";
    const next = nextCompanyProfileTab(current, available, event.key, direction);
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    requestAnimationFrame(() => document.getElementById(companyProfileTabId(next))?.focus());
  }

  return <div className="company-profile-tabs" role="tablist" aria-label={label} aria-orientation="horizontal">
    {available.map((item) => <Button
      key={item}
      id={companyProfileTabId(item)}
      type="button"
      role="tab"
      aria-selected={view === item}
      aria-controls={companyProfilePanelId(item)}
      tabIndex={view === item ? 0 : -1}
      variant={view === item ? "primary" : "secondary"}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => move(event, item)}
    >{item === "business" ? businessLabel : complianceLabel}</Button>)}
  </div>;
}

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

export type CompanyComplianceDraft = {
  legalName: string; legalForm: string; commercialNumber: string; issuingAuthority: string;
  commercialIssuedAt: string; commercialExpiresAt: string; taxNumber: string; taxType: string;
  taxIssuedAt: string; taxExpiresAt: string; addressLine1: string; addressLine2: string;
  district: string; city: string; subdivision: string; postalCode: string; displayAddress: string;
};

export function companyProfilePanelAccess(permissionSet: ReadonlySet<string>) {
  const canViewProfile = permissionSet.has("companies.profile.view");
  const canViewCompliance = permissionSet.has("companies.compliance.view");
  return {
    canViewProfile,
    canManageProfile: canViewProfile && permissionSet.has("companies.profile.manage"),
    canViewCompliance,
    canManageCompliance: canViewCompliance && permissionSet.has("companies.compliance.manage"),
  };
}

export function mergeComplianceReadiness(
  profile: CompanyProfileResponse | null,
  compliance: CompanyComplianceResponse,
) {
  return profile ? {
    ...profile,
    profile: { ...profile.profile, version: compliance.version },
    readiness: compliance.readiness,
  } : null;
}

export function mergeProfileGeneration(
  compliance: CompanyComplianceResponse | null,
  profile: CompanyProfileResponse,
) {
  return compliance ? {
    ...compliance,
    version: profile.profile.version,
    countryCode: profile.profile.countryCode,
    readiness: profile.readiness,
  } : null;
}

export function buildCompanyCompliancePatch(compliance: CompanyComplianceResponse, draft: CompanyComplianceDraft) {
  const currentCommercial = compliance.commercialRegistration;
  const commercialDirty = Boolean(draft.commercialNumber)
    || draft.issuingAuthority !== (currentCommercial?.issuingAuthority ?? "")
    || draft.commercialIssuedAt !== (currentCommercial?.issuedAt ?? "")
    || draft.commercialExpiresAt !== (currentCommercial?.expiresAt ?? "");
  const currentTax = compliance.taxRegistration;
  const taxDirty = Boolean(draft.taxNumber)
    || (Boolean(currentTax) && draft.taxType !== currentTax?.registrationType)
    || draft.taxIssuedAt !== (currentTax?.issuedAt ?? "")
    || draft.taxExpiresAt !== (currentTax?.expiresAt ?? "");
  const currentAddress = compliance.nationalAddress;
  const addressDirty = draft.addressLine1 !== (currentAddress?.line1 ?? "")
    || draft.addressLine2 !== (currentAddress?.line2 ?? "")
    || draft.district !== (currentAddress?.district ?? "")
    || draft.city !== (currentAddress?.city ?? "")
    || draft.subdivision !== (currentAddress?.subdivision ?? "")
    || draft.postalCode !== (currentAddress?.postalCode ?? "")
    || draft.displayAddress !== (currentAddress?.displayAddress ?? "");
  return {
    version: compliance.version,
    ...(draft.legalName !== (compliance.legalName ?? "") ? { legalName: draft.legalName || null } : {}),
    ...(draft.legalForm !== (compliance.legalForm ?? "") ? { legalForm: draft.legalForm || null } : {}),
    ...(commercialDirty ? { commercialRegistration: {
      documentType: currentCommercial?.documentType ?? "COMMERCIAL_REGISTRATION",
      ...(draft.commercialNumber ? { number: draft.commercialNumber } : {}),
      ...(draft.issuingAuthority !== (currentCommercial?.issuingAuthority ?? "") ? { issuingAuthority: draft.issuingAuthority || null } : {}),
      ...(draft.commercialIssuedAt !== (currentCommercial?.issuedAt ?? "") ? { issuedAt: draft.commercialIssuedAt || null } : {}),
      ...(draft.commercialExpiresAt !== (currentCommercial?.expiresAt ?? "") ? { expiresAt: draft.commercialExpiresAt || null } : {}),
    } } : {}),
    ...(taxDirty ? { taxRegistration: {
      registrationType: draft.taxType,
      countryCode: compliance.countryCode,
      ...(draft.taxNumber ? { number: draft.taxNumber } : {}),
      ...(draft.taxIssuedAt !== (currentTax?.issuedAt ?? "") ? { issuedAt: draft.taxIssuedAt || null } : {}),
      ...(draft.taxExpiresAt !== (currentTax?.expiresAt ?? "") ? { expiresAt: draft.taxExpiresAt || null } : {}),
    } } : {}),
    ...(addressDirty ? { nationalAddress: {
      countryCode: compliance.countryCode,
      ...(draft.addressLine1 !== (currentAddress?.line1 ?? "") ? { line1: draft.addressLine1 || null } : {}),
      ...(draft.addressLine2 !== (currentAddress?.line2 ?? "") ? { line2: draft.addressLine2 || null } : {}),
      ...(draft.district !== (currentAddress?.district ?? "") ? { district: draft.district || null } : {}),
      ...(draft.city !== (currentAddress?.city ?? "") ? { city: draft.city || null } : {}),
      ...(draft.subdivision !== (currentAddress?.subdivision ?? "") ? { subdivision: draft.subdivision || null } : {}),
      ...(draft.postalCode !== (currentAddress?.postalCode ?? "") ? { postalCode: draft.postalCode || null } : {}),
      ...(draft.displayAddress !== (currentAddress?.displayAddress ?? "") ? { displayAddress: draft.displayAddress || null } : {}),
    } } : {}),
  };
}

export function CompanyProfilePanel({ notify }: { notify: Notice }) {
  const { locale, t } = useI18n();
  const { permissionSet } = useAuthorization();
  const { canViewProfile, canManageProfile, canViewCompliance, canManageCompliance } = companyProfilePanelAccess(permissionSet);
  const [view, setView] = useState<View>(canViewProfile ? "business" : "compliance");
  const [profile, setProfile] = useState<CompanyProfileResponse | null>(null);
  const [compliance, setCompliance] = useState<CompanyComplianceResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(canViewProfile);
  const [complianceLoading, setComplianceLoading] = useState(canViewCompliance);
  const [profileError, setProfileError] = useState("");
  const [complianceError, setComplianceError] = useState("");
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
    if (!canViewProfile) { setProfile(null); setProfileLoading(false); return; }
    const controller = new AbortController();
    setProfileLoading(true); setProfileError("");
    void api<CompanyProfileResponse>("/company-profile", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) applyProfile(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setProfileError(cause instanceof Error ? cause.message : t("companyProfile.loadError")); })
      .finally(() => { if (!controller.signal.aborted) setProfileLoading(false); });
    return () => controller.abort();
  }, [canViewProfile]);

  useEffect(() => {
    if (!canViewCompliance) { setCompliance(null); setComplianceLoading(false); return; }
    const controller = new AbortController();
    setComplianceLoading(true); setComplianceError("");
    void api<CompanyComplianceResponse>("/company-compliance", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) applyCompliance(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setComplianceError(cause instanceof Error ? cause.message : t("companyProfile.loadError")); })
      .finally(() => { if (!controller.signal.aborted) setComplianceLoading(false); });
    return () => controller.abort();
  }, [canViewCompliance]);

  useEffect(() => {
    if (view === "business" && !canViewProfile && canViewCompliance) setView("compliance");
    if (view === "compliance" && !canViewCompliance && canViewProfile) setView("business");
  }, [canViewCompliance, canViewProfile, view]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!profile || !canManageProfile || saving) return;
    setSaving(true); setError("");
    try {
      const value = await api<CompanyProfileResponse>("/company-profile", { method: "PATCH", body: JSON.stringify({
        version: profile.profile.version, tradeName, countryCode, primaryBusinessActivityCode: activityCode,
        preferredLocale: locale, phone, email: email || null, website: website || null, primaryContactName: contactName || null,
      }) });
      applyProfile(value);
      setCompliance(current => mergeProfileGeneration(current, value));
      notify(t("companyProfile.saved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("companyProfile.saveError")); }
    finally { setSaving(false); }
  }

  async function saveCompliance(event: FormEvent) {
    event.preventDefault(); if (!compliance || !canManageCompliance || saving) return;
    const body = buildCompanyCompliancePatch(compliance, {
      legalName, legalForm, commercialNumber, issuingAuthority, commercialIssuedAt, commercialExpiresAt,
      taxNumber, taxType, taxIssuedAt, taxExpiresAt, addressLine1, addressLine2, district, city,
      subdivision, postalCode, displayAddress,
    });
    if (Object.keys(body).length === 1) { notify(t("companyProfile.complianceSaved")); return; }
    setSaving(true); setError("");
    try {
      const value = await api<CompanyComplianceResponse>("/company-compliance", { method: "PATCH", body: JSON.stringify(body) });
      applyCompliance(value);
      setProfile(current => mergeComplianceReadiness(current, value));
      setCommercialNumber(""); setTaxNumber(""); notify(t("companyProfile.complianceSaved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("companyProfile.saveError")); }
    finally { setSaving(false); }
  }

  if (!canViewProfile && !canViewCompliance) return null;
  if (view === "business" && profileLoading) return <Spinner label={t("companyProfile.loading")} />;
  if (view === "compliance" && complianceLoading) return <Spinner label={t("companyProfile.loading")} />;
  if (view === "business" && !profile) return <div className="form-error" role="alert">{profileError || t("companyProfile.loadError")}</div>;
  if (view === "compliance" && !compliance) return <div className="form-error" role="alert">{complianceError || t("companyProfile.loadError")}</div>;
  const readiness = view === "business" ? profile!.readiness : compliance!.readiness;
  const businessProfile = profile!;
  const complianceProfile = compliance!;
  const availableViews: View[] = [
    ...(canViewProfile ? ["business" as const] : []),
    ...(canViewCompliance ? ["compliance" as const] : []),
  ];

  return <section className="settings-card company-profile-shell">
    <div className="card-heading company-profile-heading"><div><h2>{t("companyProfile.title")}</h2><p>{t("companyProfile.description")}</p></div></div>
    <CompanyProfileTabs
      view={view}
      available={availableViews}
      label={t("companyProfile.title")}
      businessLabel={t("companyProfile.businessTab")}
      complianceLabel={t("companyProfile.complianceTab")}
      onSelect={setView}
    />
    {error && <div className="form-error" role="alert">{error}</div>}
    <aside className="company-profile-readiness" aria-label={t("companyProfile.readinessTitle")}>
      <div><strong>{t("companyProfile.readinessTitle")}</strong><span>{t("companyProfile.readinessSummary", { complete: readiness.completedRequirements, total: readiness.totalRequirements })}</span></div>
      {readiness.grandfathered && <p>{t("companyProfile.grandfathered")}</p>}
      <ul>{readiness.requirements.map((item) => <li key={item.code} data-status={item.status}><span>{t(requirementKey(item.code))}</span><strong>{t(statusKey(item.status))}</strong></li>)}</ul>
    </aside>
    {view === "business" ? <form id={companyProfilePanelId("business")} role="tabpanel" aria-labelledby={companyProfileTabId("business")} tabIndex={0} className="company-profile-form" onSubmit={event => void saveProfile(event)}>
      <h3>{t("companyProfile.businessTitle")}</h3>
      <div className="form-grid">
        <label><span>{t("companyProfile.tradeName")}</span><input value={tradeName} onChange={event => setTradeName(event.target.value)} maxLength={200} required /></label>
        <label><span>{t("companyProfile.country")}</span><select value={countryCode} onChange={event => setCountryCode(event.target.value)} required>{businessProfile.options.countries.map(country => <option key={country.code} value={country.code}>{country.code} — {localizedReferenceName(country)}</option>)}</select></label>
        <label><span>{t("companyProfile.primaryActivity")}</span><select value={activityCode} onChange={event => setActivityCode(event.target.value)} required>{businessProfile.options.activities.map(activity => <option key={activity.code} value={activity.code}>{localizedReferenceName(activity)}</option>)}</select></label>
        <label><span>{t("companyProfile.phone")}</span><input type="tel" dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} minLength={5} maxLength={40} required /></label>
        <label><span>{t("companyProfile.email")}</span><input type="email" dir="ltr" value={email} onChange={event => setEmail(event.target.value)} maxLength={320} /></label>
        <label><span>{t("companyProfile.website")}</span><input type="url" dir="ltr" value={website} onChange={event => setWebsite(event.target.value)} maxLength={500} /></label>
        <label><span>{t("companyProfile.contactName")}</span><input value={contactName} onChange={event => setContactName(event.target.value)} maxLength={160} /></label>
        <label><span>{t("companyProfile.chartTemplate")}</span><input value={businessProfile.profile.initialChartTemplateCode ?? "—"} disabled /></label>
      </div>
      {canManageProfile && <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("companyProfile.save")}</Button></div>}
    </form> : <form id={companyProfilePanelId("compliance")} role="tabpanel" aria-labelledby={companyProfileTabId("compliance")} tabIndex={0} className="company-profile-form" onSubmit={event => void saveCompliance(event)}>
      <h3>{t("companyProfile.complianceTitle")}</h3>
      <p>{t("companyProfile.sensitiveNumberNote")}</p>
      <div className="form-grid">
        <label><span>{t("companyProfile.legalName")}</span><input value={legalName} onChange={event => setLegalName(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.legalForm")}</span><input value={legalForm} onChange={event => setLegalForm(event.target.value)} maxLength={100} /></label>
        <label><span>{t("companyProfile.commercialNumber")}</span><input dir="ltr" value={commercialNumber} onChange={event => setCommercialNumber(event.target.value)} maxLength={64} placeholder={complianceProfile.commercialRegistration?.numberLast4 ? t("companyProfile.maskedNumber", { last4: complianceProfile.commercialRegistration.numberLast4 }) : undefined} /></label>
        <label><span>{t("companyProfile.issuingAuthority")}</span><input value={issuingAuthority} onChange={event => setIssuingAuthority(event.target.value)} maxLength={200} /></label>
        <label><span>{t("companyProfile.issuedAt")}</span><input type="date" value={commercialIssuedAt} onChange={event => setCommercialIssuedAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.expiresAt")}</span><input type="date" value={commercialExpiresAt} onChange={event => setCommercialExpiresAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.taxType")}</span><input dir="ltr" value={taxType} onChange={event => setTaxType(event.target.value)} maxLength={80} /></label>
        <label><span>{t("companyProfile.taxNumber")}</span><input dir="ltr" value={taxNumber} onChange={event => setTaxNumber(event.target.value)} maxLength={64} placeholder={complianceProfile.taxRegistration?.numberLast4 ? t("companyProfile.maskedNumber", { last4: complianceProfile.taxRegistration.numberLast4 }) : undefined} /></label>
        <label><span>{t("companyProfile.taxIssuedAt")}</span><input type="date" value={taxIssuedAt} onChange={event => setTaxIssuedAt(event.target.value)} /></label>
        <label><span>{t("companyProfile.taxExpiresAt")}</span><input type="date" value={taxExpiresAt} onChange={event => setTaxExpiresAt(event.target.value)} /></label>
      </div>
      {(complianceProfile.commercialRegistration || complianceProfile.taxRegistration) && <div className="company-renewal-state">
        {complianceProfile.commercialRegistration && <span>{t("companyProfile.commercialRenewal")}: <strong>{t(renewalKey(complianceProfile.commercialRegistration.renewalStatus))}</strong></span>}
        {complianceProfile.taxRegistration && <span>{t("companyProfile.taxRenewal")}: <strong>{t(renewalKey(complianceProfile.taxRegistration.renewalStatus))}</strong></span>}
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
      <section className="company-branding-capability"><h3>{t("companyProfile.brandingTitle")}</h3><p>{t("companyProfile.brandingDescription")}</p><div>{complianceProfile.brandingAssets.map(asset => <span key={asset.kind}><strong>{asset.kind === "LOGO" ? t("companyProfile.logo") : t("companyProfile.letterhead")}</strong>{t("companyProfile.storagePolicyRequired")}</span>)}</div></section>
      {canManageCompliance && <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("companyProfile.saveCompliance")}</Button></div>}
    </form>}
  </section>;
}
