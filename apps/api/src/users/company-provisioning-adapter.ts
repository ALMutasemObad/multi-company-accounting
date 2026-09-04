import type { Prisma } from "@prisma/client";
import {
  CompanyProvisioningError,
  type AdministratorProvisioningInput,
  type IdentityCompanyProvisioningPort,
} from "../platform/company-provisioning-ports.js";
import { permissionDefinitions } from "../platform/reference-data.js";

export class IdentityCompanyProvisioningAdapter implements IdentityCompanyProvisioningPort {
  async provisionAdministrator(tx: Prisma.TransactionClient, input: AdministratorProvisioningInput) {
    const existingUser = await tx.user.findUnique({ where: { emailNormalized: input.email } });
    if (existingUser && !existingUser.isActive) throw new CompanyProvisioningError("ADMIN_USER_DISABLED");
    if (existingUser && input.requireNewIdentity) throw new CompanyProvisioningError("ADMIN_USER_EXISTS");

    const administrator = existingUser ?? await tx.user.create({
      data: {
        emailNormalized: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      },
    });
    await tx.userCompany.upsert({
      where: { userId_companyId: { userId: administrator.id, companyId: input.companyId } },
      update: { isActive: true },
      create: { userId: administrator.id, companyId: input.companyId },
    });

    const existingOrganizationMembership = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: administrator.id,
        },
      },
      select: { role: true, isActive: true, version: true },
    });
    const organizationRole = existingOrganizationMembership?.role
      ?? (await tx.organizationMembership.count({
        where: { organizationId: input.organizationId, role: "OWNER", isActive: true, user: { isActive: true } },
      }) === 0 ? "OWNER" : "ADMIN");
    if (!existingOrganizationMembership) {
      await tx.organizationMembership.create({
        data: {
          organizationId: input.organizationId,
          userId: administrator.id,
          role: organizationRole,
        },
      });
    } else if (!existingOrganizationMembership.isActive) {
      await tx.organizationMembership.update({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: administrator.id } },
        data: { isActive: true, version: { increment: 1 } },
      });
    }

    const administratorRole = await tx.role.upsert({
      where: { companyId_code: { companyId: input.companyId, code: "ADMINISTRATOR" } },
      update: { nameAr: "مدير الشركة", isActive: true, isSystemRole: true },
      create: {
        companyId: input.companyId,
        code: "ADMINISTRATOR",
        nameAr: "مدير الشركة",
        isSystemRole: true,
      },
    });
    for (const [code, module, descriptionAr] of permissionDefinitions) {
      const permission = await tx.permission.upsert({
        where: { code },
        update: { module, descriptionAr },
        create: { code, module, descriptionAr },
      });
      await tx.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: administratorRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: administratorRole.id, permissionId: permission.id },
      });
    }
    await tx.userCompanyRole.upsert({
      where: {
        userId_companyId_roleId: {
          userId: administrator.id,
          companyId: input.companyId,
          roleId: administratorRole.id,
        },
      },
      update: {},
      create: { userId: administrator.id, companyId: input.companyId, roleId: administratorRole.id },
    });

    return {
      administrator: { id: administrator.id, email: administrator.emailNormalized },
      organizationRole,
      reusedIdentity: Boolean(existingUser),
      permissionsGranted: permissionDefinitions.length,
    };
  }
}
