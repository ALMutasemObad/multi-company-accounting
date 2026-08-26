import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createDatabase } from '../src/database.js';
import { CompanyProvisioningService } from '../src/platform/company-provisioning-service.js';
import { permissionDefinitions } from '../src/platform/reference-data.js';
import { DEFAULT_CHART_TEMPLATE_CODE, DEFAULT_CHART_TEMPLATE_VERSION, defaultChartDefinitions } from '../src/accounts/default-chart-template.js';

const runDatabaseTests = process.env.RUN_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const suite = runDatabaseTests ? describe : describe.skip;

suite('multi-company provisioning integration', () => {
  let prisma: PrismaClient;
  const organizationCode = 'IT-PROVISIONING';
  const adminEmail = 'it.provisioning@mcap.local';

  async function cleanup() {
    const organization = await prisma.organization.findUnique({ where: { code: organizationCode }, include: { companies: { select: { id: true } } } });
    if (organization) {
      const companyIds = organization.companies.map(({ id }) => id);
      const roles = await prisma.role.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
      await prisma.companyExchangeRate.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.companyCurrency.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.securityEvent.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.userCompanyRole.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map(({ id }) => id) } } });
      await prisma.role.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.userCompany.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.account.updateMany({ where: { companyId: { in: companyIds } }, data: { parentAccountId: null } });
      await prisma.account.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
    const user = await prisma.user.findUnique({ where: { emailNormalized: adminEmail }, include: { _count: { select: { assignments: true, sessions: true } } } });
    if (user && user._count.assignments === 0 && user._count.sessions === 0) await prisma.user.delete({ where: { id: user.id } });
  }

  beforeAll(async () => {
    prisma = createDatabase(process.env.DATABASE_URL!);
    await cleanup();
    await prisma.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'SAR' } },
      update: { isActive: true, scope: 'GLOBAL', ownerCompanyId: null },
      create: { code: 'SAR', nameAr: 'ريال سعودي', decimals: 2, scope: 'GLOBAL', scopeKey: 'GLOBAL' },
    });
  });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it('provisions two isolated companies for one global identity and safely replays', async () => {
    const service = new CompanyProvisioningService(prisma);
    const base = {
      organizationCode,
      organizationName: 'مؤسسة اختبار التجهيز',
      companyName: 'شركة الاختبار الأولى',
      timezone: 'Asia/Riyadh',
      baseCurrencyCode: 'SAR',
      adminEmail,
      adminDisplayName: 'مدير اختبار التجهيز',
      adminPassword: 'Provisioning-Integration-2026!',
    };
    const first = await service.provision({ ...base, companyCode: 'COMPANY-A' });
    const second = await service.provision({ ...base, companyCode: 'COMPANY-B', companyName: 'شركة الاختبار الثانية' });
    const replay = await service.provision({ ...base, companyCode: 'COMPANY-A' });

    expect(replay.company.id).toBe(first.company.id);
    expect(first.defaultChart).toEqual({ templateCode: DEFAULT_CHART_TEMPLATE_CODE, version: DEFAULT_CHART_TEMPLATE_VERSION, accountsCreated: defaultChartDefinitions.length });
    expect(replay.defaultChart).toBeNull();
    expect(second.company.id).not.toBe(first.company.id);
    expect(second.administrator.id).toBe(first.administrator.id);
    expect(second.administrator.reusedIdentity).toBe(true);

    const userId = BigInt(first.administrator.id);
    expect(await prisma.userCompany.count({ where: { userId } })).toBe(2);
    for (const companyId of [BigInt(first.company.id), BigInt(second.company.id)]) {
      const role = await prisma.role.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'ADMINISTRATOR' } }, include: { _count: { select: { permissions: true } } } });
      expect(role._count.permissions).toBe(permissionDefinitions.length);
      expect(await prisma.userCompanyRole.count({ where: { userId, companyId, roleId: role.id } })).toBe(1);
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      expect(await prisma.companyCurrency.count({ where: { companyId, currencyId: company.baseCurrencyId, isActive: true } })).toBe(1);
      expect(await prisma.account.count({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE } })).toBe(defaultChartDefinitions.length);
    }
  }, 20_000);
});
