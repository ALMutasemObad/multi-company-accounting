import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)('authentication with MariaDB', () => {
  beforeAll(async () => {
    await prisma!.session.deleteMany();
  });

  afterAll(async () => {
    await prisma!.session.deleteMany();
    await prisma!.$disconnect();
  });

  it('completes CSRF, login, company listing and context selection', async () => {
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    const app = createApp({
      NODE_ENV: 'test',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: databaseUrl,
    }, { auth });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ email: 'admin@mcap.local', password })
      .expect(200);
    expect(login.body.user.displayName).toBe('مدير النظام');
    const beforeContext = await agent.get('/api/v1/auth/me').expect(200);
    expect(beforeContext.body).toEqual({
      user: login.body.user,
      selectedCompany: null,
      permissions: [],
    });
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    expect(companies.body.data).toHaveLength(1);
    await agent.put('/api/v1/auth/context')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ companyId: companies.body.data[0].id })
      .expect(204);
    const current = await agent.get('/api/v1/auth/me').expect(200);
    expect(current.body.user).toEqual(login.body.user);
    expect(current.body.selectedCompany).toEqual(companies.body.data[0]);
    expect(current.body.permissions).toEqual([...current.body.permissions].sort());
    expect(current.body.permissions).toContain('auth.sessions.view');
    const sessions = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(sessions.body.data).toHaveLength(1);
    expect(sessions.body.data[0].current).toBe(true);
    const session = await prisma!.session.findFirstOrThrow({ where: { state: 'AUTHENTICATED' } });
    expect(session.selectedCompanyId?.toString()).toBe(companies.body.data[0].id);
    await agent.post(`/api/v1/auth/sessions/${session.id}/revoke`)
      .set('X-CSRF-Token', login.body.csrfToken)
      .expect(204);
    await agent.get('/api/v1/auth/companies').expect(401);
  });

  it('logs out the current session and expires its cookie', async () => {
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ email: 'admin@mcap.local', password }).expect(200);
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', login.body.csrfToken).expect(204);
    await agent.get('/api/v1/auth/companies').expect(401);
  });

  it('isolates capabilities by company and rejects inactive authorization context', async () => {
    const referenceCompany = await prisma!.company.findFirstOrThrow({
      select: { organizationId: true, baseCurrencyId: true },
    });
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    const isolatedCompany = await prisma!.company.create({
      data: {
        organizationId: referenceCompany.organizationId,
        baseCurrencyId: referenceCompany.baseCurrencyId,
        code: `AUTH-ME-${randomUUID()}`,
        name: 'شركة اختبار صلاحيات الجلسة',
        timezone: 'Asia/Riyadh',
      },
    });
    const role = await prisma!.role.create({
      data: {
        companyId: isolatedCompany.id,
        code: 'AUTH_ME_LIMITED',
        nameAr: 'دور محدود لاختبار سياق الجلسة',
      },
    });

    try {
      await prisma!.userCompany.create({
        data: { userId: admin.id, companyId: isolatedCompany.id },
      });
      const permissions = await prisma!.permission.findMany({
        where: { code: { in: ['auth.sessions.view', 'receipts.view'] } },
        select: { id: true, code: true },
      });
      expect(permissions).toHaveLength(2);
      await prisma!.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      });
      await prisma!.userCompanyRole.create({
        data: { userId: admin.id, companyId: isolatedCompany.id, roleId: role.id },
      });

      const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
      const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth });
      const agent = request.agent(app);
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ email: admin.emailNormalized, password }).expect(200);
      await agent.put('/api/v1/auth/context').set('X-CSRF-Token', login.body.csrfToken).send({ companyId: isolatedCompany.id.toString() }).expect(204);

      const current = await agent.get('/api/v1/auth/me').expect(200);
      expect(current.body.permissions).toEqual(['auth.sessions.view', 'receipts.view']);

      await prisma!.role.update({ where: { id: role.id }, data: { isActive: false } });
      expect((await agent.get('/api/v1/auth/me').expect(200)).body.permissions).toEqual([]);
      await prisma!.role.update({ where: { id: role.id }, data: { isActive: true } });

      await prisma!.userCompany.update({
        where: { userId_companyId: { userId: admin.id, companyId: isolatedCompany.id } },
        data: { isActive: false },
      });
      await agent.get('/api/v1/auth/me').expect(403);
      await prisma!.userCompany.update({
        where: { userId_companyId: { userId: admin.id, companyId: isolatedCompany.id } },
        data: { isActive: true },
      });

      await prisma!.company.update({ where: { id: isolatedCompany.id }, data: { isActive: false } });
      await agent.get('/api/v1/auth/me').expect(403);
      await agent.get('/api/v1/auth/sessions').expect(403);
    } finally {
      await prisma!.company.update({ where: { id: isolatedCompany.id }, data: { isActive: true } }).catch(() => undefined);
      await prisma!.session.deleteMany({ where: { selectedCompanyId: isolatedCompany.id } });
      await prisma!.securityEvent.deleteMany({ where: { companyId: isolatedCompany.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { companyId: isolatedCompany.id } });
      await prisma!.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma!.role.deleteMany({ where: { companyId: isolatedCompany.id } });
      await prisma!.userCompany.deleteMany({ where: { companyId: isolatedCompany.id } });
      await prisma!.company.delete({ where: { id: isolatedCompany.id } });
    }
  });
});
