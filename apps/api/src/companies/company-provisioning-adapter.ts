import type { Prisma } from "@prisma/client";
import {
  CompanyProvisioningError,
  type TenantCompanyProvisioningPort,
  type TenantProvisioningInput,
} from "../platform/company-provisioning-ports.js";

export class TenantCompanyProvisioningAdapter implements TenantCompanyProvisioningPort {
  async provisionTenant(tx: Prisma.TransactionClient, input: TenantProvisioningInput) {
    const currency = await tx.currency.findUnique({
      where: { scopeKey_code: { scopeKey: "GLOBAL", code: input.baseCurrencyCode } },
      select: { id: true, code: true, isActive: true },
    });
    if (!currency?.isActive) throw new CompanyProvisioningError("CURRENCY_NOT_FOUND");

    const organization = await tx.organization.upsert({
      where: { code: input.organizationCode },
      update: { name: input.organizationName },
      create: { code: input.organizationCode, name: input.organizationName },
    });
    const existingCompany = await tx.company.findUnique({
      where: { organizationId_code: { organizationId: organization.id, code: input.companyCode } },
    });
    if (existingCompany && existingCompany.baseCurrencyId !== currency.id) {
      throw new CompanyProvisioningError("COMPANY_CURRENCY_MISMATCH");
    }
    const company = existingCompany
      ? await tx.company.update({
          where: { id: existingCompany.id },
          data: { name: input.companyName, timezone: input.timezone, isActive: true },
        })
      : await tx.company.create({
          data: {
            organizationId: organization.id,
            baseCurrencyId: currency.id,
            code: input.companyCode,
            name: input.companyName,
            timezone: input.timezone,
          },
        });
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
