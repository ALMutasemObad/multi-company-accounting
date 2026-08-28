import { hash } from 'argon2';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AuditAppendPort } from './audit-append-port.js';
import {
  CompanyProvisioningError,
  type AccountingCompanyProvisioningPort,
  type IdentityCompanyProvisioningPort,
  type TenantCompanyProvisioningPort,
  type TreasuryCompanyProvisioningPort,
} from './company-provisioning-ports.js';

export { CompanyProvisioningError } from './company-provisioning-ports.js';

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

export class CompanyProvisioningService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenant: TenantCompanyProvisioningPort,
    private readonly identity: IdentityCompanyProvisioningPort,
    private readonly accounting: AccountingCompanyProvisioningPort,
    private readonly treasury: TreasuryCompanyProvisioningPort,
    private readonly audit: AuditAppendPort,
  ) {}

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
    if (!passwordHash || passwordHash.length > 255) {
      throw new TypeError('A valid prepared password hash is required');
    }

    const tenant = await this.tenant.provisionTenant(tx, input);
    const identity = await this.identity.provisionAdministrator(tx, {
      companyId: tenant.company.id,
      email: input.adminEmail,
      displayName: input.adminDisplayName,
      passwordHash,
      requireNewIdentity: options.requireNewAdminIdentity ?? false,
    });
    const defaultChart = await this.accounting.provisionAccounting(
      tx,
      tenant.company.id,
      tenant.created,
    );
    await this.treasury.provisionTreasury(tx);
    await this.audit.append(tx, {
      companyId: tenant.company.id,
      actorUserId: identity.administrator.id,
      action: tenant.created ? 'COMPANY_PROVISIONED' : 'COMPANY_PROVISIONING_CONFIRMED',
      entityType: 'COMPANY',
      entityId: tenant.company.id.toString(),
      details: {
        organizationCode: tenant.organization.code,
        companyCode: tenant.company.code,
        reusedAdminIdentity: identity.reusedIdentity,
        ...(defaultChart ? {
          defaultChartTemplate: defaultChart.templateCode,
          defaultChartAccountsCreated: defaultChart.accountsCreated,
        } : {}),
      },
    });

    return {
      organization: {
        id: tenant.organization.id.toString(),
        code: tenant.organization.code,
        name: tenant.organization.name,
      },
      company: {
        id: tenant.company.id.toString(),
        code: tenant.company.code,
        name: tenant.company.name,
        timezone: tenant.company.timezone,
        baseCurrencyCode: tenant.baseCurrency.code,
      },
      administrator: {
        id: identity.administrator.id.toString(),
        email: identity.administrator.email,
        reusedIdentity: identity.reusedIdentity,
      },
      permissionsGranted: identity.permissionsGranted,
      defaultChart,
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
