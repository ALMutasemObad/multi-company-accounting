import { Prisma, type CompanyAddressType, type CompanyRegistrationStatus, type PrismaClient } from "@prisma/client";
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
  | "COUNTRY_MISMATCH"
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
      const current = await this.lockProfile(tx, context.companyId);
      if (current.version !== input.version || current.complianceVersion !== input.version) {
        throw new CompanyProfileError("VERSION_CONFLICT");
      }
      if (countryCode !== undefined && countryCode !== current.countryCode) {
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
        complianceVersion: { increment: 1 },
      };
      await tx.companyProfile.update({ where: { companyId: context.companyId }, data });
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2_000, timeout: 8_000 });
    return this.getProfile(context);
  }

  async getCompliance(context: ActorContext) {
    const company = await this.prisma.company.findUnique({ where: { id: context.companyId }, include: complianceInclude });
    if (!company?.profile) throw new CompanyProfileError("PROFILE_NOT_FOUND");
    return this.complianceResult(company);
  }

  async updateCompliance(context: ActorContext, input: CompanyComplianceUpdateInput) {
    const taxCountryCode = input.taxRegistration ? this.country(input.taxRegistration.countryCode)! : undefined;
    const nationalAddress = input.nationalAddress
      ? { ...input.nationalAddress, countryCode: this.country(input.nationalAddress.countryCode)! }
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      const currentProfile = await this.lockProfile(tx, context.companyId);
      if (currentProfile.version !== input.version || currentProfile.complianceVersion !== input.version) {
        throw new CompanyProfileError("VERSION_CONFLICT");
      }
      if ((taxCountryCode !== undefined && taxCountryCode !== currentProfile.countryCode)
        || (nationalAddress && nationalAddress.countryCode !== currentProfile.countryCode)) {
        throw new CompanyProfileError("COUNTRY_MISMATCH");
      }

      await tx.companyProfile.update({
        where: { companyId: context.companyId },
        data: {
          ...(input.legalName !== undefined ? { legalName: this.optionalText(input.legalName) } : {}),
          ...(input.legalForm !== undefined ? { legalForm: this.optionalText(input.legalForm) } : {}),
          version: { increment: 1 },
          complianceVersion: { increment: 1 },
        },
      });

      if (input.commercialRegistration) {
        const value = input.commercialRegistration;
        const where = { companyId_documentType: { companyId: context.companyId, documentType: value.documentType } };
        const existing = await tx.companyRegistration.findUnique({ where });
        if (existing) {
          const numberLast4 = value.number === undefined ? existing.numberLast4 : this.last4(value.number);
          const issuingAuthority = value.issuingAuthority === undefined ? existing.issuingAuthority : this.optionalText(value.issuingAuthority);
          const issuedAt = value.issuedAt === undefined ? existing.issuedAt : this.date(value.issuedAt);
          const expiresAt = value.expiresAt === undefined ? existing.expiresAt : this.date(value.expiresAt);
          this.assertDateRange(issuedAt, expiresAt);
          const verificationChanged = value.number !== undefined
            || issuingAuthority !== existing.issuingAuthority
            || !this.sameDate(issuedAt, existing.issuedAt)
            || !this.sameDate(expiresAt, existing.expiresAt);
          await tx.companyRegistration.update({ where, data: {
            ...(value.number !== undefined ? { numberLast4 } : {}),
            ...(value.issuingAuthority !== undefined ? { issuingAuthority } : {}),
            ...(value.issuedAt !== undefined ? { issuedAt } : {}),
            ...(value.expiresAt !== undefined ? { expiresAt } : {}),
            ...(verificationChanged ? { status: "DECLARED", verifiedAt: null } : {}),
          } });
        } else {
          const issuedAt = this.date(value.issuedAt);
          const expiresAt = this.date(value.expiresAt);
          this.assertDateRange(issuedAt, expiresAt);
          await tx.companyRegistration.create({ data: {
            companyId: context.companyId,
            documentType: value.documentType,
            numberLast4: this.last4(value.number),
            issuingAuthority: this.optionalText(value.issuingAuthority),
            issuedAt,
            expiresAt,
          } });
        }
      }
      if (input.taxRegistration) {
        const value = input.taxRegistration;
        const where = { companyId_registrationType_countryCode: { companyId: context.companyId, registrationType: value.registrationType, countryCode: taxCountryCode! } };
        const existing = await tx.companyTaxRegistration.findUnique({ where });
        if (existing) {
          const numberLast4 = value.number === undefined ? existing.numberLast4 : this.last4(value.number);
          const issuedAt = value.issuedAt === undefined ? existing.issuedAt : this.date(value.issuedAt);
          const expiresAt = value.expiresAt === undefined ? existing.expiresAt : this.date(value.expiresAt);
          this.assertDateRange(issuedAt, expiresAt);
          const verificationChanged = value.number !== undefined
            || !this.sameDate(issuedAt, existing.issuedAt)
            || !this.sameDate(expiresAt, existing.expiresAt);
          await tx.companyTaxRegistration.update({ where, data: {
            ...(value.number !== undefined ? { numberLast4 } : {}),
            ...(value.issuedAt !== undefined ? { issuedAt } : {}),
            ...(value.expiresAt !== undefined ? { expiresAt } : {}),
            ...(verificationChanged ? { status: "DECLARED", verifiedAt: null } : {}),
          } });
        } else {
          const issuedAt = this.date(value.issuedAt);
          const expiresAt = this.date(value.expiresAt);
          this.assertDateRange(issuedAt, expiresAt);
          await tx.companyTaxRegistration.create({ data: {
            companyId: context.companyId,
            registrationType: value.registrationType,
            countryCode: taxCountryCode!,
            numberLast4: this.last4(value.number),
            issuedAt,
            expiresAt,
          } });
        }
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2_000, timeout: 8_000 });
    return this.getCompliance(context);
  }

  private async upsertAddress(tx: Prisma.TransactionClient, companyId: bigint, type: CompanyAddressType, value: AddressInput) {
    const where = { companyId_type: { companyId, type } };
    const existing = await tx.companyAddress.findUnique({ where });
    if (existing) {
      await tx.companyAddress.update({ where, data: {
        ...(value.line1 !== undefined ? { line1: this.optionalText(value.line1) } : {}),
        ...(value.line2 !== undefined ? { line2: this.optionalText(value.line2) } : {}),
        ...(value.district !== undefined ? { district: this.optionalText(value.district) } : {}),
        ...(value.city !== undefined ? { city: this.optionalText(value.city) } : {}),
        ...(value.subdivision !== undefined ? { subdivision: this.optionalText(value.subdivision) } : {}),
        ...(value.postalCode !== undefined ? { postalCode: this.optionalText(value.postalCode) } : {}),
        countryCode: value.countryCode,
        ...(value.displayAddress !== undefined ? { displayAddress: this.optionalText(value.displayAddress) } : {}),
      } });
      return;
    }
    await tx.companyAddress.create({ data: {
      companyId, type,
      line1: this.optionalText(value.line1), line2: this.optionalText(value.line2),
      district: this.optionalText(value.district), city: this.optionalText(value.city),
      subdivision: this.optionalText(value.subdivision), postalCode: this.optionalText(value.postalCode),
      countryCode: value.countryCode, displayAddress: this.optionalText(value.displayAddress),
    } });
  }

  private async readiness(companyId: bigint, profile: {
    tradeName: string | null; countryCode: string | null; phone: string | null; legalName: string | null;
    grandfatheredAt: Date | null; primaryBusinessActivity: { code: string } | null;
  }) {
    const [hasCommercialRegistration, hasTaxRegistration, hasNationalAddress] = await Promise.all([
      this.prisma.companyRegistration.count({ where: { companyId, numberLast4: { not: null } } }).then(Boolean),
      this.prisma.companyTaxRegistration.count({ where: { companyId, numberLast4: { not: null } } }).then(Boolean),
      this.prisma.companyAddress.count({ where: { companyId, type: "NATIONAL", OR: [
        { line1: { not: null } }, { district: { not: null } }, { city: { not: null } },
        { subdivision: { not: null } }, { postalCode: { not: null } }, { displayAddress: { not: null } },
      ] } }).then(Boolean),
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

  private sameDate(left: Date | null, right: Date | null) {
    return left?.getTime() === right?.getTime();
  }

  private assertDateRange(issuedAt: Date | null, expiresAt: Date | null) {
    if (issuedAt && expiresAt && issuedAt > expiresAt) throw new CompanyProfileError("INVALID_DATE_RANGE");
  }

  private async lockProfile(tx: Prisma.TransactionClient, companyId: bigint) {
    const rows = await tx.$queryRaw<Array<{
      countryCode: string | null;
      version: number | bigint;
      complianceVersion: number | bigint;
    }>>(Prisma.sql`
      SELECT country_code AS countryCode, version, compliance_version AS complianceVersion
      FROM company_profiles
      WHERE company_id = ${companyId}
      FOR UPDATE
    `);
    const profile = rows[0];
    if (!profile) throw new CompanyProfileError("PROFILE_NOT_FOUND");
    return {
      countryCode: profile.countryCode,
      version: Number(profile.version),
      complianceVersion: Number(profile.complianceVersion),
    };
  }
}
