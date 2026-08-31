import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthError, type AuthService } from '../src/auth/auth-service.js';
import type { SellingProfileService } from '../src/sales/selling-profile-service.js';
import { PosError, type PosService } from '../src/pos/pos-service.js';

const item = { inventoryItemId: '9', code: 'ITM-9', nameAr: 'حليب اختبار', nameEn: 'Test milk', description: null,
  isActive: true, unitOfMeasure: { id: '4', code: 'EA', nameAr: 'حبة', nameEn: 'Each', decimalPlaces: 0, isActive: true },
  sellingProfile: { id: '7', unitPrice: '12.3400', currencyId: '2', currencyCode: 'YER', revenueAccountId: '3', taxRateId: null, isActive: true, version: 1 },
  isReady: true, readinessReason: null };

function fixture() {
  const authorize = vi.fn().mockResolvedValue({ userId: 1n, companyId: 2n, sessionId: 3n });
  const sellingProfiles = { list: vi.fn().mockResolvedValue({ data: [item], meta: { page: 1, pageSize: 24, total: 1, totalPages: 1 } }),
    get: vi.fn().mockResolvedValue({ data: item }), create: vi.fn().mockResolvedValue({ data: item }), update: vi.fn().mockResolvedValue({ data: item }) };
  const pos = { checkout: vi.fn() };
  const app = createApp({ NODE_ENV: 'test', PORT: 3143, WEB_ORIGIN: 'http://127.0.0.1:4193',
    SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 }, {
    auth: { authorize } as unknown as AuthService, sellingProfiles: sellingProfiles as unknown as SellingProfileService, pos: pos as unknown as PosService,
  });
  return { app, authorize, sellingProfiles, pos };
}

describe('grocery catalogue mounted in the real application', () => {
  it('uses the generated response validator and private cache policy for the real route', async () => {
    const { app, authorize, sellingProfiles } = fixture();
    const result = await request(app).get('/api/v1/sales/catalog').set('Cookie', 'sid=synthetic-grocery-session').expect(200);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.body.data[0].sellingProfile.unitPrice).toBe('12.3400');
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ permission: 'sales_catalog.view', requireCsrf: false }));
    expect(sellingProfiles.list).toHaveBeenCalledWith({ userId: 1n, companyId: 2n, sessionId: 3n }, expect.objectContaining({ page: 1, pageSize: 24 }));
  });

  it('passes explicit manage/CSRF/version/idempotency through the mounted writer', async () => {
    const { app, authorize, sellingProfiles } = fixture();
    await request(app).post('/api/v1/sales/catalog/items/9/selling-profile')
      .set('X-CSRF-Token', 'synthetic-csrf').set('Idempotency-Key', 'grocery-test-key')
      .send({ unitPrice: '12.3400', currencyId: '2', revenueAccountId: '3', taxRateId: null }).expect(201);
    expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({ permission: 'sales_catalog.manage', requireCsrf: true, csrfToken: 'synthetic-csrf' }));
    expect(sellingProfiles.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 2n }), 9n,
      { unitPrice: '12.3400', currencyId: 2n, revenueAccountId: 3n, taxRateId: null }, 'grocery-test-key');
  });

  it('rejects invalid output through the central 500 handler', async () => {
    const { app, sellingProfiles } = fixture();
    sellingProfiles.get.mockResolvedValue({ data: { ...item, sellingProfile: { ...item.sellingProfile, unitPrice: 12.34 } } });
    const result = await request(app).get('/api/v1/sales/catalog/items/9').expect(500);
    expect(JSON.stringify(result.body)).not.toContain('12.34');
  });

  it('never calls the catalogue when authorization fails', async () => {
    const { app, authorize, sellingProfiles } = fixture();
    authorize.mockRejectedValue(new AuthError('FORBIDDEN'));
    await request(app).get('/api/v1/sales/catalog').expect(403);
    expect(sellingProfiles.list).not.toHaveBeenCalled();
  });

  it.each(['IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_MISMATCH'] as const)('preserves the POS reason envelope for %s', async reason => {
    const { app, authorize, pos } = fixture();
    pos.checkout.mockRejectedValue(new PosError(reason));
    const response = await request(app).post('/api/v1/pos/checkouts')
      .set('X-CSRF-Token', 'synthetic-csrf').set('Idempotency-Key', 'grocery-checkout-key')
      .send({ fiscalPeriodId: '1', documentDate: '2026-08-31', description: 'Fixture grocery sale', customerId: '1', warehouseId: '1', currencyId: '2',
        exchangeRate: '1.00000000', cashBankAccountId: '1', paymentMethodId: '1', referenceNumber: null, notes: null,
        lines: [{ inventoryItemId: '9', description: 'Milk', quantity: '2.000000', unitPrice: '123.4500', discountAmount: '0.0000', revenueAccountId: '3', costCenterId: null, taxRateId: null }] }).expect(409);
    expect(response.body).toEqual({ status: 409, code: 'BUSINESS_RULE_VIOLATION', reason });
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ permission: 'pos.checkout', requireCsrf: true }));
  });
});
