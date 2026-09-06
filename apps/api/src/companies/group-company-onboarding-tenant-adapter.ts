import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { GroupCompanyOnboardingError, type GroupCompanyInput, type GroupCompanyTenantPort } from "../organizations/group-company-onboarding-ports.js";

export class GroupCompanyOnboardingTenantAdapter implements GroupCompanyTenantPort {
  constructor(private readonly prisma: PrismaClient) {}
  currencies() {
    return this.prisma.currency.findMany({ where: { scopeKey: "GLOBAL", isActive: true }, select: { code: true, nameAr: true }, orderBy: { code: "asc" } });
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
    return { ...company, baseCurrencyCode: input.baseCurrencyCode };
  }
}
