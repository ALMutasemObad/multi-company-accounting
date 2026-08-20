import { describe, expect, it } from 'vitest';
import { companyProvisioningSchema } from '../src/platform/company-provisioning-service.js';

const valid = {
  organizationCode: 'client-group',
  organizationName: 'مجموعة العميل',
  companyCode: 'company-001',
  companyName: 'شركة العميل',
  timezone: 'Asia/Riyadh',
  baseCurrencyCode: 'sar',
  adminEmail: ' ADMIN@Example.COM ',
  adminDisplayName: 'مدير الشركة',
  adminPassword: 'Unique-Temporary-Password-2026!',
};

describe('company provisioning input', () => {
  it('normalizes stable tenant identifiers and the global user identity', () => {
    const result = companyProvisioningSchema.parse(valid);
    expect(result.organizationCode).toBe('CLIENT-GROUP');
    expect(result.companyCode).toBe('COMPANY-001');
    expect(result.baseCurrencyCode).toBe('SAR');
    expect(result.adminEmail).toBe('admin@example.com');
  });

  it('rejects invalid tenant identifiers, timezones and weak temporary passwords', () => {
    expect(() => companyProvisioningSchema.parse({ ...valid, companyCode: 'شركة' })).toThrow();
    expect(() => companyProvisioningSchema.parse({ ...valid, timezone: 'Riyadh' })).toThrow();
    expect(() => companyProvisioningSchema.parse({ ...valid, adminPassword: 'short' })).toThrow();
  });
});
