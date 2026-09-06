import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth-service.js';
import { PasswordResetService } from '../src/auth/password-reset-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createOpaqueToken, hashToken } from '../src/auth/session-tokens.js';
import { createCompanyProvisioningService } from '../src/composition/create-company-provisioning-service.js';
import { createRegistrationOwnerPorts } from '../src/composition/create-registration-owner-ports.js';
import { createDatabase } from '../src/database.js';
import { permissionDefinitions } from '../src/platform/reference-data.js';
import type { SocialOidcProvider } from '../src/social-auth/oidc-provider-adapter.js';
import { SocialAuthError, SocialAuthService } from '../src/social-auth/social-auth-service.js';
import type { VerifiedProviderProfile } from '../src/social-auth/social-auth-policy.js';
import { createStartPlanFixture } from './subscription-start-plan-fixture.js';
import { testAuthOptions } from './helpers/test-auth-options.js';

const enabled = process.env.RUN_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const db = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
const secret = 'integration-social-onboarding-secret-123456789';
const form = {
  displayName: 'Social owner',
  organizationName: 'Social group',
  companyName: 'Social company',
  timezone: 'Asia/Riyadh',
  baseCurrencyCode: 'SAR',
  locale: 'en' as const,
  chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
  consent: true,
};

describe.runIf(enabled)('social signup onboarding on a real database', () => {
  let startPlan: Awaited<ReturnType<typeof createStartPlanFixture>>;

  beforeAll(async () => {
    await db!.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'SAR' } },
      update: { isActive: true },
      create: { code: 'SAR', nameAr: 'ريال سعودي', decimals: 2, scopeKey: 'GLOBAL', scope: 'GLOBAL' },
    });
    await db!.permission.createMany({
      data: permissionDefinitions.map(([code, module, descriptionAr]) => ({ code, module, descriptionAr })),
      skipDuplicates: true,
    });
    startPlan = await createStartPlanFixture(db!, 'SAR');
  }, 60_000);

  afterAll(async () => { await db!.$disconnect(); });

  const service = (profile: VerifiedProviderProfile, validPlan = true, now?: () => Date) => {
    const provider: SocialOidcProvider = {
      authorizationUrl: ({ state }) => `https://provider.test/auth?state=${encodeURIComponent(state)}`,
      exchange: async () => profile,
    };
    return new SocialAuthService(db!, {
      transactionSecret: secret,
      transactionTtlMinutes: 10,
      sessionTtlHours: 12,
      providers: { [profile.identity.provider]: provider },
      onboarding: {
        continuationTtlMinutes: 10,
        provisioning: createCompanyProvisioningService(db!, validPlan ? startPlan.version.id.toString() : ''),
        owners: createRegistrationOwnerPorts(db!),
      },
    }, undefined, now);
  };

  async function begin(profile: VerifiedProviderProfile, auth = service(profile)) {
    const sid = createOpaqueToken();
    const csrf = createOpaqueToken();
    await db!.session.create({ data: {
      tokenHash: hashToken(sid),
      csrfHash: hashToken(csrf),
      state: 'PRE_AUTH',
      expiresAt: new Date(Date.now() + 600_000),
    } });
    const browserBinding = createOpaqueToken();
    const started = await auth.start({
      provider: profile.identity.provider,
      purpose: 'SIGN_IN',
      sid,
      csrfToken: csrf,
      consent: false,
      browserBinding,
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const callback = await auth.callback({
      provider: profile.identity.provider,
      state,
      browserBinding,
      callback: new URL(`https://callback.test/?code=x&state=${state}`),
    });
    if (callback.kind !== 'onboarding_required') throw new Error(`Expected onboarding, got ${callback.kind}`);
    return { auth, sid, csrf, browserBinding, callback };
  }

  it('creates user, external identity, owner group, company, chart, subscription, and rotated session exactly once', async () => {
    const suffix = randomUUID();
    const profile: VerifiedProviderProfile = {
      identity: { provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: `subject-${suffix}` },
      email: { value: `social-${suffix}@example.test`, verified: true, privateRelay: false },
      displayName: 'Provider claim is not trusted as the submitted name',
    };
    const started = await begin(profile);
    const command = {
      sid: started.sid,
      csrfToken: started.csrf,
      continuation: started.callback.continuation,
      browserBinding: started.browserBinding,
      form,
    };
    const attempts = await Promise.allSettled([
      started.auth.completeOnboarding(command),
      started.auth.completeOnboarding(command),
    ]);
    const successes = attempts.filter((entry) => entry.status === 'fulfilled');
    expect(successes).toHaveLength(1);
    expect(attempts.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    const completed = successes[0]!.status === 'fulfilled' ? successes[0]!.value : null;
    expect(completed?.kind).toBe('completed');

    const identity = await db!.externalIdentity.findUniqueOrThrow({
      where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } },
      include: { user: true },
    });
    expect(identity.user).toMatchObject({
      emailNormalized: profile.email!.value,
      displayName: form.displayName,
      passwordHash: null,
    });
    const assignment = await db!.userCompany.findFirstOrThrow({
      where: { userId: identity.userId },
      include: { company: true },
    });
    expect(await db!.organizationMembership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: assignment.company.organizationId, userId: identity.userId } },
    })).toMatchObject({ role: 'OWNER', isActive: true });
    expect(await db!.account.count({ where: { companyId: assignment.companyId } })).toBeGreaterThan(0);
    expect(await db!.platformSubscription.findUnique({ where: { companyId: assignment.companyId } })).toMatchObject({ planVersionId: startPlan.version.id });
    expect(await db!.session.count({ where: { userId: identity.userId, revokedAt: null } })).toBe(1);
    expect(await db!.company.count({ where: { organizationId: assignment.company.organizationId } })).toBe(1);

    const continuation = await db!.socialOnboardingContinuation.findUniqueOrThrow({
      where: { tokenHash: hashToken(started.callback.continuation) },
    });
    expect(Buffer.from(continuation.tokenHash).equals(Buffer.from(hashToken(started.callback.continuation)))).toBe(true);
    expect(Buffer.from(continuation.protectedProfile).toString('utf8')).not.toContain(profile.identity.subject);
    expect(Buffer.from(continuation.protectedProfile).toString('utf8')).not.toContain(profile.email!.value);

    const auth = new AuthService(new PrismaAuthStore(db!), { verify }, testAuthOptions(db!));
    const loginCsrf = await auth.issueCsrf();
    await expect(auth.login({
      sid: loginCsrf.sid,
      csrfToken: loginCsrf.csrfToken,
      email: profile.email!.value,
      password: 'there-is-no-password',
    })).rejects.toMatchObject({ reason: 'INVALID_CREDENTIALS' });
    const append = vi.fn();
    const passwordReset = new PasswordResetService(db!, { hash: vi.fn() }, { append }, { tokenTtlMinutes: 60 });
    await expect(passwordReset.requestReset({ email: profile.email!.value, locale: 'en' })).resolves.toEqual({ status: 'ACCEPTED' });
    expect(append).not.toHaveBeenCalled();
  }, 90_000);

  it('binds the continuation to the original PRE_AUTH browser and rejects replay after cancellation', async () => {
    const suffix = randomUUID();
    const profile: VerifiedProviderProfile = {
      identity: { provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: `browser-${suffix}` },
      email: { value: `browser-${suffix}@example.test`, verified: true, privateRelay: false },
      displayName: null,
    };
    const started = await begin(profile);

    await expect(started.auth.onboardingOptions({
      sid: started.sid,
      continuation: started.callback.continuation,
      browserBinding: 'different-browser',
    })).rejects.toEqual(new SocialAuthError('ONBOARDING_INVALID'));
    await expect(started.auth.completeOnboarding({
      sid: started.sid,
      csrfToken: started.csrf,
      continuation: started.callback.continuation,
      browserBinding: 'different-browser',
      form,
    })).rejects.toEqual(new SocialAuthError('ONBOARDING_INVALID'));

    await started.auth.cancelOnboarding({
      sid: started.sid,
      csrfToken: started.csrf,
      continuation: started.callback.continuation,
      browserBinding: started.browserBinding,
    });
    await expect(started.auth.completeOnboarding({
      sid: started.sid,
      csrfToken: started.csrf,
      continuation: started.callback.continuation,
      browserBinding: started.browserBinding,
      form,
    })).rejects.toEqual(new SocialAuthError('ONBOARDING_INVALID'));
    expect(await db!.user.count({ where: { emailNormalized: profile.email!.value } })).toBe(0);
  });

  it('supports a verified Apple private relay address as the new account contact without changing identity semantics', async () => {
    const suffix = randomUUID();
    const profile: VerifiedProviderProfile = {
      identity: { provider: 'APPLE', issuer: 'https://appleid.apple.com', subject: `apple-${suffix}` },
      email: { value: `${suffix}@privaterelay.appleid.com`, verified: true, privateRelay: true },
      displayName: 'Apple claim',
    };
    const started = await begin(profile);
    const completed = await started.auth.completeOnboarding({
      sid: started.sid,
      csrfToken: started.csrf,
      continuation: started.callback.continuation,
      browserBinding: started.browserBinding,
      form: { ...form, displayName: 'Apple owner' },
    });

    expect(completed.kind).toBe('completed');
    const identity = await db!.externalIdentity.findUniqueOrThrow({
      where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } },
      include: { user: true },
    });
    expect(identity).toMatchObject({ provider: 'APPLE', emailSnapshot: profile.email!.value, privateRelay: true });
    expect(identity.user).toMatchObject({ emailNormalized: profile.email!.value, passwordHash: null });
  }, 90_000);
});
