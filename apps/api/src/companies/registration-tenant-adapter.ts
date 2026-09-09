import type { Prisma, PrismaClient } from "@prisma/client";
import type { RegistrationTenantPort } from "../registration/registration-owner-ports.js";
import { companyCountryOptions, isSupportedCompanyCountry } from "./company-profile-policy.js";

export class RegistrationTenantAdapter implements RegistrationTenantPort {
  constructor(private readonly prisma: PrismaClient) {}

  listGlobalCurrencies() {
    return this.prisma.currency.findMany({
      where: { scope: "GLOBAL", scopeKey: "GLOBAL", isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, nameAr: true, decimals: true },
    });
  }

  listCompanyCountries() { return companyCountryOptions; }

  listBusinessActivities() {
    return this.prisma.businessActivity.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, nameAr: true, nameEn: true },
    });
  }

  isSupportedCompanyCountry(code: string) { return isSupportedCompanyCountry(code); }

  async isActiveGlobalCurrency(tx: Prisma.TransactionClient, code: string) {
    const currency = await tx.currency.findUnique({
      where: { scopeKey_code: { scopeKey: "GLOBAL", code } },
      select: { isActive: true },
    });
    return currency?.isActive === true;
  }

  async isActiveBusinessActivity(tx: Prisma.TransactionClient, code: string) {
    const activity = await tx.businessActivity.findUnique({ where: { code }, select: { isActive: true } });
    return activity?.isActive === true;
  }
}
