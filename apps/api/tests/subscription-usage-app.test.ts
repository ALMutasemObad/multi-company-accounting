import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthError, type AuthService } from '../src/auth/auth-service.js';
import type { AppConfig } from '../src/config.js';
import { parseOpenApiResponseBody } from '../src/generated/openapi-request-guards.js';
import { OperationalMetrics } from '../src/operations/metrics.js';
import { RequestDeadlineExceededError } from '../src/operations/request-context.js';
import { TransactionRetryExhaustedError } from '../src/platform/transaction-executor.js';
import { SubscriptionUsageService } from '../src/platform-subscriptions/subscription-usage-service.js';

const path = '/api/v1/subscription/usage';
const config: AppConfig = {
  NODE_ENV: 'test', PORT: 3133, WEB_ORIGIN: 'http://localhost:4183',
  SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
};

function fixture(overrides: Partial<AppConfig> = {}) {
  const authorize = vi.fn().mockResolvedValue({ companyId: 123n, userId: 7n, sessionId: 1n });
  const measure = vi.fn().mockResolvedValue({ users: 2, employees: 0, postedDocuments: 40 });
  const currentPlan = vi.fn().mockResolvedValue(null);
  const subscriptionUsage = new SubscriptionUsageService(
    { measure }, { currentPlan }, () => new Date('2026-08-31T09:00:00.000Z'),
  );
  const app = createApp({ ...config, ...overrides }, {
    auth: { authorize } as unknown as AuthService,
    subscriptionUsage, metrics: new OperationalMetrics(),
  });
  return { app, authorize, measure, currentPlan };
}

function assertResponse(response: request.Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
  expect(response.headers.expires).toBe('0');
  expect(response.headers['x-request-id']).toBeTruthy();
  expect(parseOpenApiResponseBody('getCompanySubscriptionUsage', status, response.body)).toEqual(response.body);
}

describe('subscription usage through the real application middleware', () => {
  it('mounts the service and applies the real response validator, context and no-store middleware', async () => {
    const { app, authorize, measure, currentPlan } = fixture();
    const response = await request(app).get(path).set('Cookie', 'sid=usage-session');
    assertResponse(response, 200);
    expect(response.body.companyId).toBe('123');
    expect(authorize).toHaveBeenCalledWith({ sid: 'usage-session', permission: 'subscriptions.view', requireCsrf: false });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(currentPlan).toHaveBeenCalledTimes(1);
  });

  it.each([['UNAUTHENTICATED', 401], ['FORBIDDEN', 403]] as const)('rejects %s before either data port', async (reason, status) => {
    const { app, authorize, measure, currentPlan } = fixture();
    authorize.mockRejectedValue(new AuthError(reason));
    assertResponse(await request(app).get(path), status);
    expect(measure).not.toHaveBeenCalled();
    expect(currentPlan).not.toHaveBeenCalled();
  });

  it('rejects client company and period overrides after authorization but before data access', async () => {
    const { app, authorize, measure, currentPlan } = fixture();
    assertResponse(await request(app).get(`${path}?companyId=999&startsAt=2020-01-01`), 400);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(measure).not.toHaveBeenCalled();
    expect(currentPlan).not.toHaveBeenCalled();
  });

  it('maps a missing company to the documented 404 rather than fabricated zero usage', async () => {
    const { app, measure } = fixture();
    measure.mockResolvedValue(null);
    assertResponse(await request(app).get(path), 404);
  });

  it('sanitizes reader failures using the actual global 500 handler', async () => {
    const { app, measure } = fixture();
    measure.mockRejectedValue(new Error('private-database-host and private-query'));
    const response = await request(app).get(path);
    assertResponse(response, 500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/private-|metrics|users|postedDocuments/);
  });

  it.each([
    [new TransactionRetryExhaustedError('usage-read', 'DEADLOCK', { cause: new Error('private-database-host') }), 503],
    [new RequestDeadlineExceededError('usage-read'), 504],
  ] as const)('preserves the shared temporary-error contract %#', async (failure, status) => {
    const { app, measure } = fixture();
    measure.mockRejectedValue(failure);
    const response = await request(app).get(path);
    assertResponse(response, status);
    expect(JSON.stringify(response.body)).not.toContain('private-database-host');
  });

  it('uses the real session limiter before authorization or usage queries, with retry metadata', async () => {
    const { app, authorize, measure, currentPlan } = fixture({ RATE_LIMIT_MAX: 1, RATE_LIMIT_NETWORK_MULTIPLIER: 3 });
    assertResponse(await request(app).get(path).set('Cookie', 'sid=session-a'), 200);
    const limited = await request(app).get(path).set('Cookie', 'sid=session-a');
    assertResponse(limited, 429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(currentPlan).toHaveBeenCalledTimes(1);
    // A different session has its own allowance, subject to the same network ceiling.
    assertResponse(await request(app).get(path).set('Cookie', 'sid=session-b'), 200);
  });
});
