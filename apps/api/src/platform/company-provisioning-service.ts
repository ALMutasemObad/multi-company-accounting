import { hash } from 'argon2';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { applyDefaultChartTemplate } from '../accounts/default-chart-template.js';
import { accountTypeDefinitions, paymentMethodDefinitions, permissionDefinitions } from './reference-data.js';

const tenantCode = z.string().trim().min(2).max(80).transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z][A-Z0-9_-]+$/.test(value), 'Use uppercase Latin letters, numbers, underscores or hyphens');

export const companyProvisioningSchema = z.object({
  organizationCode: tenantCode,
  organizationName: z.string().trim().min(1).max(200),
  companyCode: tenantCode,
  companyName: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64).refine((value) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'A valid IANA timezone is required'),
  baseCurrencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  adminEmail: z.string().trim().email().max(320).transform((value) => value.toLocaleLowerCase('en-US')),
  adminDisplayName: z.string().trim().min(1).max(160),
  adminPassword: z.string().min(12).max(1024),
}).strict();

export type CompanyProvisioningInput = z.input<typeof companyProvisioningSchema>;
export const preparedCompanyProvisioningSchema = companyProvisioningSchema.omit({ adminPassword: true });
export type PreparedCompanyProvisioningInput = z.input<typeof preparedCompanyProvisioningSchema>;

export class CompanyProvisioningError extends Error {
  constructor(public readonly reason: 'CURRENCY_NOT_FOUND' | 'COMPANY_CURRENCY_MISMATCH' | 'ADMIN_USER_DISABLED' | 'ADMIN_USER_EXISTS') { super(reason); }
}

export class CompanyProvisioningService {
  constructor(private readonly prisma: PrismaClient) {}

  async provision(rawInput: CompanyProvisioningInput) {
    const input = companyProvisioningSchema.parse(rawInput);
    const { adminPassword, ...preparedInput } = input;
    const passwordHash = await hash(adminPassword);
    const prepared = preparedCompanyProvisioningSchema.parse(preparedInput);

    return this.prisma.$transaction(
      (tx) => this.provisionPreparedInTransaction(tx, prepared, passwordHash),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 },
    );
  }

  async provisionPreparedInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: PreparedCompanyProvisioningInput,
    passwordHash: string,
    options: { requireNewAdminIdentity?: boolean } = {},
  ) {
      const input = preparedCompanyProvisioningSchema.parse(rawInput);
      if (!passwordHash || passwordHash.length > 255) throw new TypeError('A valid prepared password hash is required');
      const currency = await tx.currency.findUnique({ where: { scopeKey_code: { scopeKey: 'GLOBAL', code: input.baseCurrencyCode } } });
      if (!currency?.isActive) throw new CompanyProvisioningError('CURRENCY_NOT_FOUND');

      const organization = await tx.organization.upsert({
        where: { code: input.organizationCode },
        update: { name: input.organizationName },
        create: { code: input.organizationCode, name: input.organizationName },
      });
      const existingCompany = await tx.company.findUnique({
        where: { organizationId_code: { organizationId: organization.id, code: input.companyCode } },
      });
      if (existingCompany && existingCompany.baseCurrencyId !== currency.id) {
        throw new CompanyProvisioningError('COMPANY_CURRENCY_MISMATCH');
      }
      const company = existingCompany
        ? await tx.company.update({ where: { id: existingCompany.id }, data: { name: input.companyName, timezone: input.timezone, isActive: true } })
        : await tx.company.create({ data: { organizationId: organization.id, baseCurrencyId: currency.id, code: input.companyCode, name: input.companyName, timezone: input.timezone } });
      await tx.companyCurrency.upsert({
        where: { companyId_currencyId: { companyId: company.id, currencyId: currency.id } },
        update: { isActive: true },
        create: { companyId: company.id, currencyId: currency.id },
      });

      const existingUser = await tx.user.findUnique({ where: { emailNormalized: input.adminEmail } });
      if (existingUser && !existingUser.isActive) throw new CompanyProvisioningError('ADMIN_USER_DISABLED');
      if (existingUser && options.requireNewAdminIdentity) throw new CompanyProvisioningError('ADMIN_USER_EXISTS');
      const admin = existingUser ?? await tx.user.create({ data: { emailNormalized: input.adminEmail, displayName: input.adminDisplayName, passwordHash } });
      await tx.userCompany.upsert({
        where: { userId_companyId: { userId: admin.id, companyId: company.id } },
        update: { isActive: true },
        create: { userId: admin.id, companyId: company.id },
      });

      const administratorRole = await tx.role.upsert({
        where: { companyId_code: { companyId: company.id, code: 'ADMINISTRATOR' } },
        update: { nameAr: 'مدير الشركة', isActive: true, isSystemRole: true },
        create: { companyId: company.id, code: 'ADMINISTRATOR', nameAr: 'مدير الشركة', isSystemRole: true },
      });
      for (const [code, module, descriptionAr] of permissionDefinitions) {
        const permission = await tx.permission.upsert({ where: { code }, update: { module, descriptionAr }, create: { code, module, descriptionAr } });
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: administratorRole.id, permissionId: permission.id } },
          update: {},
          create: { roleId: administratorRole.id, permissionId: permission.id },
        });
      }
      await tx.userCompanyRole.upsert({
        where: { userId_companyId_roleId: { userId: admin.id, companyId: company.id, roleId: administratorRole.id } },
        update: {},
        create: { userId: admin.id, companyId: company.id, roleId: administratorRole.id },
      });

      for (const definition of accountTypeDefinitions) {
        await tx.accountType.upsert({ where: { code: definition.code }, update: definition, create: definition });
      }
      const defaultChart = existingCompany ? null : await applyDefaultChartTemplate(tx, company.id);
      for (const method of paymentMethodDefinitions) {
        await tx.paymentMethod.upsert({
          where: { code: method.code },
          update: { ...method, isActive: true, scope: 'GLOBAL', companyId: null },
          create: { ...method, scope: 'GLOBAL' },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId: company.id,
          actorUserId: admin.id,
          action: existingCompany ? 'COMPANY_PROVISIONING_CONFIRMED' : 'COMPANY_PROVISIONED',
          entityType: 'COMPANY',
          entityId: company.id.toString(),
          details: { organizationCode: organization.code, companyCode: company.code, reusedAdminIdentity: Boolean(existingUser), ...(defaultChart ? { defaultChartTemplate: defaultChart.templateCode, defaultChartAccountsCreated: defaultChart.created } : {}) },
        },
      });

      return {
        organization: { id: organization.id.toString(), code: organization.code, name: organization.name },
        company: { id: company.id.toString(), code: company.code, name: company.name, timezone: company.timezone, baseCurrencyCode: currency.code },
        administrator: { id: admin.id.toString(), email: admin.emailNormalized, reusedIdentity: Boolean(existingUser) },
        permissionsGranted: permissionDefinitions.length,
        defaultChart: defaultChart ? { templateCode: defaultChart.templateCode, version: defaultChart.version, accountsCreated: defaultChart.created } : null,
      };
  }

  async provisionPrepared(
    rawInput: PreparedCompanyProvisioningInput,
    passwordHash: string,
    options: { requireNewAdminIdentity?: boolean } = {},
  ) {
    return this.prisma.$transaction(
      (tx) => this.provisionPreparedInTransaction(tx, rawInput, passwordHash, options),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 },
    );
  }
}
