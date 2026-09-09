import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { GroupCompanyOnboardingError, type GroupCompanyInput, type GroupCompanyTenantPort } from "../organizations/group-company-onboarding-ports.js";
import { BusinessProfileProvisioningError, provisionCompanyBusinessProfile } from "./business-profile-provisioning.js";
import { companyCountryOptions } from "./company-profile-policy.js";

export class GroupCompanyOnboardingTenantAdapter implements GroupCompanyTenantPort {
  constructor(private readonly prisma: PrismaClient) {}
  currencies() {
    return this.prisma.currency.findMany({ where: { scopeKey: "GLOBAL", isActive: true }, select: { code: true, nameAr: true }, orderBy: { code: "asc" } });
  }
  countries() { return companyCountryOptions; }
  businessActivities() {
    return this.prisma.businessActivity.findMany({ where: { isActive: true }, select: { code: true, nameAr: true, nameEn: true }, orderBy: { code: "asc" } });
  }
  async createCompany(tx: Prisma.TransactionClient, organizationId: bigint, input: GroupCompanyInput) {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new GroupCompanyOnboardingError("INVALID_COMPANY_OPTION");
    const currency = await tx.currency.findUnique({ where: { scopeKey_code: { scopeKey: "GLOBAL", code: input.baseCurrencyCode } }, select: { id: true, isActive: true } });
    if (!currency?.isActive) throw new GroupCompanyOnboardingError("INVALID_COMPANY_OPTION");
    const company = await tx.company.create({ data: {
      organizationId, baseCurrencyId: currency.id, code: randomUUID(), name: input.companyName, timezone: input.timezone,
    }, select: { id: true, code: true, name: true, timezone: true, createdAt: true } });
    await tx.companyCurrency.create({ data: { companyId: company.id, currencyId: currency.id } });
    try {
      await provisionCompanyBusinessProfile(tx, company.id, company.name, {
        phone: input.phone, countryCode: input.countryCode,
        primaryBusinessActivityCode: input.primaryBusinessActivityCode,
        preferredLocale: "ar", initialChartTemplateCode: input.chartTemplateCode,
      });
    } catch (error) {
      if (error instanceof BusinessProfileProvisioningError) throw new GroupCompanyOnboardingError("INVALID_COMPANY_OPTION");
      throw error;
    }
    return { ...company, baseCurrencyCode: input.baseCurrencyCode };
  }
}
