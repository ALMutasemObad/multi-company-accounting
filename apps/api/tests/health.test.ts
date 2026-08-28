import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/auth/auth-service.js';
import { OperationalMetrics } from '../src/operations/metrics.js';
import type { RateLimitStore } from '../src/operations/rate-limit.js';

const app = createApp({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: false,
  PRE_AUTH_TTL_MINUTES: 10,
  SESSION_TTL_HOURS: 12,
});

describe('GET /health', () => {
  it('refuses an instance-local security limiter in production', () => {
    expect(() => createApp({
      NODE_ENV: 'production', PORT: 3000, WEB_ORIGIN: 'https://finance.example.com', SESSION_COOKIE_SECURE: true,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    })).toThrow(/shared security-sensitive rate-limit store/);
  });

  it('returns the service status without secrets', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'mcap-finance-api' });
    expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
    expect(response.headers['permissions-policy']).toBe('camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('reports database readiness and returns 503 without leaking the failure', async () => {
    const ready = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    }, { readiness: { check: async () => ({ database: 'ok', latencyMs: 1.25 }) } });
    expect((await request(ready).get('/ready').expect(200)).body).toEqual({
      status: 'ok', service: 'mcap-finance-api', checks: { database: 'ok', latencyMs: 1.25 },
    });

    const unavailable = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    }, { readiness: { check: async () => { throw new Error('secret database hostname'); } } });
    const response = await request(unavailable).get('/health').expect(503);
    expect(response.body).toEqual({ status: 'error', service: 'mcap-finance-api', checks: { database: 'error' } });
    expect(JSON.stringify(response.body)).not.toContain('hostname');
  });

  it('limits repeated API requests and returns standard retry metadata', async () => {
    const limited = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60_000,
    });
    await request(limited).get('/api/v1/missing').expect(404);
    await request(limited).get('/api/v1/missing').expect(404);
    const response = await request(limited).get('/api/v1/missing').expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.expires).toBe('0');
  });

  it('isolates the general API allowance by session while retaining an anti-evasion network ceiling', async () => {
    const limited = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_NETWORK_MULTIPLIER: 3,
    });
    await request(limited).get('/api/v1/missing').set('Cookie', 'sid=session-a').expect(404);
    await request(limited).get('/api/v1/missing').set('Cookie', 'sid=session-a').expect(429);
    await request(limited).get('/api/v1/missing').set('Cookie', 'sid=session-b').expect(404);
    await request(limited).get('/api/v1/missing').set('Cookie', 'sid=session-c').expect(429);
  });

  it('limits sensitive attempts per credential while retaining a wider shared-network ceiling', async () => {
    const limited = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, AUTH_RATE_LIMIT_MAX: 1,
      RATE_LIMIT_NETWORK_MULTIPLIER: 10,
    }, { auth: {} as AuthService });
    const invalidPassword = (email: string) => request(limited)
      .post('/api/v1/auth/login')
      .send({ email, password: '' });

    await invalidPassword('User@Example.com').expect(400);
    await invalidPassword(' user@example.com ').expect(429);
    await invalidPassword('other@example.com').expect(400);
  });

  it('shares security-sensitive limits across application instances and fails closed when the store is unavailable', async () => {
    let count = 0;
    const sharedStore: RateLimitStore = {
      increment: ({ now, windowMs }) => ({ count: ++count, resetAt: now + windowMs }),
    };
    const config = {
      NODE_ENV: 'test' as const, PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, AUTH_RATE_LIMIT_MAX: 1,
      RATE_LIMIT_NETWORK_MULTIPLIER: 1,
    };
    const auth = {
      issueCsrf: async () => ({
        sid: 'session-token-with-sufficient-entropy',
        csrfToken: 'csrf-token-with-sufficient-entropy',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
    } as AuthService;
    await request(createApp(config, { auth, sensitiveRateLimits: sharedStore })).get('/api/v1/auth/csrf').expect(200);
    const limited = await request(createApp(config, { auth, sensitiveRateLimits: sharedStore })).get('/api/v1/auth/csrf').expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');

    const metrics = new OperationalMetrics();
    const unavailableStore: RateLimitStore = { increment: async () => { throw new Error('database address must stay private'); } };
    const unavailable = await request(createApp(config, { auth, metrics, sensitiveRateLimits: unavailableStore }))
      .get('/api/v1/auth/csrf')
      .expect(503);
    expect(unavailable.body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(JSON.stringify(unavailable.body)).not.toContain('database address');
    expect(metrics.renderPrometheus()).toContain('mcap_rate_limit_store_failure_total{scope="CSRF_NETWORK"} 1');
  });

  it('prevents caching of authentication bootstrap and API error responses', async () => {
    const protectedApp = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
    }, {
      auth: {
        issueCsrf: async () => ({
          sid: 'session-token-with-sufficient-entropy',
          csrfToken: 'csrf-token-with-sufficient-entropy',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        }),
      } as AuthService,
    });

    for (const response of [
      await request(protectedApp).get('/api/v1/auth/csrf').expect(200),
      await request(protectedApp).get('/api/v1/missing').expect(404),
    ]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.headers.expires).toBe('0');
      expect(response.headers['permissions-policy']).toBe('camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    }
  });

  it('exposes only safe Prometheus metrics and protects configured bearer access', async () => {
    const metrics = new OperationalMetrics();
    metrics.recordTransactionAttempt('POST_TEST');
    const monitored = createApp({
      NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, METRICS_ENABLED: true,
      METRICS_BEARER_TOKEN: 'test-metrics-bearer-token-1234567890',
    }, { metrics });

    await request(monitored).get('/metrics').expect(401);
    const response = await request(monitored)
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-bearer-token-1234567890')
      .expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('mcap_db_transaction_attempt_total{operation="POST_TEST"} 1');
    expect(response.text).not.toContain('test-metrics-bearer-token');
  });
});

describe('request validation boundary', () => {
  const guarded = createApp({
    NODE_ENV: 'test',
    PORT: 3000,
    WEB_ORIGIN: 'http://localhost:5173',
    SESSION_COOKIE_SECURE: false,
    PRE_AUTH_TTL_MINUTES: 10,
    SESSION_TTL_HOURS: 12,
  }, { auth: {} as AuthService });

  it('returns a contract-shaped 400 for invalid public authentication input', async () => {
    const response = await request(guarded)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(response.body).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      messageAr: expect.any(String),
      requestId: response.headers['x-request-id'],
      details: { reason: 'SCHEMA_VALIDATION_FAILED' },
    });
    expect(response.body.fieldErrors).toMatchObject({ email: expect.any(Array), password: expect.any(Array) });
  });

  it('applies the generated company-context guard before calling authentication services', async () => {
    const response = await request(guarded)
      .put('/api/v1/auth/context')
      .send({ companyId: '0' })
      .expect(400);

    expect(response.body).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      requestId: response.headers['x-request-id'],
      fieldErrors: { companyId: expect.any(Array) },
      details: { reason: 'SCHEMA_VALIDATION_FAILED' },
    });
  });

  it('rejects malformed JSON as a client error without exposing parser details', async () => {
    const response = await request(guarded)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);

    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Invalid JSON',
      status: 400,
      code: 'VALIDATION_ERROR',
      messageAr: 'يجب أن يكون جسم الطلب JSON صالحًا.',
      requestId: response.headers['x-request-id'],
      details: { reason: 'INVALID_JSON' },
    });
    expect(JSON.stringify(response.body)).not.toContain('SyntaxError');
  });

  it('rejects request bodies larger than the configured limit', async () => {
    const response = await request(guarded)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'x'.repeat(1024 * 1024) })
      .expect(413);

    expect(response.body).toMatchObject({
      status: 413,
      code: 'VALIDATION_ERROR',
      requestId: response.headers['x-request-id'],
      details: { reason: 'PAYLOAD_TOO_LARGE' },
    });
  });
});
