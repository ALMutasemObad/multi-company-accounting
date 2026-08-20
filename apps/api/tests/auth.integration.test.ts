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
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    expect(companies.body.data).toHaveLength(1);
    await agent.put('/api/v1/auth/context')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ companyId: companies.body.data[0].id })
      .expect(204);
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
});
