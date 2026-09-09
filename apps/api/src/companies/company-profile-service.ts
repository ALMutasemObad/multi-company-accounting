import type { CompanyAddressType, CompanyRegistrationStatus, Prisma, PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  companyBrandingAssetCapabilities,
  companyCountryOptions,
  evaluateCompanyProfileReadiness,
  isSupportedCompanyCountry,
  renewalStatus,
} from "./company-profile-policy.js";

export type CompanyProfileErrorReason =
  | "PROFILE_NOT_FOUND"
  | "INVALID_COUNTRY"
  | "INVALID_ACTIVITY"
  | "INVALID_DATE_RANGE"
  | "COUNTRY_CHANGE_REQUIRES_WORKFLOW"
  | "VERSION_CONFLICT";

export class CompanyProfileError extends Error {
  constructor(public readonly reason: CompanyProfileErrorReason) { super(reason); }
}

export type CompanyProfileUpdateInput = {
  version: number;
  tradeName?: string | null;
  countryCode?: string | null;
  primaryBusinessActivityCode?: string | null;
  preferredLocale?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  primaryContactName?: string | null;
};

type RegistrationInput = {
  documentType: string;
  number?: string | null;
  issuingAuthority?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
};

type TaxRegistrationInput = {
  registrationType: string;
  countryCode: string;
  number?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
};

type AddressInput = {
  line1?: string | null;
  line2?: string | null;
  district?: string | null;
  city?: string | null;
  subdivision?: string | null;
  postalCode?: string | null;
  countryCode: string;
  displayAddress?: string | null;
};

export type CompanyComplianceUpdateInput = {
  version: number;
  legalName?: string | null;
  legalForm?: string | null;
  commercialRegistration?: RegistrationInput;
  taxRegistration?: TaxRegistrationInput;
  nationalAddress?: AddressInput;
};

const profileInclude = {
  primaryBusinessActivity: { select: { code: true, nameAr: true, nameEn: true } },
} satisfies Prisma.CompanyProfileInclude;

const complianceInclude = {
  profile: { include: profileInclude },
  registrations: { orderBy: { id: "asc" as const } },
  taxRegistrations: { orderBy: { id: "asc" as const } },
  profileAddresses: { orderBy: { id: "asc" as const } },
};

export class CompanyProfileService {
  constructor(private readonly prisma: PrismaClient) {}

  async options() {
    const activities = await this.prisma.businessActivity.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, nameAr: true, nameEn: true },
    });
    return { countries: companyCountryOptions, activities };
  }

  async getProfile(context: ActorContext) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { companyId: context.companyId },
      include: profileInclude,
    });
    if (!profile) throw new CompanyProfileError("PROFILE_NOT_FOUND");
    return { profile, readiness: await this.readiness(context.companyId, profile), brandingAssets: companyBrandingAssetCapabilities() };
  }

  async updateProfile(context: ActorContext, input: CompanyProfileUpdateInput) {
    const countryCode = input.countryCode === undefined ? undefined : this.country(input.countryCode);
    const activityCode = typeof input.primaryBusinessActivityCode === "string"
      ? input.primaryBusinessActivityCode.trim().toUpperCase()
      : input.primaryBusinessActivityCode;
    const activity = activityCode === undefined
      ? undefined
      : activityCode === null
        ? null
        : await this.prisma.businessActivity.findUnique({ where: { code: activityCode }, select: { id: true, isActive: true, code: true } });
    if (activity && !activity.isActive) throw new CompanyProfileError("INVALID_ACTIVITY");
    if (input.primaryBusinessActivityCode && !activity) throw new CompanyProfileError("INVALID_ACTIVITY");

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.companyProfile.findUnique({ where: { companyId: context.companyId }, select: { countryCode: true } });
      if (!current) throw new CompanyProfileError("PROFILE_NOT_FOUND");
      if (countryCode !== undefined && current.countryCode && countryCode !== current.countryCode) {
        const [registrations, taxes, addresses] = await Promise.all([
          tx.companyRegistration.count({ where: { companyId: context.companyId } }),
          tx.companyTaxRegistration.count({ where: { companyId: context.companyId } }),
          tx.companyAddress.count({ where: { companyId: context.companyId } }),
        ]);
        if (registrations || taxes || addresses) throw new CompanyProfileError("COUNTRY_CHANGE_REQUIRES_WORKFLOW");
      }
      const data: Prisma.CompanyProfileUpdateManyMutationInput = {
        ...(input.tradeName !== undefined ? { tradeName: this.optionalText(input.tradeName) } : {}),
        ...(countryCode !== undefined ? { countryCode } : {}),
        ...(input.preferredLocale !== undefined ? { preferredLocale: this.optionalText(input.preferredLocale) } : {}),
        ...(input.phone !== undefined ? { phone: this.optionalText(input.phone) } : {}),
        ...(input.email !== undefined ? { email: this.optionalText(input.email) } : {}),
        ...(input.website !== undefined ? { website: this.optionalText(input.website) } : {}),
        ...(input.primaryContactName !== undefined ? { primaryContactName: this.optionalText(input.primaryContactName) } : {}),
        ...(activity !== undefined ? { primaryBusinessActivityId: activity?.id ?? null } : {}),
        version: { increment: 1 },
      };
      const updated = await tx.companyProfile.updateMany({ where: { companyId: context.companyId, version: input.version }, data });
      if (updated.count !== 1) throw new CompanyProfileError("VERSION_CONFLICT");
      await appendAudit(tx, { data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action: "COMPANY_PROFILE_UPDATED",
        entityType: "COMPANY_PROFILE",
        entityId: context.companyId.toString(),
        details: {
          changedFields: Object.keys(input).filter((key) => key !== "version").sort(),
          ...(countryCode !== undefined ? { countryCode } : {}),
          ...(activity ? { primaryBusinessActivityCode: activity.code } : {}),
        },
      } });
    }, { maxWait: 2_000, timeout: 8_000 });
    return this.getProfile(context);
  }

  async getCompliance(context: ActorContext) {
    const company = await this.prisma.company.findUnique({ where: { id: context.companyId }, include: complianceInclude });
    if (!company?.profile) throw new CompanyProfileError("PROFILE_NOT_FOUND");
    return this.complianceResult(company);
  }

  async updateCompliance(context: ActorContext, input: CompanyComplianceUpdateInput) {
    this.assertDates(input.commercialRegistration?.issuedAt, input.commercialRegistration?.expiresAt);
    this.assertDates(input.taxRegistration?.issuedAt, input.taxRegistration?.expiresAt);
    const taxCountryCode = input.taxRegistration ? this.country(input.taxRegistration.countryCode)! : undefined;
    const nationalAddress = input.nationalAddress
      ? { ...input.nationalAddress, countryCode: this.country(input.nationalAddress.countryCode)! }
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.companyProfile.updateMany({
        where: { companyId: context.companyId, complianceVersion: input.version },
        data: {
          ...(input.legalName !== undefined ? { legalName: this.optionalText(input.legalName) } : {}),
          ...(input.legalForm !== undefined ? { legalForm: this.optionalText(input.legalForm) } : {}),
          complianceVersion: { increment: 1 },
        },
      });
      if (profile.count !== 1) throw new CompanyProfileError("VERSION_CONFLICT");

      if (input.commercialRegistration) {
        const value = input.commercialRegistration;
        await tx.companyRegistration.upsert({
          where: { companyId_documentType: { companyId: context.companyId, documentType: value.documentType } },
          update: {
            ...(value.number !== undefined ? { numberLast4: this.last4(value.number) } : {}),
            issuingAuthority: this.optionalText(value.issuingAuthority),
            issuedAt: this.date(value.issuedAt),
            expiresAt: this.date(value.expiresAt),
            status: "DECLARED",
            verifiedAt: null,
          },
          create: {
            companyId: context.companyId,
            documentType: value.documentType,
            numberLast4: this.last4(value.number),
            issuingAuthority: this.optionalText(value.issuingAuthority),
            issuedAt: this.date(value.issuedAt),
            expiresAt: this.date(value.expiresAt),
          },
        });
      }
      if (input.taxRegistration) {
        const value = input.taxRegistration;
        await tx.companyTaxRegistration.upsert({
          where: { companyId_registrationType_countryCode: { companyId: context.companyId, registrationType: value.registrationType, countryCode: taxCountryCode! } },
          update: {
            ...(value.number !== undefined ? { numberLast4: this.last4(value.number) } : {}),
            issuedAt: this.date(value.issuedAt),
            expiresAt: this.date(value.expiresAt),
            status: "DECLARED",
            verifiedAt: null,
          },
          create: {
            companyId: context.companyId,
            registrationType: value.registrationType,
            countryCode: taxCountryCode!,
            numberLast4: this.last4(value.number),
            issuedAt: this.date(value.issuedAt),
            expiresAt: this.date(value.expiresAt),
          },
        });
      }
      if (nationalAddress) {
        await this.upsertAddress(tx, context.companyId, "NATIONAL", nationalAddress);
      }
      await appendAudit(tx, { data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action: "COMPANY_COMPLIANCE_UPDATED",
        entityType: "COMPANY_PROFILE",
        entityId: context.companyId.toString(),
        details: {
          changedFields: Object.keys(input).filter((key) => key !== "version").sort(),
          registrationNumberStored: input.commercialRegistration?.number !== undefined,
          taxNumberStored: input.taxRegistration?.number !== undefined,
        },
      } });
    }, { maxWait: 2_000, timeout: 8_000 });
    return this.getCompliance(context);
  }

  private async upsertAddress(tx: Prisma.TransactionClient, companyId: bigint, type: CompanyAddressType, value: AddressInput) {
    const data = {
      line1: this.optionalText(value.line1), line2: this.optionalText(value.line2),
      district: this.optionalText(value.district), city: this.optionalText(value.city),
      subdivision: this.optionalText(value.subdivision), postalCode: this.optionalText(value.postalCode),
      countryCode: value.countryCode, displayAddress: this.optionalText(value.displayAddress),
    };
    await tx.companyAddress.upsert({
      where: { companyId_type: { companyId, type } },
      update: data,
      create: { companyId, type, ...data },
    });
  }

  private async readiness(companyId: bigint, profile: {
    tradeName: string | null; countryCode: string | null; phone: string | null; legalName: string | null;
    grandfatheredAt: Date | null; primaryBusinessActivity: { code: string } | null;
  }) {
    const [hasCommercialRegistration, hasTaxRegistration, hasNationalAddress] = await Promise.all([
      this.prisma.companyRegistration.count({ where: { companyId } }).then(Boolean),
      this.prisma.companyTaxRegistration.count({ where: { companyId } }).then(Boolean),
      this.prisma.companyAddress.count({ where: { companyId, type: "NATIONAL" } }).then(Boolean),
    ]);
    return evaluateCompanyProfileReadiness({
      tradeName: profile.tradeName, countryCode: profile.countryCode, phone: profile.phone, legalName: profile.legalName,
      primaryBusinessActivityCode: profile.primaryBusinessActivity?.code ?? null,
      hasCommercialRegistration, hasTaxRegistration, hasNationalAddress, grandfatheredAt: profile.grandfatheredAt,
    });
  }

  private async complianceResult(company: Awaited<ReturnType<PrismaClient["company"]["findUnique"]>> & Record<string, unknown>) {
    const value = company as unknown as {
      id: bigint;
      profile: Prisma.CompanyProfileGetPayload<{ include: typeof profileInclude }>;
      registrations: Array<{ id: bigint; documentType: string; numberLast4: string | null; issuingAuthority: string | null; issuedAt: Date | null; expiresAt: Date | null; status: CompanyRegistrationStatus; verifiedAt: Date | null; updatedAt: Date }>;
      taxRegistrations: Array<{ id: bigint; registrationType: string; countryCode: string; numberLast4: string | null; issuedAt: Date | null; expiresAt: Date | null; status: CompanyRegistrationStatus; verifiedAt: Date | null; updatedAt: Date }>;
      profileAddresses: Array<{ id: bigint; type: CompanyAddressType; line1: string | null; line2: string | null; district: string | null; city: string | null; subdivision: string | null; postalCode: string | null; countryCode: string; displayAddress: string | null; updatedAt: Date }>;
    };
    return {
      profile: value.profile,
      registrations: value.registrations.map((item) => ({ ...item, renewalStatus: renewalStatus(item.expiresAt) })),
      taxRegistrations: value.taxRegistrations.map((item) => ({ ...item, renewalStatus: renewalStatus(item.expiresAt) })),
      addresses: value.profileAddresses,
      readiness: await this.readiness(value.id, value.profile),
      brandingAssets: companyBrandingAssetCapabilities(),
    };
  }

  private country(value: string | null) {
    if (value === null) return null;
    const code = value.trim().toUpperCase();
    if (!isSupportedCompanyCountry(code)) throw new CompanyProfileError("INVALID_COUNTRY");
    return code;
  }

  private optionalText(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    return normalized || null;
  }

  private last4(value: string | null | undefined) {
    const normalized = this.optionalText(value);
    return normalized ? [...normalized].slice(-4).join("") : null;
  }

  private date(value: string | null | undefined) {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private assertDates(issuedAt?: string | null, expiresAt?: string | null) {
    if (issuedAt && expiresAt && issuedAt > expiresAt) throw new CompanyProfileError("INVALID_DATE_RANGE");
  }
}
