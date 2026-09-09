import { randomUUID } from 'node:crypto';
import { hash, verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createCompanyService } from '../src/composition/create-company-service.js';
import { createGroupCompanyOnboardingService } from '../src/composition/create-group-company-onboarding-service.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { permissionDefinitions } from '../src/platform/reference-data.js';
import { testAuthOptions } from './helpers/test-auth-options.js';
import { createStartPlanFixture } from './subscription-start-plan-fixture.js';
import { TenantCompanyProvisioningAdapter } from '../src/companies/company-provisioning-adapter.js';

const enabled = process.env.RUN_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const db = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)('company profile API on a real database', () => {
  let plan: Awaited<ReturnType<typeof createStartPlanFixture>>;
  let email: string;
  let userId: bigint;
  let companyId: bigint;
  let otherCompanyId: bigint;
  let emptyCompanyId: bigint;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await db!.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'YER' } },
      update: { isActive: true },
      create: { code: 'YER', nameAr: 'ريال يمني', decimals: 2, scopeKey: 'GLOBAL', scope: 'GLOBAL' },
    });
    await db!.permission.createMany({
      data: permissionDefinitions.map(([code, module, descriptionAr]) => ({ code, module, descriptionAr })),
      skipDuplicates: true,
    });
    plan = await createStartPlanFixture(db!, 'YER');
    const suffix = randomUUID();
    email = `company-profile-${suffix}@example.test`;
    const organization = await db!.organization.create({ data: { code: suffix, name: 'Profile group' } });
    const user = await db!.user.create({
      data: { emailNormalized: email, passwordHash: await hash('test-only-profile-password'), displayName: 'Profile owner' },
    });
    userId = user.id;
    await db!.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: 'OWNER' } });
    const onboarding = createGroupCompanyOnboardingService(db!, plan.version.id.toString());
    const first = await onboarding.create(user.id, organization.id, randomUUID(), {
      companyName: 'First profile company', phone: '+9671000001', countryCode: 'YE',
      primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES', chartTemplateCode: 'PROFESSIONAL_SERVICES',
      timezone: 'Asia/Aden', baseCurrencyCode: 'YER',
    });
    const second = await onboarding.create(user.id, organization.id, randomUUID(), {
      companyName: 'Second profile company', phone: '+9671000002', countryCode: 'YE',
      primaryBusinessActivityCode: 'MANUFACTURING', chartTemplateCode: 'MANUFACTURING',
      timezone: 'Asia/Aden', baseCurrencyCode: 'YER',
    });
    const empty = await onboarding.create(user.id, organization.id, randomUUID(), {
      companyName: 'Empty compliance company', phone: '+12025550123', countryCode: 'US',
      primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES', chartTemplateCode: 'PROFESSIONAL_SERVICES',
      timezone: 'UTC', baseCurrencyCode: 'YER',
    });
    companyId = BigInt(first.company.id);
    otherCompanyId = BigInt(second.company.id);
    emptyCompanyId = BigInt(empty.company.id);
    const auth = new AuthService(new PrismaAuthStore(db!), { verify }, testAuthOptions(db!));
    app = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL!,
    }, { auth, companies: createCompanyService(db!) });
  }, 60_000);

  afterAll(async () => { await db!.$disconnect(); });

  it('enforces session, company context, distinct permissions and CSRF while preserving company isolation', async () => {
    await request(app).get('/api/v1/company-profile').expect(401);
    const agent = request.agent(app);
    const preAuth = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', preAuth.body.csrfToken)
      .send({ email, password: 'test-only-profile-password' })
      .expect(200);
    await agent.put('/api/v1/auth/context')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ companyId: companyId.toString() })
      .expect(204);

    const profile = await agent.get('/api/v1/company-profile').expect(200);
    expect(profile.body).toMatchObject({
      profile: {
        companyId: companyId.toString(), tradeName: 'First profile company', countryCode: 'YE',
        phone: '+9671000001', initialChartTemplateCode: 'PROFESSIONAL_SERVICES', version: 0,
      },
      readiness: { enforcementMode: 'ADVISORY', grandfathered: false },
      brandingAssets: [
        { kind: 'LOGO', status: 'STORAGE_POLICY_REQUIRED', uploadSupported: false, metadataAccepted: false },
        { kind: 'LETTERHEAD', status: 'STORAGE_POLICY_REQUIRED', uploadSupported: false, metadataAccepted: false },
      ],
    });
    expect(profile.body.options.activities.map((activity: { code: string }) => activity.code)).toEqual(expect.arrayContaining([
      'PROFESSIONAL_SERVICES', 'RETAIL_TRADE', 'MANUFACTURING',
    ]));

    await agent.patch('/api/v1/company-profile').send({ version: 0, tradeName: 'No CSRF' }).expect(403);
    await agent.patch('/api/v1/company-profile')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ version: 0, tradeName: 'First company updated', phone: '+9671000099' })
      .expect(200);

    expect(await db!.companyProfile.findUniqueOrThrow({ where: { companyId } })).toMatchObject({
      tradeName: 'First company updated', phone: '+9671000099', version: 1,
    });
    expect(await db!.companyProfile.findUniqueOrThrow({ where: { companyId: otherCompanyId } })).toMatchObject({
      tradeName: 'Second profile company', phone: '+9671000002', version: 0,
    });
  }, 60_000);

  it('stores suffixes only, returns renewal state, and keeps full identifiers out of audit details', async () => {
    const agent = request.agent(app);
    const preAuth = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', preAuth.body.csrfToken)
      .send({ email, password: 'test-only-profile-password' })
      .expect(200);
    await agent.put('/api/v1/auth/context')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ companyId: companyId.toString() })
      .expect(204);

    const compliance = await agent.patch('/api/v1/company-compliance')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({
        version: 1, legalName: 'First Company Legal', legalForm: 'LLC',
        commercialRegistration: {
          documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-1234567890', issuingAuthority: 'Registry',
          issuedAt: '2026-01-01', expiresAt: '2026-09-30',
        },
        taxRegistration: {
          registrationType: 'VAT', countryCode: 'ye', number: 'VAT-0987654321',
          issuedAt: '2026-01-01', expiresAt: '2030-01-01',
        },
        nationalAddress: { countryCode: 'ye', city: 'Sana’a', district: 'Old City' },
      })
      .expect(200);

    expect(compliance.body).toMatchObject({
      version: 2,
      countryCode: 'YE',
      commercialRegistration: { numberLast4: '7890', renewalStatus: 'DUE_SOON' },
      taxRegistration: { countryCode: 'YE', numberLast4: '4321', renewalStatus: 'CURRENT' },
      nationalAddress: { countryCode: 'YE', city: 'Sana’a' },
    });
    expect(JSON.stringify(compliance.body)).not.toContain('CR-1234567890');
    expect(JSON.stringify(compliance.body)).not.toContain('VAT-0987654321');

    const audit = await db!.auditLog.findFirstOrThrow({
      where: { companyId, action: 'COMPANY_COMPLIANCE_UPDATED' },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(audit.details)).not.toContain('CR-1234567890');
    expect(JSON.stringify(audit.details)).not.toContain('VAT-0987654321');
    expect(await db!.companyRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({ numberLast4: '7890' });
    expect(await db!.companyTaxRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({ numberLast4: '4321', countryCode: 'YE' });
  }, 60_000);

  it('preserves verified nested fields on partial patches and resets verification only for changed evidence', async () => {
    const verifiedAt = new Date('2026-09-01T12:00:00.000Z');
    await db!.companyRegistration.updateMany({ where: { companyId }, data: { status: 'VERIFIED', verifiedAt } });
    await db!.companyTaxRegistration.updateMany({ where: { companyId }, data: { status: 'VERIFIED', verifiedAt } });
    const profiles = createCompanyService(db!).profiles;
    const context = { companyId, userId };

    await profiles.updateCompliance(context, { version: 2, legalName: 'Legal name only' });
    expect(await db!.companyRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '7890', issuingAuthority: 'Registry', status: 'VERIFIED', verifiedAt,
    });
    expect(await db!.companyTaxRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '4321', status: 'VERIFIED', verifiedAt,
    });

    await profiles.updateCompliance(context, {
      version: 3,
      commercialRegistration: { documentType: 'COMMERCIAL_REGISTRATION', expiresAt: '2026-09-30' },
      taxRegistration: { registrationType: 'VAT', countryCode: 'YE', expiresAt: '2030-01-01' },
      nationalAddress: { countryCode: 'YE', city: 'Aden' },
    });
    expect(await db!.companyRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '7890', issuingAuthority: 'Registry', issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-30T00:00:00.000Z'), status: 'VERIFIED', verifiedAt,
    });
    expect(await db!.companyTaxRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '4321', issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'), status: 'VERIFIED', verifiedAt,
    });
    expect(await db!.companyAddress.findFirstOrThrow({ where: { companyId, type: 'NATIONAL' } })).toMatchObject({
      district: 'Old City', city: 'Aden', countryCode: 'YE',
    });

    await profiles.updateCompliance(context, {
      version: 4,
      commercialRegistration: { documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-1234567890' },
      taxRegistration: { registrationType: 'VAT', countryCode: 'YE', number: 'VAT-0987654321' },
    });
    expect(await db!.companyRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '7890', issuingAuthority: 'Registry', status: 'DECLARED', verifiedAt: null,
    });
    expect(await db!.companyTaxRegistration.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      numberLast4: '4321', status: 'DECLARED', verifiedAt: null,
    });
  }, 60_000);

  it('serializes country and compliance writes and rejects mismatched compliance countries', async () => {
    const profiles = createCompanyService(db!).profiles;
    const context = { companyId: otherCompanyId, userId };
    await expect(profiles.updateCompliance(context, {
      version: 0,
      taxRegistration: { registrationType: 'VAT', countryCode: 'SA', number: 'VAT-1234' },
    })).rejects.toMatchObject({ reason: 'COUNTRY_MISMATCH' });
    await expect(profiles.updateCompliance(context, {
      version: 0,
      nationalAddress: { countryCode: 'SA', city: 'Riyadh' },
    })).rejects.toMatchObject({ reason: 'COUNTRY_MISMATCH' });

    const outcomes = await Promise.allSettled([
      profiles.updateProfile(context, { version: 0, countryCode: 'SA' }),
      profiles.updateCompliance(context, { version: 0, nationalAddress: { countryCode: 'YE', city: 'Aden' } }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const stored = await db!.companyProfile.findUniqueOrThrow({ where: { companyId: otherCompanyId } });
    expect(stored.version).toBe(1);
    expect(stored.complianceVersion).toBe(1);
    const address = await db!.companyAddress.findUnique({ where: { companyId_type: { companyId: otherCompanyId, type: 'NATIONAL' } } });
    expect(address ? { profileCountry: stored.countryCode, addressCountry: address.countryCode } : { profileCountry: stored.countryCode, addressCountry: null })
      .toEqual(address
        ? { profileCountry: 'YE', addressCountry: 'YE' }
        : { profileCountry: 'SA', addressCountry: null });
    await expect(profiles.updateProfile(context, { version: 0, phone: '+9671999999' }))
      .rejects.toMatchObject({ reason: 'VERSION_CONFLICT' });
    await expect(profiles.updateCompliance(context, {
      version: 0,
      nationalAddress: { countryCode: stored.countryCode!, city: 'Stale replay' },
    })).rejects.toMatchObject({ reason: 'VERSION_CONFLICT' });
    expect(await db!.companyProfile.findUniqueOrThrow({ where: { companyId: otherCompanyId } })).toMatchObject({
      version: 1,
      complianceVersion: 1,
    });
  }, 60_000);

  it('rejects mismatched tenant reprovisioning and leaves a versioned profile with compliance untouched', async () => {
    const company = await db!.company.findUniqueOrThrow({
      where: { id: emptyCompanyId },
      include: {
        organization: true,
        baseCurrency: true,
        profile: { include: { primaryBusinessActivity: true } },
      },
    });
    await db!.companyRegistration.create({ data: { companyId: emptyCompanyId, documentType: 'REPLAY_GUARD' } });
    const before = await db!.companyProfile.findUniqueOrThrow({ where: { companyId: emptyCompanyId } });
    const adapter = new TenantCompanyProvisioningAdapter();
    const replay = {
      organizationCode: company.organization.code,
      organizationName: company.organization.name,
      companyCode: company.code,
      companyName: company.name,
      timezone: company.timezone,
      baseCurrencyCode: company.baseCurrency.code,
      businessProfile: {
        phone: company.profile!.phone!,
        countryCode: company.profile!.countryCode!,
        primaryBusinessActivityCode: company.profile!.primaryBusinessActivity!.code,
        preferredLocale: company.profile!.preferredLocale!,
        initialChartTemplateCode: company.profile!.initialChartTemplateCode!,
      },
    };

    await expect(db!.$transaction(tx => adapter.provisionTenant(tx, {
      ...replay,
      businessProfile: { ...replay.businessProfile, countryCode: 'YE' },
    }))).rejects.toMatchObject({ reason: 'INVALID_BUSINESS_PROFILE' });
    expect(await db!.companyProfile.findUniqueOrThrow({ where: { companyId: emptyCompanyId } })).toEqual(before);
    expect(await db!.companyRegistration.count({ where: { companyId: emptyCompanyId } })).toBe(1);

    await expect(db!.$transaction(tx => adapter.provisionTenant(tx, replay))).resolves.toMatchObject({
      created: false,
      company: { id: emptyCompanyId },
    });
    expect(await db!.companyProfile.findUniqueOrThrow({ where: { companyId: emptyCompanyId } })).toEqual(before);
  }, 60_000);

  it('does not count structurally empty compliance rows as completed requirements', async () => {
    await db!.companyRegistration.create({ data: { companyId: emptyCompanyId, documentType: 'EMPTY_REGISTRATION' } });
    await db!.companyTaxRegistration.create({ data: { companyId: emptyCompanyId, registrationType: 'EMPTY_TAX', countryCode: 'US' } });
    await db!.companyAddress.create({ data: { companyId: emptyCompanyId, type: 'NATIONAL', countryCode: 'US' } });
    const result = await createCompanyService(db!).profiles.getProfile({ companyId: emptyCompanyId, userId });
    for (const code of ['COMMERCIAL_REGISTRATION', 'TAX_REGISTRATION', 'NATIONAL_ADDRESS']) {
      expect(result.readiness.requirements.find((item) => item.code === code)).toMatchObject({ status: 'OPTIONAL' });
    }
  }, 60_000);

  it('keeps grandfathered accounts usable when the progressive profile is incomplete', async () => {
    await db!.companyProfile.update({
      where: { companyId: otherCompanyId },
      data: {
        countryCode: null, phone: null, primaryBusinessActivityId: null, legalName: null,
        initialChartTemplateCode: 'SMALL_BUSINESS_GENERAL', grandfatheredAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    });
    const agent = request.agent(app);
    const preAuth = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', preAuth.body.csrfToken)
      .send({ email, password: 'test-only-profile-password' })
      .expect(200);
    await agent.put('/api/v1/auth/context')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ companyId: otherCompanyId.toString() })
      .expect(204);

    const profile = await agent.get('/api/v1/company-profile').expect(200);
    expect(profile.body.readiness).toMatchObject({
      enforcementMode: 'ADVISORY', grandfathered: true,
    });
    expect(profile.body.readiness.missingRequirements).toEqual(expect.arrayContaining([
      'COUNTRY', 'PRIMARY_BUSINESS_ACTIVITY', 'BUSINESS_PHONE', 'LEGAL_NAME',
    ]));
    await agent.get('/api/v1/companies/current').expect(200);
  }, 60_000);
});
