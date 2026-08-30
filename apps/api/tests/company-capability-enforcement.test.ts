import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import type { AuthStore } from '../src/auth/auth-store.js';
import type { CustomerService } from '../src/sales/customer-service.js';
import type { CompanyCapabilityPort } from '../src/platform-subscriptions/company-capability-service.js';

describe('company capability API enforcement', () => {
  it('blocks a direct business API request even when RBAC allows it', async () => {
    const listCustomers = vi.fn();
    const store = {
      findSession: vi.fn(async () => ({
        id: 9n,
        state: 'AUTHENTICATED',
        userId: 1n,
        selectedCompanyId: 42n,
        csrfHash: new Uint8Array(),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        revokedAt: null,
      })),
      hasPermission: vi.fn(async () => true),
    } as unknown as AuthStore;
    const companyCapabilities: CompanyCapabilityPort = {
      async resolve() { return { moduleCodes: [], permissions: [] }; },
      async allows() { return false; },
    };
    const auth = new AuthService(store, { verify: async () => false }, {
      preAuthTtlMinutes: 10,
      sessionTtlHours: 12,
      companyCapabilities,
    });
    const app = createApp({
      NODE_ENV: 'test',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
    }, {
      auth,
      customers: { listCustomers } as unknown as CustomerService,
    });

    const response = await request(app)
      .get('/api/v1/customers')
      .set('Cookie', 'sid=opaque-session')
      .expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(store.hasPermission).toHaveBeenCalledWith({
      userId: 1n,
      companyId: 42n,
      code: 'customers.view',
    });
    expect(listCustomers).not.toHaveBeenCalled();
  });
});
