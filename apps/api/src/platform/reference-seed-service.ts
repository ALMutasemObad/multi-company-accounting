import type { PrismaClient } from '@prisma/client';
import { accountTypeDefinitions, paymentMethodDefinitions, permissionDefinitions } from './reference-data.js';

export async function seedReferenceData(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const currency = await tx.currency.upsert({
      where: { code: 'SAR' },
      update: { nameAr: 'ريال سعودي', decimals: 2, isActive: true },
      create: { code: 'SAR', nameAr: 'ريال سعودي', decimals: 2 },
    });

    for (const [code, module, descriptionAr] of permissionDefinitions) {
      await tx.permission.upsert({
        where: { code },
        update: { module, descriptionAr },
        create: { code, module, descriptionAr },
      });
    }
    for (const definition of accountTypeDefinitions) {
      await tx.accountType.upsert({
        where: { code: definition.code },
        update: definition,
        create: definition,
      });
    }
    for (const method of paymentMethodDefinitions) {
      await tx.paymentMethod.upsert({
        where: { code: method.code },
        update: { ...method, isActive: true, scope: 'GLOBAL', companyId: null },
        create: { ...method, scope: 'GLOBAL' },
      });
    }

    return {
      currency: currency.code,
      permissions: permissionDefinitions.length,
      accountTypes: accountTypeDefinitions.length,
      paymentMethods: paymentMethodDefinitions.length,
    };
  });
}
