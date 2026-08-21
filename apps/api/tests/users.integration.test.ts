import { hash, verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { UserService } from '../src/users/user-service.js';
import { CompanyService } from '../src/companies/company-service.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;
const testEmail = 'integration.user@mcap.local';
const testPassword = 'Integration-User-2026!';

async function authenticatedAgent(app: ReturnType<typeof createApp>, email: string, password: string) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ email, password }).expect(200);
  return { agent, csrfToken: login.body.csrfToken as string };
}

describe.runIf(enabled)('users and roles with MariaDB', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const existing = await prisma!.user.findUnique({ where: { emailNormalized: testEmail } });
    if (existing) {
      await prisma!.auditLog.deleteMany({ where: { entityType: 'USER', entityId: existing.id.toString() } });
      await prisma!.session.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: existing.id } });
      await prisma!.user.delete({ where: { id: existing.id } });
    }
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, users: new UserService(prisma!), companies: new CompanyService(prisma!) });
  });

  afterAll(async () => {
    const user = await prisma!.user.findUnique({ where: { emailNormalized: testEmail } });
    if (user) {
      await prisma!.auditLog.deleteMany({ where: { entityType: 'USER', entityId: user.id.toString() } });
      await prisma!.session.deleteMany({ where: { userId: user.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: user.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: user.id } });
      await prisma!.user.delete({ where: { id: user.id } });
    }
    await prisma!.$disconnect();
  });

  it('creates, updates, assigns a role and disables a user with audit records', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);

    const created = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).send({ email: testEmail, nameAr: 'مستخدم التكامل', nameEn: 'Integration User', temporaryPassword: testPassword }).expect(201);
    expect(created.body.status).toBe('ACTIVE');
    const userId = created.body.id as string;

    const userAgent = await authenticatedAgent(app, testEmail, testPassword);
    const userCompanies = await userAgent.agent.get('/api/v1/auth/companies').expect(200);
    await userAgent.agent.put('/api/v1/auth/context').set('X-CSRF-Token', userAgent.csrfToken).send({ companyId: userCompanies.body.data[0].id }).expect(204);
    await userAgent.agent.get('/api/v1/users').expect(403);
    const updated = await admin.agent.patch(`/api/v1/users/${userId}`).set('X-CSRF-Token', admin.csrfToken).send({ nameAr: 'مستخدم التكامل المحدث' }).expect(200);
    expect(updated.body.nameAr).toContain('المحدث');

    const roles = await admin.agent.get('/api/v1/roles').expect(200);
    await admin.agent.put(`/api/v1/users/${userId}/roles`).set('X-CSRF-Token', admin.csrfToken).send({ roleIds: [roles.body.data[0].id] }).expect(200);
    await userAgent.agent.get('/api/v1/auth/companies').expect(401);

    const disabled = await admin.agent.post(`/api/v1/users/${userId}/disable`).set('X-CSRF-Token', admin.csrfToken).send({ reason: 'تعطيل مستخدم اختبار التكامل' }).expect(200);
    expect(disabled.body.status).toBe('DISABLED');
    await userAgent.agent.get('/api/v1/auth/companies').expect(401);

    const audits = await prisma!.auditLog.findMany({ where: { entityType: 'USER', entityId: userId } });
    expect(audits.map((item) => item.action)).toEqual(expect.arrayContaining(['USER_CREATED', 'USER_UPDATED', 'USER_ROLES_REPLACED', 'USER_DISABLED']));
  });

  it('rejects changing the current administrator roles', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const me = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    await admin.agent.put(`/api/v1/users/${me.id}/roles`).set('X-CSRF-Token', admin.csrfToken).send({ roleIds: [] }).expect(422);
  });

  it('does not expose a user assigned only to another company', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const baseCompany = await prisma!.company.findUniqueOrThrow({ where: { id: BigInt(companies.body.data[0].id) } });
    const foreignCompany = await prisma!.company.create({ data: { organizationId: baseCompany.organizationId, baseCurrencyId: baseCompany.baseCurrencyId, name: 'شركة اختبار العزل', timezone: 'Asia/Riyadh' } });
    const foreignUser = await prisma!.user.create({ data: { emailNormalized: 'foreign.user@mcap.local', displayName: 'مستخدم شركة أخرى', passwordHash: await hash('Foreign-User-2026!') } });
    try {
      await prisma!.userCompany.create({ data: { userId: foreignUser.id, companyId: foreignCompany.id } });
      await admin.agent.get(`/api/v1/users/${foreignUser.id}`).expect(404);
      const result = await admin.agent.get('/api/v1/users').query({ search: 'foreign.user@mcap.local' }).expect(200);
      expect(result.body.data).toHaveLength(0);
    } finally {
      await prisma!.userCompany.deleteMany({ where: { userId: foreignUser.id } });
      await prisma!.user.delete({ where: { id: foreignUser.id } });
      await prisma!.company.delete({ where: { id: foreignCompany.id } });
    }
  });

  it('manages custom roles while protecting system roles', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const permissions = await admin.agent.get('/api/v1/permissions').expect(200);
    const created = await admin.agent.post('/api/v1/roles').set('X-CSRF-Token', admin.csrfToken).send({ nameAr: 'دور اختبار التكامل', permissionIds: [permissions.body.data[0].id] }).expect(201);
    const roleId = created.body.id as string;
    try {
      expect(created.body.permissionIds).toEqual([permissions.body.data[0].id]);
      expect(created.body.code).toMatch(/^ROL-[0-9]{6,}$/);
      await admin.agent.put(`/api/v1/roles/${roleId}/permissions`).set('X-CSRF-Token', admin.csrfToken).send({ permissionIds: permissions.body.data.slice(0, 2).map((item: { id: string }) => item.id) }).expect(200);
      const systemRole = (await admin.agent.get('/api/v1/roles').expect(200)).body.data.find((role: { isSystemRole: boolean }) => role.isSystemRole);
      await admin.agent.patch(`/api/v1/roles/${systemRole.id}`).set('X-CSRF-Token', admin.csrfToken).send({ nameAr: 'غير مسموح' }).expect(422);
      await admin.agent.post(`/api/v1/roles/${roleId}/deactivate`).set('X-CSRF-Token', admin.csrfToken).send({ reason: 'انتهاء اختبار التكامل' }).expect(200);
    } finally {
      await prisma!.auditLog.deleteMany({ where: { entityType: 'ROLE', entityId: roleId } });
      await prisma!.rolePermission.deleteMany({ where: { roleId: BigInt(roleId) } });
      await prisma!.role.deleteMany({ where: { id: BigInt(roleId) } });
    }
  });

  it('updates current company settings with audit logging', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    const companyId = companies.body.data[0].id as string;
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId }).expect(204);
    const before = await admin.agent.get('/api/v1/companies/current').expect(200);
    const next = !before.body.manualJournalMakerCheckerEnabled;
    await admin.agent.put('/api/v1/settings').set('X-CSRF-Token', admin.csrfToken).send({ settings: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: next }] }).expect(200);
    expect((await admin.agent.get('/api/v1/companies/current').expect(200)).body.manualJournalMakerCheckerEnabled).toBe(next);
    await admin.agent.put('/api/v1/settings').set('X-CSRF-Token', admin.csrfToken).send({ settings: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: before.body.manualJournalMakerCheckerEnabled }] }).expect(200);
    expect(await prisma!.auditLog.count({ where: { companyId: BigInt(companyId), action: 'COMPANY_SETTING_UPDATED' } })).toBeGreaterThan(0);
  });
});
