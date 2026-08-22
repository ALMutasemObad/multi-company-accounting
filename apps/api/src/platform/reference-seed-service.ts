import type { PrismaClient } from '@prisma/client';
import { paymentMethodDefinitions } from '../treasury/treasury-reference-data.js';
import { upsertGlobalPaymentMethods } from '../treasury/treasury-service.js';
import { accountTypeDefinitions, currencyDefinitions, permissionDefinitions } from './reference-data.js';

export async function seedReferenceData(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    for (const definition of currencyDefinitions) {
      await tx.currency.upsert({
        where: { scopeKey_code: { scopeKey: 'GLOBAL', code: definition.code } },
        update: { nameAr: definition.nameAr, decimals: definition.decimals, isActive: true, scope: 'GLOBAL', ownerCompanyId: null },
        create: { ...definition, scope: 'GLOBAL', scopeKey: 'GLOBAL' },
      });
    }

    for (const [code, module, descriptionAr] of permissionDefinitions) {
      await tx.permission.upsert({
        where: { code },
        update: { module, descriptionAr },
        create: { code, module, descriptionAr },
      });
    }
    const administratorRoles = await tx.role.findMany({ where: { code: 'ADMINISTRATOR', isSystemRole: true }, select: { id: true } });
    const permissions = await tx.permission.findMany({ where: { code: { in: permissionDefinitions.map(([code]) => code) } }, select: { id: true } });
    for (const role of administratorRoles) {
      for (const permission of permissions) {
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
    const permissionByCode = new Map((await tx.permission.findMany({
      where: { code: { in: ['cash_bank_accounts.view', 'settings.manage', 'currencies.view', 'currencies.manage', 'currencies.create'] } },
      select: { id: true, code: true },
    })).map((permission) => [permission.code, permission.id]));
    const inheritedPermissions = [
      { from: permissionByCode.get('cash_bank_accounts.view'), to: permissionByCode.get('currencies.view') },
      { from: permissionByCode.get('settings.manage'), to: permissionByCode.get('currencies.manage') },
      { from: permissionByCode.get('currencies.manage'), to: permissionByCode.get('currencies.create') },
    ];
    for (const inheritance of inheritedPermissions) {
      if (!inheritance.from || !inheritance.to) continue;
      const existingAssignments = await tx.rolePermission.findMany({ where: { permissionId: inheritance.from }, select: { roleId: true } });
      for (const assignment of existingAssignments) {
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: assignment.roleId, permissionId: inheritance.to } },
          update: {},
          create: { roleId: assignment.roleId, permissionId: inheritance.to },
        });
      }
    }
    for (const definition of accountTypeDefinitions) {
      await tx.accountType.upsert({
        where: { code: definition.code },
        update: definition,
        create: definition,
      });
    }
    await upsertGlobalPaymentMethods(tx);

    return {
      currencies: currencyDefinitions.map(({ code }) => code),
      permissions: permissionDefinitions.length,
      accountTypes: accountTypeDefinitions.length,
      paymentMethods: paymentMethodDefinitions.length,
    };
  });
}
