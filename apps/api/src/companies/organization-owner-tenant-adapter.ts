import type { PrismaClient } from "@prisma/client";
import type { OrganizationTenantQueryPort } from "../organizations/organization-owner-ports.js";

export class OrganizationOwnerTenantAdapter implements OrganizationTenantQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  organizationsByIds(ids: readonly bigint[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.organization.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async organizationCompanyIds(organizationId: bigint) {
    const rows = await this.prisma.company.findMany({
      where: { organizationId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map(({ id }) => id);
  }

  companiesForOrganization(organizationId: bigint, allowedCompanyIds: readonly bigint[]) {
    if (allowedCompanyIds.length === 0) return Promise.resolve([]);
    return this.prisma.company.findMany({
      where: { organizationId, id: { in: [...allowedCompanyIds] } },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        isActive: true,
        baseCurrency: { select: { code: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
    }).then((rows) => rows.map(({ baseCurrency, ...company }) => ({
      ...company,
      baseCurrencyCode: baseCurrency.code,
    })));
  }
}
