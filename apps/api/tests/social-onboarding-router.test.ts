import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const body = {
  displayName: 'Owner',
  organizationName: 'Group',
  companyName: 'Company',
  timezone: 'Asia/Riyadh',
  baseCurrencyCode: 'SAR',
  locale: 'en',
  chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
  consent: true,
};

function appFor(service: unknown) {
  return createApp({
    NODE_ENV: 'test',
    PORT: 3000,
    WEB_ORIGIN: 'http://localhost:5173',
    SESSION_COOKIE_SECURE: false,
    PRE_AUTH_TTL_MINUTES: 10,
    SESSION_TTL_HOURS: 12,
  }, { socialAuth: service as never });
}

describe('social onboarding HTTP boundary', () => {
  it('consumes a correlated authorization after a failed callback before returning an error', async () => {
    const callback = vi.fn(async () => { throw new Error('provider exchange failed'); });
    const cancelAuthorization = vi.fn(async () => '/?account=security');
    const callbackReturnPath = vi.fn(async () => '/should-not-be-used');
    const response = await request(appFor({ callback, cancelAuthorization, callbackReturnPath }))
      .get('/api/v1/auth/social/google/callback?code=provider-code&state=opaque-state')
      .set('Cookie', 'social_google_binding=opaque-browser')
      .expect(303);

    expect(cancelAuthorization).toHaveBeenCalledWith({
      provider: 'GOOGLE',
      state: 'opaque-state',
      browserBinding: 'opaque-browser',
    });
    expect(callbackReturnPath).not.toHaveBeenCalled();
    expect(response.headers.location).toBe('/?account=security&social=error');
    expect((response.headers['set-cookie'] as unknown as string[])[0]).toContain('social_google_binding=;');
  });

  it('takes opaque credentials only from HttpOnly cookies and rotates the session', async () => {
    const completeOnboarding = vi.fn(async () => ({
      kind: 'completed' as const,
      sid: 'rotated-session-token-with-enough-entropy',
      csrfToken: 'rotated-csrf-token-with-enough-entropy',
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
      user: { id: '7', displayName: 'Owner' },
      companyId: '9',
    }));
    const response = await request(appFor({ completeOnboarding }))
      .post('/api/v1/auth/social/onboarding')
      .set('Cookie', 'sid=preauth; social_onboarding=opaque-continuation; social_onboarding_binding=opaque-browser')
      .set('X-CSRF-Token', 'csrf-value')
      .send(body)
      .expect(201);

    expect(completeOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      sid: 'preauth',
      csrfToken: 'csrf-value',
      continuation: 'opaque-continuation',
      browserBinding: 'opaque-browser',
      form: body,
    }));
    expect(response.body).toEqual({
      status: 'COMPLETED',
      user: { id: '7', displayName: 'Owner' },
      companyId: '9',
      csrfToken: 'rotated-csrf-token-with-enough-entropy',
    });
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toContain('sid=rotated-session-token-with-enough-entropy');
    expect(cookies.every((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((cookie) => cookie.includes('social_onboarding=;'))).toBe(true);
    expect(cookies.some((cookie) => cookie.includes('social_onboarding_binding=;'))).toBe(true);
  });

  it('rejects provider claims and tokens in the JSON body before invoking the service', async () => {
    const completeOnboarding = vi.fn();
    await request(appFor({ completeOnboarding }))
      .post('/api/v1/auth/social/onboarding')
      .set('Cookie', 'sid=preauth; social_onboarding=opaque-continuation; social_onboarding_binding=opaque-browser')
      .set('X-CSRF-Token', 'csrf-value')
      .send({ ...body, issuer: 'https://attacker.example', subject: 'injected', accessToken: 'secret' })
      .expect(400);
    expect(completeOnboarding).not.toHaveBeenCalled();
  });
});
