import type { Prisma } from "@prisma/client";
import { GroupCompanyOnboardingError, type GroupCompanyIdentityPort } from "../organizations/group-company-onboarding-ports.js";
import { permissionDefinitions } from "../platform/reference-data.js";
import { OrganizationMembershipError } from "./organization-membership-service.js";

export class GroupCompanyOnboardingIdentityAdapter implements GroupCompanyIdentityPort {
  async authorizeOwner(tx: Prisma.TransactionClient, userId: bigint, organizationId: bigint) {
    // A disable and an owner revocation compete with these row locks through commit.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId} FOR UPDATE`;
    const membership = await tx.organizationMembership.findFirst({
      where: { organizationId, userId, isActive: true, user: { isActive: true } }, select: { role: true },
    });
    if (!membership) throw new OrganizationMembershipError("ORGANIZATION_ACCESS_DENIED");
    if (membership.role !== "OWNER") throw new OrganizationMembershipError("ORGANIZATION_ROLE_FORBIDDEN");
  }
  async grantNewCompanyAdministrator(tx: Prisma.TransactionClient, userId: bigint, companyId: bigint) {
    // Insert-only bootstrap of a new company. Never reactivate or upgrade existing assignments.
    if (await tx.userCompany.count({ where: { companyId } }) || await tx.role.count({ where: { companyId } })) {
      throw new GroupCompanyOnboardingError("COMPANY_SETUP_UNAVAILABLE");
    }
    const permissions = await tx.permission.findMany({
      where: { code: { in: permissionDefinitions.map(([code]) => code) } }, select: { id: true },
    });
    if (permissions.length !== permissionDefinitions.length) throw new GroupCompanyOnboardingError("COMPANY_SETUP_UNAVAILABLE");
    await tx.userCompany.create({ data: { userId, companyId } });
    const role = await tx.role.create({ data: { companyId, code: "ADMINISTRATOR", nameAr: "مدير الشركة", isSystemRole: true }, select: { id: true } });
    await tx.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })) });
    await tx.userCompanyRole.create({ data: { userId, companyId, roleId: role.id } });
  }
}
