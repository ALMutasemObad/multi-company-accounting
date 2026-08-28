import { hash, verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { UserService } from '../src/users/user-service.js';
import { CompanyService } from '../src/companies/company-service.js';
import { WorkforceAccessService } from '../src/workforce-access/workforce-access-service.js';
import { HrEmployeeAccountAdapter } from '../src/hr/employee-account-adapter.js';
import { IdentityAccountAdapter } from '../src/users/identity-account-adapter.js';

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
  let companyId: bigint;
  let employeePublicId: string;

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: admin.id, isActive: true } })).companyId;
    const existing = await prisma!.user.findUnique({ where: { emailNormalized: testEmail } });
    if (existing) {
      await prisma!.employee.updateMany({ where: { companyId, userId: existing.id }, data: { userId: null } });
      await prisma!.auditLog.deleteMany({ where: { entityType: 'USER', entityId: existing.id.toString() } });
      await prisma!.session.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: existing.id } });
      await prisma!.user.delete({ where: { id: existing.id } });
    }
    await prisma!.employee.deleteMany({ where: { companyId, employeeNumber: 'IT-EMP-USER' } });
    await prisma!.idempotencyRecord.deleteMany({
      where: { companyId, userId: admin.id, operation: { in: ['CREATE_EMPLOYEE_USER_ACCOUNT', 'LINK_EMPLOYEE_USER_ACCOUNT'] } },
    });
    const employee = await prisma!.employee.create({
      data: {
        companyId,
        employeeNumber: 'IT-EMP-USER',
        nameAr: 'موظف التكامل',
        nameEn: 'Integration Employee',
        employmentType: 'FULL_TIME',
        hireDate: new Date('2058-01-01T00:00:00.000Z'),
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    employeePublicId = employee.publicId;
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    const workforceAccess = new WorkforceAccessService(prisma!, new HrEmployeeAccountAdapter(prisma!), new IdentityAccountAdapter(prisma!));
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, users: new UserService(prisma!), workforceAccess, companies: new CompanyService(prisma!) });
  });

  afterAll(async () => {
    const user = await prisma!.user.findUnique({ where: { emailNormalized: testEmail } });
    if (user) {
      await prisma!.employee.updateMany({ where: { companyId, userId: user.id }, data: { userId: null } });
      await prisma!.auditLog.deleteMany({ where: { entityType: 'USER', entityId: user.id.toString() } });
      await prisma!.session.deleteMany({ where: { userId: user.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: user.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: user.id } });
      await prisma!.user.delete({ where: { id: user.id } });
    }
    await prisma!.employee.deleteMany({ where: { companyId, employeeNumber: 'IT-EMP-USER' } });
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ['CREATE_EMPLOYEE_USER_ACCOUNT', 'LINK_EMPLOYEE_USER_ACCOUNT'] } } });
    await prisma!.$disconnect();
  });

  it('creates, updates, assigns a role and disables a user with audit records', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);

    const optionsBefore = await admin.agent.get('/api/v1/users/employee-options').expect(200);
    expect(optionsBefore.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: employeePublicId, employeeNumber: 'IT-EMP-USER' })]));
    const createKey = 'it-user-from-employee-0001';
    const payload = { employeeId: employeePublicId, email: testEmail, temporaryPassword: testPassword };
    const created = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', createKey).send(payload).expect(201);
    expect(created.body.status).toBe('ACTIVE');
    expect(created.body.nameAr).toBe('موظف التكامل');
    expect(created.body.employee).toMatchObject({ id: employeePublicId, employeeNumber: 'IT-EMP-USER' });
    expect((await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', createKey).send(payload).expect(201)).body).toEqual(created.body);
    const mismatch = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', createKey).send({ ...payload, email: 'changed.payload@mcap.local' }).expect(409);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_MISMATCH');
    expect((await prisma!.employee.findUniqueOrThrow({ where: { publicId: employeePublicId } })).userId?.toString()).toBe(created.body.id);
    expect((await admin.agent.get('/api/v1/users/employee-options').expect(200)).body.data.some((item: { id: string }) => item.id === employeePublicId)).toBe(false);
    const userId = created.body.id as string;

    const userAgent = await authenticatedAgent(app, testEmail, testPassword);
    const userCompanies = await userAgent.agent.get('/api/v1/auth/companies').expect(200);
    await userAgent.agent.put('/api/v1/auth/context').set('X-CSRF-Token', userAgent.csrfToken).send({ companyId: userCompanies.body.data[0].id }).expect(204);
    await userAgent.agent.get('/api/v1/users').expect(403);
    const managedUpdate = await admin.agent.patch(`/api/v1/users/${userId}`).set('X-CSRF-Token', admin.csrfToken).send({ nameAr: 'اسم مكرر غير مسموح' }).expect(422);
    expect(managedUpdate.body.code).toBe('EMPLOYEE_MANAGED_PROFILE');

    const roles = await admin.agent.get('/api/v1/roles').expect(200);
    await admin.agent.put(`/api/v1/users/${userId}/roles`).set('X-CSRF-Token', admin.csrfToken).send({ roleIds: [roles.body.data[0].id] }).expect(200);
    await userAgent.agent.get('/api/v1/auth/companies').expect(401);

    const disabled = await admin.agent.post(`/api/v1/users/${userId}/disable`).set('X-CSRF-Token', admin.csrfToken).send({ reason: 'تعطيل مستخدم اختبار التكامل' }).expect(200);
    expect(disabled.body.status).toBe('DISABLED');
    await userAgent.agent.get('/api/v1/auth/companies').expect(401);

    const audits = await prisma!.auditLog.findMany({ where: { entityType: 'USER', entityId: userId } });
    expect(audits.map((item) => item.action)).toEqual(expect.arrayContaining(['USER_CREATED_FROM_EMPLOYEE', 'USER_ROLES_REPLACED', 'USER_DISABLED']));
    expect(await prisma!.auditLog.count({ where: { entityType: 'EMPLOYEE', entityId: employeePublicId, action: 'EMPLOYEE_USER_LINKED' } })).toBe(1);
  });

  it('links a legacy account without re-entering names and replays safely', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const adminUser = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    const employee = await prisma!.employee.create({ data: { companyId, employeeNumber: 'IT-EMP-LINK', nameAr: 'موظف الربط القديم', nameEn: 'Legacy Linked Employee', employmentType: 'FULL_TIME', hireDate: new Date('2058-02-01T00:00:00.000Z'), createdById: adminUser.id, updatedById: adminUser.id } });
    const legacy = await prisma!.user.create({ data: { emailNormalized: 'legacy.link@mcap.local', displayName: 'اسم قديم', passwordHash: await hash('Legacy-Link-2026!') } });
    await prisma!.userCompany.create({ data: { userId: legacy.id, companyId } });
    const key = 'it-link-legacy-employee-0001';
    try {
      const linked = await admin.agent.post(`/api/v1/users/${legacy.id}/employee-link`).set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', key).send({ employeeId: employee.publicId }).expect(200);
      expect(linked.body).toMatchObject({ id: legacy.id.toString(), nameAr: employee.nameAr, employee: { id: employee.publicId } });
      expect((await admin.agent.post(`/api/v1/users/${legacy.id}/employee-link`).set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', key).send({ employeeId: employee.publicId }).expect(200)).body).toEqual(linked.body);
      expect((await prisma!.user.findUniqueOrThrow({ where: { id: legacy.id } })).displayName).toBe(employee.nameAr);
    } finally {
      await prisma!.employee.updateMany({ where: { id: employee.id }, data: { userId: null } });
      await prisma!.idempotencyRecord.deleteMany({ where: { companyId, userId: adminUser.id, operation: 'LINK_EMPLOYEE_USER_ACCOUNT' } });
      await prisma!.auditLog.deleteMany({ where: { OR: [{ entityType: 'USER', entityId: legacy.id.toString() }, { entityType: 'EMPLOYEE', entityId: employee.publicId }] } });
      await prisma!.userCompany.deleteMany({ where: { userId: legacy.id } });
      await prisma!.user.delete({ where: { id: legacy.id } });
      await prisma!.employee.delete({ where: { id: employee.id } });
    }
  });

  it('rolls back on duplicate email and allows only one concurrent account per employee', async () => {
    const admin = await authenticatedAgent(app, 'admin@mcap.local', adminPassword);
    const companies = await admin.agent.get('/api/v1/auth/companies').expect(200);
    await admin.agent.put('/api/v1/auth/context').set('X-CSRF-Token', admin.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const adminUser = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    const duplicateEmployee = await prisma!.employee.create({ data: { companyId, employeeNumber: 'IT-EMP-DUP', nameAr: 'موظف بريد مكرر', employmentType: 'FULL_TIME', hireDate: new Date('2058-03-01T00:00:00.000Z'), createdById: adminUser.id, updatedById: adminUser.id } });
    const concurrentEmployee = await prisma!.employee.create({ data: { companyId, employeeNumber: 'IT-EMP-RACE', nameAr: 'موظف سباق الحساب', employmentType: 'FULL_TIME', hireDate: new Date('2058-03-02T00:00:00.000Z'), createdById: adminUser.id, updatedById: adminUser.id } });
    const raceEmails = ['employee.race.a@mcap.local', 'employee.race.b@mcap.local'];
    try {
      const duplicate = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', 'it-user-duplicate-email-0001').send({ employeeId: duplicateEmployee.publicId, email: 'admin@mcap.local', temporaryPassword: 'Duplicate-Email-2026!' }).expect(409);
      expect(duplicate.body.code).toBe('EMAIL_EXISTS');
      expect((await prisma!.employee.findUniqueOrThrow({ where: { id: duplicateEmployee.id } })).userId).toBeNull();

      const responses = await Promise.all(raceEmails.map((email, index) => admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', `it-user-race-employee-000${index + 1}`).send({ employeeId: concurrentEmployee.publicId, email, temporaryPassword: `Employee-Race-2026-${index}!` })));
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(await prisma!.user.count({ where: { emailNormalized: { in: raceEmails } } })).toBe(1);
      expect((await prisma!.employee.findUniqueOrThrow({ where: { id: concurrentEmployee.id } })).userId).not.toBeNull();
    } finally {
      const raceUsers = await prisma!.user.findMany({ where: { emailNormalized: { in: raceEmails } }, select: { id: true } });
      await prisma!.employee.updateMany({ where: { id: { in: [duplicateEmployee.id, concurrentEmployee.id] } }, data: { userId: null } });
      await prisma!.idempotencyRecord.deleteMany({ where: { companyId, userId: adminUser.id, operation: 'CREATE_EMPLOYEE_USER_ACCOUNT' } });
      await prisma!.auditLog.deleteMany({ where: { OR: [{ entityType: 'EMPLOYEE', entityId: { in: [duplicateEmployee.publicId, concurrentEmployee.publicId] } }, { entityType: 'USER', entityId: { in: raceUsers.map((user) => user.id.toString()) } }] } });
      if (raceUsers.length) {
        await prisma!.userCompany.deleteMany({ where: { userId: { in: raceUsers.map((user) => user.id) } } });
        await prisma!.user.deleteMany({ where: { id: { in: raceUsers.map((user) => user.id) } } });
      }
      await prisma!.employee.deleteMany({ where: { id: { in: [duplicateEmployee.id, concurrentEmployee.id] } } });
    }
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
    const foreignEmployee = await prisma!.employee.create({ data: { companyId: foreignCompany.id, employeeNumber: 'IT-EMP-FOREIGN', nameAr: 'موظف شركة أخرى', employmentType: 'FULL_TIME', hireDate: new Date('2058-04-01T00:00:00.000Z'), createdById: foreignUser.id, updatedById: foreignUser.id } });
    try {
      await prisma!.userCompany.create({ data: { userId: foreignUser.id, companyId: foreignCompany.id } });
      await admin.agent.get(`/api/v1/users/${foreignUser.id}`).expect(404);
      const result = await admin.agent.get('/api/v1/users').query({ search: 'foreign.user@mcap.local' }).expect(200);
      expect(result.body.data).toHaveLength(0);
      const rejected = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrfToken).set('Idempotency-Key', 'it-user-foreign-employee-0001').send({ employeeId: foreignEmployee.publicId, email: 'foreign.employee.account@mcap.local', temporaryPassword: 'Foreign-Employee-2026!' }).expect(404);
      expect(rejected.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect(await prisma!.user.count({ where: { emailNormalized: 'foreign.employee.account@mcap.local' } })).toBe(0);
    } finally {
      await prisma!.userCompany.deleteMany({ where: { userId: foreignUser.id } });
      await prisma!.employee.delete({ where: { id: foreignEmployee.id } });
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
