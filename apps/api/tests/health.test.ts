import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: false,
  PRE_AUTH_TTL_MINUTES: 10,
  SESSION_TTL_HOURS: 12,
});

describe('GET /health', () => {
  it('returns the service status without secrets', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'mcap-finance-api' });
    expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
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
  });
});
