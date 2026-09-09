import { describe, expect, it } from "vitest";
import { companySettingsSectionAccess } from "../CompanySettingsPage";
import type { CompanyComplianceResponse, CompanyProfileReadiness, CompanyProfileResponse } from "../types";
import {
  buildCompanyCompliancePatch,
  companyProfilePanelAccess,
  mergeComplianceReadiness,
  mergeProfileGeneration,
  type CompanyComplianceDraft,
} from "./CompanyProfilePanel";

const readiness = (completedRequirements: number): CompanyProfileReadiness => ({
  policyVersion: "2026-09-09.v1",
  policySource: "ADR-018",
  effectiveAt: "2026-08-29T00:00:00.000Z",
  enforcementMode: "ADVISORY",
  grandfathered: false,
  completedRequirements,
  totalRequirements: 8,
  missingRequirements: [],
  requirements: [],
});

const compliance = (): CompanyComplianceResponse => ({
  version: 4,
  countryCode: "YE",
  legalName: "Juwar LLC",
  legalForm: "LLC",
  commercialRegistration: {
    id: "11", documentType: "COMMERCIAL_REGISTRATION", numberLast4: "6789", issuingAuthority: "Aden",
    issuedAt: "2025-01-01", expiresAt: "2027-01-01", status: "VERIFIED", renewalStatus: "CURRENT",
    verifiedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  },
  taxRegistration: {
    id: "12", registrationType: "TAX_REGISTRATION", countryCode: "YE", numberLast4: "4321",
    issuedAt: "2025-02-01", expiresAt: "2027-02-01", status: "VERIFIED", renewalStatus: "CURRENT",
    verifiedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  },
  nationalAddress: {
    id: "13", line1: "Main Road", line2: null, district: "Crater", city: "Aden", subdivision: null,
    postalCode: null, countryCode: "YE", displayAddress: "Aden, Yemen", updatedAt: "2026-01-02T00:00:00.000Z",
  },
  readiness: readiness(8),
  brandingAssets: [],
});

const draft = (): CompanyComplianceDraft => ({
  legalName: "Juwar LLC", legalForm: "LLC", commercialNumber: "", issuingAuthority: "Aden",
  commercialIssuedAt: "2025-01-01", commercialExpiresAt: "2027-01-01", taxNumber: "",
  taxType: "TAX_REGISTRATION", taxIssuedAt: "2025-02-01", taxExpiresAt: "2027-02-01",
  addressLine1: "Main Road", addressLine2: "", district: "Crater", city: "Aden", subdivision: "",
  postalCode: "", displayAddress: "Aden, Yemen",
});

describe("company profile settings permissions", () => {
  it("loads profile and compliance independently for partial grants", () => {
    expect(companyProfilePanelAccess(new Set(["companies.profile.view"]))).toEqual({
      canViewProfile: true, canManageProfile: false, canViewCompliance: false, canManageCompliance: false,
    });
    expect(companyProfilePanelAccess(new Set(["companies.compliance.view", "companies.compliance.manage"]))).toEqual({
      canViewProfile: false, canManageProfile: false, canViewCompliance: true, canManageCompliance: true,
    });
    expect(companyProfilePanelAccess(new Set(["companies.profile.manage", "companies.compliance.manage"]))).toEqual({
      canViewProfile: false, canManageProfile: false, canViewCompliance: false, canManageCompliance: false,
    });
  });

  it("keeps unrelated settings sections hidden for profile-only users", () => {
    expect(companySettingsSectionAccess(new Set(["companies.profile.view"]))).toEqual({
      canViewCompanyConfiguration: false,
      canManageCompanyConfiguration: false,
      canViewCurrencies: false,
      canCreateCurrencies: false,
      canManageCurrencies: false,
    });
  });
});

describe("company compliance patch", () => {
  it("does not send unchanged nested objects", () => {
    expect(buildCompanyCompliancePatch(compliance(), draft())).toEqual({ version: 4 });
  });

  it("sends only the changed nested address field and invariant country", () => {
    const changed = draft();
    changed.city = "Sanaa";
    expect(buildCompanyCompliancePatch(compliance(), changed)).toEqual({
      version: 4,
      nationalAddress: { countryCode: "YE", city: "Sanaa" },
    });
  });

  it("does not resend compliance documents when only legalName changes", () => {
    const changed = draft();
    changed.legalName = "Juwar Trading LLC";
    expect(buildCompanyCompliancePatch(compliance(), changed)).toEqual({
      version: 4,
      legalName: "Juwar Trading LLC",
    });
  });

  it("copies refreshed readiness into an already loaded profile", () => {
    const profile = {
      profile: {
        companyId: "1", tradeName: "Juwar", countryCode: "YE", preferredLocale: "ar", phone: "+967700000000",
        email: null, website: null, primaryContactName: null, primaryBusinessActivity: null,
        initialChartTemplateCode: "PROFESSIONAL_SERVICES", grandfatheredAt: null, version: 4,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      readiness: readiness(2), brandingAssets: [], options: { countries: [], activities: [] },
    } satisfies CompanyProfileResponse;
    const updatedCompliance = compliance();

    expect(mergeComplianceReadiness(profile, updatedCompliance)).toMatchObject({
      profile: { version: 4 },
      readiness: { completedRequirements: 8 },
    });
    expect(mergeComplianceReadiness(null, updatedCompliance)).toBeNull();

    const nextProfile = {
      ...profile,
      profile: { ...profile.profile, countryCode: "SA", version: 5 },
      readiness: readiness(3),
    } satisfies CompanyProfileResponse;
    expect(mergeProfileGeneration(updatedCompliance, nextProfile)).toMatchObject({
      version: 5,
      countryCode: "SA",
      readiness: { completedRequirements: 3 },
    });
    expect(mergeProfileGeneration(null, nextProfile)).toBeNull();
  });
});
