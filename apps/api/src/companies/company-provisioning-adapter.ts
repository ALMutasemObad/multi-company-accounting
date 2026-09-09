import type { Prisma } from "@prisma/client";
import {
  CompanyProvisioningError,
  type TenantCompanyProvisioningPort,
  type TenantProvisioningInput,
} from "../platform/company-provisioning-ports.js";
import { BusinessProfileProvisioningError, provisionCompanyBusinessProfile } from "./business-profile-provisioning.js";

export class TenantCompanyProvisioningAdapter implements TenantCompanyProvisioningPort {
  async provisionTenant(tx: Prisma.TransactionClient, input: TenantProvisioningInput) {
    const currency = await tx.currency.findUnique({
      where: { scopeKey_code: { scopeKey: "GLOBAL", code: input.baseCurrencyCode } },
      select: { id: true, code: true, isActive: true },
    });
    if (!currency?.isActive) throw new CompanyProvisioningError("CURRENCY_NOT_FOUND");

    const existingOrganization = await tx.organization.findUnique({ where: { code: input.organizationCode } });
    if (existingOrganization && existingOrganization.name !== input.organizationName) {
      throw new CompanyProvisioningError("INVALID_BUSINESS_PROFILE");
    }
    const organization = existingOrganization ?? await tx.organization.create({
      data: { code: input.organizationCode, name: input.organizationName },
    });
    const existingCompany = await tx.company.findUnique({
      where: { organizationId_code: { organizationId: organization.id, code: input.companyCode } },
    });
    if (existingCompany) {
      if (existingCompany.baseCurrencyId !== currency.id) {
        throw new CompanyProvisioningError("COMPANY_CURRENCY_MISMATCH");
      }
      if (existingCompany.name !== input.companyName || existingCompany.timezone !== input.timezone || !existingCompany.isActive) {
        throw new CompanyProvisioningError("INVALID_BUSINESS_PROFILE");
      }
    }
    if (existingCompany && input.businessProfile) {
      const existingProfile = await tx.companyProfile.findUnique({
        where: { companyId: existingCompany.id },
        select: {
          tradeName: true,
          phone: true,
          countryCode: true,
          preferredLocale: true,
          initialChartTemplateCode: true,
          primaryBusinessActivity: { select: { code: true } },
        },
      });
      const businessProfileMatches = existingProfile
        && existingProfile.tradeName === input.companyName
        && existingProfile.phone === input.businessProfile.phone
        && existingProfile.countryCode === input.businessProfile.countryCode
        && existingProfile.preferredLocale === input.businessProfile.preferredLocale
        && existingProfile.initialChartTemplateCode === input.businessProfile.initialChartTemplateCode
        && existingProfile.primaryBusinessActivity?.code === input.businessProfile.primaryBusinessActivityCode;
      if (!businessProfileMatches) {
        throw new CompanyProvisioningError("INVALID_BUSINESS_PROFILE");
      }
    }
    const company = existingCompany
      ? existingCompany
      : await tx.company.create({
          data: {
            organizationId: organization.id,
            baseCurrencyId: currency.id,
            code: input.companyCode,
            name: input.companyName,
            timezone: input.timezone,
          },
        });
    if (!existingCompany) {
      try {
        await provisionCompanyBusinessProfile(tx, company.id, company.name, input.businessProfile);
      } catch (error) {
        if (error instanceof BusinessProfileProvisioningError) throw new CompanyProvisioningError("INVALID_BUSINESS_PROFILE");
        throw error;
      }
    }
    await tx.companyCurrency.upsert({
      where: { companyId_currencyId: { companyId: company.id, currencyId: currency.id } },
      update: { isActive: true },
      create: { companyId: company.id, currencyId: currency.id },
    });

    return {
      organization: { id: organization.id, code: organization.code, name: organization.name },
      company: { id: company.id, code: company.code, name: company.name, timezone: company.timezone, createdAt: company.createdAt },
      baseCurrency: { id: currency.id, code: currency.code },
      created: !existingCompany,
    };
  }
}
