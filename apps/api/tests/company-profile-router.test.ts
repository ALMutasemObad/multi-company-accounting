import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../src/auth/auth-service.js';
import { createCompanyRouter } from '../src/companies/company-router.js';
import { CompanyProfileError, type CompanyProfileService } from '../src/companies/company-profile-service.js';
import type { CompanyService } from '../src/companies/company-service.js';

function fixture() {
  const authorize = vi.fn().mockResolvedValue({ userId: 7n, companyId: 19n });
  const profiles = {
    getProfile: vi.fn().mockRejectedValue(new CompanyProfileError('PROFILE_NOT_FOUND')),
    options: vi.fn().mockResolvedValue({ countries: [], activities: [] }),
    updateProfile: vi.fn().mockRejectedValue(new CompanyProfileError('PROFILE_NOT_FOUND')),
    getCompliance: vi.fn().mockRejectedValue(new CompanyProfileError('PROFILE_NOT_FOUND')),
    updateCompliance: vi.fn().mockRejectedValue(new CompanyProfileError('PROFILE_NOT_FOUND')),
  } as unknown as CompanyProfileService;
  const app = express();
  app.use(express.json());
  app.use(createCompanyRouter({ authorize } as unknown as AuthService, {} as CompanyService, profiles));
  return { app, authorize };
}

describe('company profile HTTP authorization boundary', () => {
  it('uses distinct view permissions without requiring CSRF for reads', async () => {
    const { app, authorize } = fixture();
    await request(app).get('/company-profile').set('Cookie', 'sid=session').expect(404);
    await request(app).get('/company-compliance').set('Cookie', 'sid=session').expect(404);
    expect(authorize).toHaveBeenNthCalledWith(1, {
      sid: 'session', csrfToken: undefined, permission: 'companies.profile.view', requireCsrf: false,
    });
    expect(authorize).toHaveBeenNthCalledWith(2, {
      sid: 'session', csrfToken: undefined, permission: 'companies.compliance.view', requireCsrf: false,
    });
  });

  it('requires the separate manage permissions and CSRF for writes', async () => {
    const { app, authorize } = fixture();
    await request(app).patch('/company-profile').set('Cookie', 'sid=session').set('X-CSRF-Token', 'csrf').send({ version: 0, tradeName: 'Northstar' }).expect(404);
    await request(app).patch('/company-compliance').set('Cookie', 'sid=session').set('X-CSRF-Token', 'csrf').send({ version: 0, legalName: 'Northstar Legal' }).expect(404);
    expect(authorize).toHaveBeenNthCalledWith(1, {
      sid: 'session', csrfToken: 'csrf', permission: 'companies.profile.manage', requireCsrf: true,
    });
    expect(authorize).toHaveBeenNthCalledWith(2, {
      sid: 'session', csrfToken: 'csrf', permission: 'companies.compliance.manage', requireCsrf: true,
    });
  });
});
