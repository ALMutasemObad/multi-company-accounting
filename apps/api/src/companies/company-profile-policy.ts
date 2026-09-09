export const BUSINESS_PROFILE_POLICY_VERSION = "BP1_GLOBAL_2026_09";

export const companyCountryOptions = [
  { code: "YE", nameAr: "اليمن", nameEn: "Yemen" },
  { code: "SA", nameAr: "المملكة العربية السعودية", nameEn: "Saudi Arabia" },
  { code: "AE", nameAr: "الإمارات العربية المتحدة", nameEn: "United Arab Emirates" },
  { code: "BH", nameAr: "البحرين", nameEn: "Bahrain" },
  { code: "KW", nameAr: "الكويت", nameEn: "Kuwait" },
  { code: "OM", nameAr: "عُمان", nameEn: "Oman" },
  { code: "QA", nameAr: "قطر", nameEn: "Qatar" },
  { code: "EG", nameAr: "مصر", nameEn: "Egypt" },
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan" },
  { code: "IQ", nameAr: "العراق", nameEn: "Iraq" },
  { code: "GB", nameAr: "المملكة المتحدة", nameEn: "United Kingdom" },
  { code: "US", nameAr: "الولايات المتحدة", nameEn: "United States" },
] as const;

export type ProfileRequirementStatus = "COMPLETE" | "MISSING" | "OPTIONAL" | "NOT_APPLICABLE";
export type ProfileRequirementLevel = "BASIC" | "OPERATIONAL" | "COMMERCIAL" | "REGULATED";

export type ProfileRequirement = {
  code: string;
  level: ProfileRequirementLevel;
  status: ProfileRequirementStatus;
  blocking: boolean;
  reason: string;
};

export type ProfileReadinessInput = {
  tradeName: string | null;
  countryCode: string | null;
  phone: string | null;
  legalName: string | null;
  primaryBusinessActivityCode: string | null;
  hasCommercialRegistration: boolean;
  hasTaxRegistration: boolean;
  hasNationalAddress: boolean;
  grandfatheredAt: Date | null;
};

function requiredRequirement(code: string, level: ProfileRequirementLevel, complete: boolean): ProfileRequirement {
  return {
    code,
    level,
    status: complete ? "COMPLETE" : "MISSING",
    blocking: false,
    reason: complete ? "RECORDED" : "PROGRESSIVE_PROFILE_ADVISORY",
  };
}

export function evaluateCompanyProfileReadiness(input: ProfileReadinessInput) {
  const requirements: ProfileRequirement[] = [
    requiredRequirement("TRADE_NAME", "BASIC", Boolean(input.tradeName)),
    requiredRequirement("COUNTRY", "BASIC", Boolean(input.countryCode)),
    requiredRequirement("PRIMARY_BUSINESS_ACTIVITY", "BASIC", Boolean(input.primaryBusinessActivityCode)),
    requiredRequirement("BUSINESS_PHONE", "OPERATIONAL", Boolean(input.phone)),
    requiredRequirement("LEGAL_NAME", "COMMERCIAL", Boolean(input.legalName)),
    requiredRequirement("COMMERCIAL_REGISTRATION", "COMMERCIAL", input.hasCommercialRegistration),
    requiredRequirement("NATIONAL_ADDRESS", "COMMERCIAL", input.hasNationalAddress),
    requiredRequirement("TAX_REGISTRATION", "REGULATED", input.hasTaxRegistration),
  ];

  for (const code of ["SA_COMMERCIAL_REGISTRATION", "SA_VAT_REGISTRATION", "SA_NATIONAL_ADDRESS"]) {
    requirements.push({
      code,
      level: code === "SA_VAT_REGISTRATION" ? "REGULATED" : "COMMERCIAL",
      status: input.countryCode === "YE" ? "NOT_APPLICABLE" : "OPTIONAL",
      blocking: false,
      reason: input.countryCode === "YE" ? "YEMEN_POLICY_EXCLUSION" : "NO_VERIFIED_JURISDICTION_REQUIREMENT",
    });
  }

  const tracked = requirements.filter(({ status }) => status === "COMPLETE" || status === "MISSING");
  return {
    policyVersion: BUSINESS_PROFILE_POLICY_VERSION,
    enforcementMode: "ADVISORY" as const,
    grandfathered: input.grandfatheredAt !== null,
    completedRequirements: tracked.filter(({ status }) => status === "COMPLETE").length,
    totalRequirements: tracked.length,
    missingRequirements: requirements.filter(({ status }) => status === "MISSING").map(({ code }) => code),
    requirements,
  };
}

export function companyBrandingAssetCapabilities() {
  return ["LOGO", "LETTERHEAD"].map((kind) => ({
    kind,
    status: "STORAGE_POLICY_REQUIRED" as const,
    uploadSupported: false,
    metadataAccepted: false,
  }));
}

export function renewalStatus(expiresAt: Date | null, now = new Date()) {
  if (!expiresAt) return "NOT_APPLICABLE" as const;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
  if (expiry < today) return "EXPIRED" as const;
  if (expiry <= today + 60 * 86_400_000) return "DUE_SOON" as const;
  return "CURRENT" as const;
}

export function isSupportedCompanyCountry(code: string) {
  return companyCountryOptions.some((country) => country.code === code);
}
