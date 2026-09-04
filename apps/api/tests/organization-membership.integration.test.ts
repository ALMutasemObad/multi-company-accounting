import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganizationMembershipService } from "../src/composition/create-organization-membership-service.js";
import { createDatabase } from "../src/database.js";
import { OrganizationMembershipError } from "../src/users/organization-membership-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("organization membership on a supported database", () => {
  afterAll(async () => prisma!.$disconnect());

  it("enforces company intersection, eligible-member privacy, audit scope, and concurrent last-owner safety", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const organizationCodes = [`ORG-A-${suffix}`, `ORG-B-${suffix}`];
    const emails = [`org-owner-a-${suffix}@example.test`, `org-owner-b-${suffix}@example.test`, `org-outsider-${suffix}@example.test`];
    let organizationIds: bigint[] = [];
    let companyIds: bigint[] = [];
    let userIds: bigint[] = [];
    try {
      const currency = await prisma!.currency.upsert({
        where: { scopeKey_code: { scopeKey: "GLOBAL", code: "SAR" } },
        update: { isActive: true },
        create: { code: "SAR", nameAr: "ريال سعودي", decimals: 2, scope: "GLOBAL", scopeKey: "GLOBAL" },
      });
      const organizations = await Promise.all(organizationCodes.map((code) =>
        prisma!.organization.create({ data: { code, name: code } })));
      const firstOrganization = organizations[0]!;
      const secondOrganization = organizations[1]!;
      organizationIds = [firstOrganization.id, secondOrganization.id];
      const [allowed, hiddenSameGroup, foreignCompany] = await Promise.all([
        prisma!.company.create({ data: { organizationId: firstOrganization.id, baseCurrencyId: currency.id, code: `A-${suffix}`, name: "Allowed company", timezone: "Asia/Riyadh" } }),
        prisma!.company.create({ data: { organizationId: firstOrganization.id, baseCurrencyId: currency.id, code: `H-${suffix}`, name: "Hidden same-group company", timezone: "Asia/Riyadh" } }),
        prisma!.company.create({ data: { organizationId: secondOrganization.id, baseCurrencyId: currency.id, code: `F-${suffix}`, name: "Foreign company", timezone: "Asia/Riyadh" } }),
      ]);
      companyIds = [allowed.id, hiddenSameGroup.id, foreignCompany.id];
      const users = await Promise.all(emails.map((email, index) => prisma!.user.create({
        data: { emailNormalized: email, passwordHash: "not-used", displayName: `Organization fixture ${index}` },
      })));
      const firstOwner = users[0]!;
      const secondOwner = users[1]!;
      const outsider = users[2]!;
      userIds = [firstOwner.id, secondOwner.id, outsider.id];
      await prisma!.userCompany.createMany({ data: [
        { userId: firstOwner.id, companyId: allowed.id, isActive: true },
        { userId: firstOwner.id, companyId: foreignCompany.id, isActive: true },
        { userId: secondOwner.id, companyId: hiddenSameGroup.id, isActive: true },
        { userId: outsider.id, companyId: foreignCompany.id, isActive: true },
      ] });
      await prisma!.organizationMembership.createMany({ data: [
        { organizationId: firstOrganization.id, userId: firstOwner.id, role: "OWNER" },
        { organizationId: firstOrganization.id, userId: secondOwner.id, role: "OWNER" },
      ] });

      const service = createOrganizationMembershipService(prisma!);
      const dashboard = await service.dashboard(firstOwner.id, firstOrganization.id, 30);
      expect(dashboard.companies.map(({ id }) => id)).toEqual([allowed.id.toString()]);
      expect(JSON.stringify(dashboard)).not.toContain(hiddenSameGroup.name);
      expect(JSON.stringify(dashboard)).not.toContain(foreignCompany.name);
      await expect(service.addMember(firstOwner.id, firstOrganization.id, {
        email: outsider.emailNormalized,
        role: "VIEWER",
      })).rejects.toEqual(new OrganizationMembershipError("ORGANIZATION_MEMBER_NOT_ELIGIBLE"));

      const changes = await Promise.allSettled([
        service.updateMember(firstOwner.id, firstOrganization.id, firstOwner.id, { role: "VIEWER", isActive: true, version: 0 }),
        service.updateMember(secondOwner.id, firstOrganization.id, secondOwner.id, { role: "VIEWER", isActive: true, version: 0 }),
      ]);
      expect(changes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(await prisma!.organizationMembership.count({
        where: { organizationId: firstOrganization.id, role: "OWNER", isActive: true },
      })).toBe(1);
      expect(await prisma!.organizationAuditLog.count({
        where: { organizationId: firstOrganization.id, action: "ORGANIZATION_MEMBER_UPDATED" },
      })).toBe(1);
    } finally {
      if (organizationIds.length) await prisma!.organizationAuditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
      if (organizationIds.length) await prisma!.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      if (userIds.length || companyIds.length) await prisma!.userCompany.deleteMany({ where: {
        ...(userIds.length ? { userId: { in: userIds } } : {}),
        ...(companyIds.length ? { companyId: { in: companyIds } } : {}),
      } });
      if (userIds.length) await prisma!.user.deleteMany({ where: { id: { in: userIds } } });
      if (companyIds.length) await prisma!.company.deleteMany({ where: { id: { in: companyIds } } });
      if (organizationIds.length) await prisma!.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
  }, 20_000);
});
