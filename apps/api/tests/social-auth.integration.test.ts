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

describe.runIf(enabled)('social authentication persistence and races', () => {
  beforeEach(async () => {
    await prisma!.socialAuthorizationTransaction.deleteMany();
    await prisma!.externalIdentity.deleteMany({ where: { subject: profile.identity.subject } });
    await prisma!.session.deleteMany();
  });
  afterAll(async () => { await prisma!.$disconnect(); });

  const service = () => new SocialAuthService(prisma!, { transactionSecret: 'integration-social-transaction-secret-123456789', transactionTtlMinutes: 10, sessionTtlHours: 12, providers: { GOOGLE: fakeProvider } });
  async function preAuth() {
    const sid = createOpaqueToken(); const csrf = createOpaqueToken();
    await prisma!.session.create({ data: { tokenHash: hashToken(sid), csrfHash: hashToken(csrf), state: 'PRE_AUTH', expiresAt: new Date(Date.now() + 600_000) } });
    return { sid, csrf };
  }

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
    expect(attempts.map((entry) => entry.status === 'fulfilled' ? entry.value.kind : `${entry.reason?.name}:${entry.reason?.message}`)).toEqual(['signed_in', 'SocialAuthError:TRANSACTION_INVALID']);
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

  it('accepts Apple form_post with its narrow cross-site correlation cookie', async () => {
    const appleProvider: SocialOidcProvider = {
      authorizationUrl: ({ state }) => `https://appleid.apple.com/auth/authorize?state=${encodeURIComponent(state)}`,
      exchange: async () => ({ identity: { provider: 'APPLE', issuer: 'https://appleid.apple.com', subject: 'apple-form-post-subject' }, email: { value: 'relay@privaterelay.appleid.com', verified: true, privateRelay: true }, displayName: 'Apple User' }),
    };
    const auth = new SocialAuthService(prisma!, { transactionSecret: 'integration-social-transaction-secret-123456789', transactionTtlMinutes: 10, sessionTtlHours: 12, providers: { APPLE: appleProvider } });
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
  });
});
