import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/auth/auth-service.js';
import { RegistrationError, type RegistrationService } from '../src/registration/registration-service.js';

const config = {
  NODE_ENV: 'test' as const,
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: false,
  PRE_AUTH_TTL_MINUTES: 10,
  SESSION_TTL_HOURS: 12,
  RATE_LIMIT_MAX: 100,
  AUTH_RATE_LIMIT_MAX: 20,
  REGISTRATION_RATE_LIMIT_MAX: 10,
  LOG_REQUESTS: false,
};

const validRegistration = {
  email: 'owner@example.com',
  password: 'a secure password',
  displayName: 'Owner',
  organizationName: 'Owner Group',
  companyName: 'Owner Company',
  timezone: 'Asia/Aden',
  baseCurrencyCode: 'YER',
  locale: 'ar',
  chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
};

function fixture(overrides: Partial<RegistrationService> = {}) {
  const validatePreAuth = vi.fn().mockResolvedValue(undefined);
  const auth = { validatePreAuth } as unknown as AuthService;
  const registration = {
    options: vi.fn().mockResolvedValue({ currencies: [], locales: ['ar', 'en', 'ur', 'hi'], timezones: ['Asia/Aden'], chartTemplates: [], passwordPolicy: { minLength: 12, maxLength: 1024 } }),
    start: vi.fn().mockResolvedValue({ status: 'PENDING_VERIFICATION' }),
    resend: vi.fn().mockResolvedValue({ status: 'PENDING_VERIFICATION' }),
    verify: vi.fn().mockResolvedValue({ status: 'COMPLETED', companyId: '11', userId: '7' }),
    ...overrides,
  } as unknown as RegistrationService;
  return { app: createApp(config, { auth, registration }), registration, validatePreAuth };
}

describe('self-registration HTTP boundary', () => {
  it('publishes options and protects every state-changing operation with PRE_AUTH CSRF', async () => {
    const { app, registration, validatePreAuth } = fixture();
    await request(app).get('/api/v1/auth/register/options').expect(200);
    await request(app).post('/api/v1/auth/register').set('Cookie', 'sid=pre-auth').set('X-CSRF-Token', 'csrf').send(validRegistration).expect(202, { status: 'PENDING_VERIFICATION' });
    await request(app).post('/api/v1/auth/register/resend').set('Cookie', 'sid=pre-auth').set('X-CSRF-Token', 'csrf').send({ email: validRegistration.email }).expect(202, { status: 'PENDING_VERIFICATION' });
    await request(app).post('/api/v1/auth/register/verify').set('Cookie', 'sid=pre-auth').set('X-CSRF-Token', 'csrf').send({ token: 'x'.repeat(43) }).expect(201, { status: 'COMPLETED', companyId: '11', userId: '7' });

    expect(validatePreAuth).toHaveBeenCalledTimes(3);
    expect(registration.start).toHaveBeenCalledWith(validRegistration, expect.objectContaining({ ipAddress: expect.any(String) }));
  });

  it('maps invalid verification tokens to a stable public error', async () => {
    const { app } = fixture({ verify: vi.fn().mockRejectedValue(new RegistrationError('INVALID_OR_EXPIRED_TOKEN')) } as never);
    const response = await request(app).post('/api/v1/auth/register/verify').set('Cookie', 'sid=pre-auth').set('X-CSRF-Token', 'csrf').send({ token: 'x'.repeat(43) }).expect(400);
    expect(response.body).toMatchObject({ code: 'REGISTRATION_TOKEN_INVALID', status: 400 });
  });

  it('uses a dedicated stricter IP rate limit for registration', async () => {
    const { app } = fixture();
    const limitedApp = createApp({ ...config, REGISTRATION_RATE_LIMIT_MAX: 1 }, {
      auth: { validatePreAuth: vi.fn().mockResolvedValue(undefined) } as unknown as AuthService,
      registration: (fixture().registration),
    });
    await request(limitedApp).get('/api/v1/auth/register/options').expect(200);
    await request(limitedApp).get('/api/v1/auth/register/options').expect(200);
    await request(limitedApp).post('/api/v1/auth/register').send(validRegistration).expect(202);
    const response = await request(limitedApp).post('/api/v1/auth/register').send(validRegistration).expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    void app;
  });
});
