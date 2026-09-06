import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { createDatabase } from '../src/database.js';
import { createOpaqueToken, hashToken } from '../src/auth/session-tokens.js';
import { SocialAuthError, SocialAuthService } from '../src/social-auth/social-auth-service.js';
import type { SocialOidcProvider } from '../src/social-auth/oidc-provider-adapter.js';
import { createApp } from '../src/app.js';
import request from 'supertest';

const enabled = process.env.RUN_DB_TESTS === 'true';
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? '') : null;
const profile = { identity: { provider: 'GOOGLE' as const, issuer: 'https://accounts.google.com', subject: 'social-integration-subject' }, email: { value: 'changed-contact@example.test', verified: true, privateRelay: false }, displayName: 'Verified profile' };

const fakeProvider: SocialOidcProvider = {
  authorizationUrl: ({ state, nonce, codeChallenge }) => `https://issuer.example.test/auth?state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}&code_challenge=${encodeURIComponent(codeChallenge)}`,
  exchange: async ({ state, nonce, codeVerifier }) => {
    expect(state.length).toBeGreaterThan(20);
    expect(nonce.length).toBeGreaterThan(20);
    expect(codeVerifier.length).toBeGreaterThan(40);
    return profile;
  },
};
const fakeAppleProvider: SocialOidcProvider = {
  authorizationUrl: ({ state }) => `https://appleid.apple.com/auth/authorize?state=${encodeURIComponent(state)}`,
  exchange: async () => ({
    identity: { provider: 'APPLE', issuer: 'https://appleid.apple.com', subject: 'social-linking-apple-subject' },
    email: { value: 'relay@privaterelay.appleid.com', verified: true, privateRelay: true },
    displayName: 'Apple User',
  }),
};

describe.runIf(enabled)('social authentication persistence and races', () => {
  beforeEach(async () => {
    await prisma!.socialOnboardingContinuation.deleteMany();
    await prisma!.socialAuthorizationTransaction.deleteMany();
    await prisma!.externalIdentity.deleteMany({ where: { subject: profile.identity.subject } });
    await prisma!.externalIdentity.deleteMany({ where: { issuer: { in: ['https://linking.google.test', 'https://linking.apple.test'] } } });
    await prisma!.session.deleteMany();
  });
  afterAll(async () => { await prisma!.$disconnect(); });

  const onboarding = { continuationTtlMinutes: 10, provisioning: {} as never, owners: {} as never };
  const service = () => new SocialAuthService(prisma!, { transactionSecret: 'integration-social-transaction-secret-123456789', transactionTtlMinutes: 10, sessionTtlHours: 12, providers: { GOOGLE: fakeProvider }, onboarding });
  async function preAuth() {
    const sid = createOpaqueToken(); const csrf = createOpaqueToken();
    await prisma!.session.create({ data: { tokenHash: hashToken(sid), csrfHash: hashToken(csrf), state: 'PRE_AUTH', expiresAt: new Date(Date.now() + 600_000) } });
    return { sid, csrf };
  }
  async function authenticated(authenticatedAt = new Date()) {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: 'admin@mcap.local' },
      include: { assignments: { where: { isActive: true }, take: 1 } },
    });
    const sid = createOpaqueToken(); const csrf = createOpaqueToken();
    const session = await prisma!.session.create({ data: {
      tokenHash: hashToken(sid), csrfHash: hashToken(csrf), state: 'AUTHENTICATED', userId: user.id,
      ...(user.assignments[0] ? { selectedCompanyId: user.assignments[0].companyId } : {}),
      authenticatedAt, expiresAt: new Date(Date.now() + 600_000),
    } });
    return { user, session, sid, csrf };
  }

  it('lists configured providers without exposing identity claims and reports stale authentication', async () => {
    const current = await authenticated(new Date(Date.now() - 11 * 60_000));
    await prisma!.externalIdentity.create({ data: {
      userId: current.user.id,
      provider: 'GOOGLE',
      issuer: 'https://linking.google.test',
      subject: 'private-subject-never-returned',
      emailSnapshot: 'private-email@example.test',
    } });

    const result = await service().accounts({ sid: current.sid });

    expect(result.recentAuthenticationRequired).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ provider: 'GOOGLE', status: 'LINKED' });
    expect(JSON.stringify(result)).not.toContain('private-subject-never-returned');
    expect(JSON.stringify(result)).not.toContain('private-email@example.test');
    expect(JSON.stringify(result)).not.toContain('issuer');

    const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL }, { socialAuth: service() });
    const response = await request(app).get('/api/v1/auth/social/accounts').set('Cookie', `sid=${current.sid}`).expect(200);
    expect(response.body).toMatchObject({ recentAuthenticationRequired: true, data: [{ provider: 'GOOGLE', status: 'LINKED' }] });
    expect(JSON.stringify(response.body)).not.toMatch(/issuer|subject|email|token/iu);
  });

  it('requires recent authentication, CSRF, and another factor before unlinking', async () => {
    const current = await authenticated();
    const stale = await authenticated(new Date(Date.now() - 11 * 60_000));
    const originalHash = current.user.passwordHash;
    await prisma!.user.update({ where: { id: current.user.id }, data: { passwordHash: null } });
    await prisma!.externalIdentity.create({ data: {
      userId: current.user.id, provider: 'GOOGLE', issuer: 'https://linking.google.test', subject: 'last-factor',
    } });
    try {
      await expect(service().unlink({ provider: 'GOOGLE', sid: current.sid, csrfToken: current.csrf, consent: false }))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(service().unlink({ provider: 'GOOGLE', sid: stale.sid, csrfToken: stale.csrf, consent: true }))
        .rejects.toMatchObject({ code: 'RECENT_AUTHENTICATION_REQUIRED' });
      await expect(service().unlink({ provider: 'GOOGLE', sid: current.sid, csrfToken: 'wrong', consent: true }))
        .rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      await expect(service().unlink({ provider: 'GOOGLE', sid: current.sid, csrfToken: current.csrf, consent: true }))
        .rejects.toMatchObject({ code: 'LAST_SIGN_IN_METHOD' });
      expect(await prisma!.externalIdentity.count({ where: { userId: current.user.id } })).toBe(1);
    } finally {
      await prisma!.externalIdentity.deleteMany({ where: { userId: current.user.id, issuer: 'https://linking.google.test' } });
      await prisma!.user.update({ where: { id: current.user.id }, data: { passwordHash: originalHash } });
    }
  });

  it('unlinks from a password account and appends the security event in the same transaction', async () => {
    const current = await authenticated();
    const identity = await prisma!.externalIdentity.create({ data: {
      userId: current.user.id, provider: 'GOOGLE', issuer: 'https://linking.google.test', subject: 'password-account',
    } });

    await service().unlink({
      provider: 'GOOGLE', sid: current.sid, csrfToken: current.csrf, consent: true,
      metadata: { ipAddress: '127.0.0.1', userAgent: 'integration-test' },
    });

    expect(await prisma!.externalIdentity.findUnique({ where: { id: identity.id } })).toBeNull();
    expect(await prisma!.securityEvent.count({
      where: { userId: current.user.id, sessionId: current.session.id, eventType: 'SOCIAL_IDENTITY_UNLINKED' },
    })).toBeGreaterThan(0);
  });

  it('serializes concurrent unlinks so a social-only account keeps one provider', async () => {
    const current = await authenticated();
    const originalHash = current.user.passwordHash;
    await prisma!.user.update({ where: { id: current.user.id }, data: { passwordHash: null } });
    await prisma!.externalIdentity.createMany({ data: [
      { userId: current.user.id, provider: 'GOOGLE', issuer: 'https://linking.google.test', subject: 'race-google' },
      { userId: current.user.id, provider: 'APPLE', issuer: 'https://linking.apple.test', subject: 'race-apple' },
    ] });
    const auth = new SocialAuthService(prisma!, {
      transactionSecret: 'integration-social-transaction-secret-123456789',
      transactionTtlMinutes: 10,
      sessionTtlHours: 12,
      providers: { GOOGLE: fakeProvider, APPLE: fakeAppleProvider },
      onboarding,
    });
    try {
      const outcomes = await Promise.allSettled([
        auth.unlink({ provider: 'GOOGLE', sid: current.sid, csrfToken: current.csrf, consent: true }),
        auth.unlink({ provider: 'APPLE', sid: current.sid, csrfToken: current.csrf, consent: true }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => (outcome as PromiseRejectedResult).reason.code))
        .toEqual(['LAST_SIGN_IN_METHOD']);
      expect(await prisma!.externalIdentity.count({ where: { userId: current.user.id } })).toBe(1);
    } finally {
      await prisma!.externalIdentity.deleteMany({ where: { userId: current.user.id, issuer: { in: ['https://linking.google.test', 'https://linking.apple.test'] } } });
      await prisma!.user.update({ where: { id: current.user.id }, data: { passwordHash: originalHash } });
    }
  });

  it('uses issuer+subject, rotates the session once, and rejects replay and browser swapping', async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    await prisma!.externalIdentity.create({ data: { userId: user.id, provider: 'GOOGLE', issuer: profile.identity.issuer, subject: profile.identity.subject } });
    const initial = await preAuth(); const auth = service();
    const started = await auth.start({ provider: 'GOOGLE', purpose: 'SIGN_IN', sid: initial.sid, csrfToken: initial.csrf, consent: false });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await expect(auth.callback({ provider: 'GOOGLE', state, browserBinding: 'swapped-browser', callback: new URL(`https://callback.test/?code=x&state=${state}`) })).rejects.toBeInstanceOf(SocialAuthError);
    const attempts = await Promise.allSettled([
      auth.callback({ provider: 'GOOGLE', state, browserBinding: started.browserBinding, callback: new URL(`https://callback.test/?code=x&state=${state}`) }),
      auth.callback({ provider: 'GOOGLE', state, browserBinding: started.browserBinding, callback: new URL(`https://callback.test/?code=x&state=${state}`) }),
    ]);
    expect(attempts.map((entry) => entry.status === 'fulfilled' ? entry.value.kind : `${entry.reason?.name}:${entry.reason?.message}`).sort())
      .toEqual(['signed_in', 'SocialAuthError:TRANSACTION_INVALID'].sort());
    expect(attempts.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma!.session.count({ where: { userId: user.id, state: 'AUTHENTICATED' } })).toBe(1);
  });

  it('never links by matching email and requires onboarding for a verified new contact', async () => {
    const initial = await preAuth(); const auth = service();
    const started = await auth.start({ provider: 'GOOGLE', purpose: 'SIGN_IN', sid: initial.sid, csrfToken: initial.csrf, consent: false });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const result = await auth.callback({ provider: 'GOOGLE', state, browserBinding: started.browserBinding, callback: new URL(`https://callback.test/?code=x&state=${state}`) });
    expect(result.kind).toBe('onboarding_required');
    expect(await prisma!.externalIdentity.count({ where: { subject: profile.identity.subject } })).toBe(0);
  });

  it('requires separate account proof when verified provider email belongs to an existing account', async () => {
    const existing = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    const existingEmailProfile = {
      ...profile,
      identity: { ...profile.identity, subject: `existing-email-${Date.now()}` },
      email: { ...profile.email, value: existing.emailNormalized },
    };
    const provider: SocialOidcProvider = {
      authorizationUrl: ({ state }) => `https://issuer.example.test/auth?state=${encodeURIComponent(state)}`,
      exchange: async () => existingEmailProfile,
    };
    const auth = new SocialAuthService(prisma!, {
      transactionSecret: 'integration-social-transaction-secret-123456789',
      transactionTtlMinutes: 10,
      sessionTtlHours: 12,
      providers: { GOOGLE: provider },
      onboarding,
    });
    const initial = await preAuth();
    const started = await auth.start({ provider: 'GOOGLE', purpose: 'SIGN_IN', sid: initial.sid, csrfToken: initial.csrf, consent: false });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const result = await auth.callback({ provider: 'GOOGLE', state, browserBinding: started.browserBinding, callback: new URL(`https://callback.test/?code=x&state=${state}`) });

    expect(result.kind).toBe('account_proof_required');
    expect(await prisma!.externalIdentity.count({ where: { subject: existingEmailProfile.identity.subject } })).toBe(0);
    expect(await prisma!.socialOnboardingContinuation.count({ where: { initiatingSession: { tokenHash: hashToken(initial.sid) } } })).toBe(0);
  });

  it('links an issuer+subject only after recent authenticated consent and rotates the session', async () => {
    const current = await authenticated();
    const { user, session: initiatingSession, sid, csrf } = current;
    const auth = service();
    const started = await auth.start({ provider: 'GOOGLE', purpose: 'LINK', sid, csrfToken: csrf, consent: true, returnPath: '/?account=security' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const result = await auth.callback({ provider: 'GOOGLE', state, browserBinding: started.browserBinding, callback: new URL(`https://callback.test/?code=x&state=${state}`) });

    expect(result.kind).toBe('linked');
    expect(await prisma!.externalIdentity.findUniqueOrThrow({
      where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } },
      select: { userId: true },
    })).toEqual({ userId: user.id });
    expect((await prisma!.session.findUniqueOrThrow({ where: { id: initiatingSession.id } })).revokedAt).not.toBeNull();
    const rotated = await prisma!.session.findFirstOrThrow({ where: { userId: user.id, state: 'AUTHENTICATED', revokedAt: null } });
    expect(rotated.selectedCompanyId).toBe(initiatingSession.selectedCompanyId);
    expect(Buffer.from(rotated.csrfHash)).toEqual(Buffer.from(hashToken(csrf)));
    expect(await prisma!.session.count({ where: { userId: user.id, state: 'AUTHENTICATED', revokedAt: null } })).toBe(1);
  });

  it('returns a completed LINK callback to account security without exposing claims', async () => {
    const current = await authenticated();
    const auth = service();
    const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL }, { socialAuth: auth });
    const started = await request(app)
      .post('/api/v1/auth/social/google/start')
      .set('Cookie', `sid=${current.sid}`)
      .set('X-CSRF-Token', current.csrf)
      .send({ purpose: 'LINK', consent: true, returnPath: '/?account=security' })
      .expect(200);
    const correlation = (started.headers['set-cookie'] as unknown as string[])[0]!;
    const state = new URL(started.body.authorizationUrl).searchParams.get('state')!;

    const completed = await request(app)
      .get(`/api/v1/auth/social/google/callback?code=code&state=${encodeURIComponent(state)}`)
      .set('Cookie', correlation.split(';')[0]!)
      .expect(303);

    expect(completed.headers.location).toBe('/?account=security&social=linked');
    expect(JSON.stringify(completed.headers)).not.toMatch(/social-integration-subject|changed-contact@example\.test/iu);
  });

  it('returns a cancelled LINK callback to account security and consumes its transaction', async () => {
    const current = await authenticated();
    const auth = service();
    const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL }, { socialAuth: auth });
    const started = await request(app)
      .post('/api/v1/auth/social/google/start')
      .set('Cookie', `sid=${current.sid}`)
      .set('X-CSRF-Token', current.csrf)
      .send({ purpose: 'LINK', consent: true, returnPath: '/?account=security' })
      .expect(200);
    const correlation = (started.headers['set-cookie'] as unknown as string[])[0]!;
    const browserBinding = decodeURIComponent(correlation.split(';')[0]!.split('=', 2)[1]!);
    const state = new URL(started.body.authorizationUrl).searchParams.get('state')!;

    const cancelled = await request(app)
      .get(`/api/v1/auth/social/google/callback?error=access_denied&state=${encodeURIComponent(state)}`)
      .set('Cookie', correlation.split(';')[0]!)
      .expect(303);

    expect(cancelled.headers.location).toBe('/?account=security&social=cancelled');
    expect((await prisma!.socialAuthorizationTransaction.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).usedAt).not.toBeNull();
    await expect(auth.callback({
      provider: 'GOOGLE',
      state,
      browserBinding,
      callback: new URL(`https://callback.test/?code=replay&state=${encodeURIComponent(state)}`),
    })).rejects.toMatchObject({ code: 'TRANSACTION_INVALID' });
  });

  it('accepts Apple form_post with its narrow cross-site correlation cookie', async () => {
    const appleProvider: SocialOidcProvider = {
      authorizationUrl: ({ state }) => `https://appleid.apple.com/auth/authorize?state=${encodeURIComponent(state)}`,
      exchange: async () => ({ identity: { provider: 'APPLE', issuer: 'https://appleid.apple.com', subject: 'apple-form-post-subject' }, email: { value: 'relay@privaterelay.appleid.com', verified: true, privateRelay: true }, displayName: 'Apple User' }),
    };
    const auth = new SocialAuthService(prisma!, { transactionSecret: 'integration-social-transaction-secret-123456789', transactionTtlMinutes: 10, sessionTtlHours: 12, providers: { APPLE: appleProvider }, onboarding });
    const initial = await preAuth();
    const app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: process.env.DATABASE_URL }, { socialAuth: auth });
    expect((await request(app).get('/api/v1/auth/social/providers').expect(200)).body).toEqual({ google: false, apple: true });
    const started = await request(app).post('/api/v1/auth/social/apple/start').set('Cookie', `sid=${initial.sid}`).set('X-CSRF-Token', initial.csrf).send({ purpose: 'SIGN_IN', consent: false, returnPath: '/' }).expect(200);
    const correlation = (started.headers['set-cookie'] as unknown as string[])[0]!;
    expect(correlation).toContain('Path=/api/v1/auth/social/apple/callback');
    expect(correlation).toContain('SameSite=None'); expect(correlation).toContain('Secure'); expect(correlation).toContain('HttpOnly');
    const state = new URL(started.body.authorizationUrl).searchParams.get('state')!;
    const completed = await request(app).post('/api/v1/auth/social/apple/callback').set('Cookie', correlation.split(';')[0]!).type('form').send({ code: 'apple-code', state, user: JSON.stringify({ name: { firstName: 'Apple' } }) }).expect(303);
    expect(completed.headers.location).toBe('/?social=onboarding_required');
    const completionCookies = completed.headers['set-cookie'] as unknown as string[];
    expect(completionCookies).toHaveLength(3);
    expect(completionCookies[1]).toContain('social_onboarding=');
    expect(completionCookies[1]).toContain('HttpOnly');
    expect(completionCookies[1]).toContain('SameSite=Lax');
    expect(completionCookies[2]).toContain('social_onboarding_binding=');
    expect(JSON.stringify(completed.headers)).not.toContain('apple-form-post-subject');
    expect(JSON.stringify(completed.headers)).not.toContain('relay@privaterelay.appleid.com');
  });
});
