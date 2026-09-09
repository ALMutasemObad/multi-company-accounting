import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PROFILE_POLICY_VERSION,
  BUSINESS_PROFILE_POLICY_EFFECTIVE_AT,
  BUSINESS_PROFILE_POLICY_SOURCE,
  companyBrandingAssetCapabilities,
  evaluateCompanyProfileReadiness,
  renewalStatus,
} from '../src/companies/company-profile-policy.js';

const completeProfile = {
  tradeName: 'Northstar', countryCode: 'YE', phone: '+9671000000', legalName: 'Northstar LLC',
  primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES', hasCommercialRegistration: true,
  hasTaxRegistration: true, hasNationalAddress: true, grandfatheredAt: null,
};

describe('company business profile policy', () => {
  it('keeps progressive completion advisory and gives Yemen explicit non-applicable Saudi requirements', () => {
    const readiness = evaluateCompanyProfileReadiness({
      ...completeProfile,
      phone: null,
      grandfatheredAt: new Date('2026-09-09T00:00:00.000Z'),
    });
    expect(readiness).toMatchObject({
      policyVersion: BUSINESS_PROFILE_POLICY_VERSION,
      policySource: BUSINESS_PROFILE_POLICY_SOURCE,
      effectiveAt: BUSINESS_PROFILE_POLICY_EFFECTIVE_AT,
      enforcementMode: 'ADVISORY',
      grandfathered: true,
      completedRequirements: 7,
      totalRequirements: 8,
      missingRequirements: ['BUSINESS_PHONE'],
    });
    expect(readiness.requirements.filter(({ code }) => code.startsWith('SA_'))).toEqual([
      expect.objectContaining({ code: 'SA_COMMERCIAL_REGISTRATION', status: 'NOT_APPLICABLE', blocking: false }),
      expect.objectContaining({ code: 'SA_VAT_REGISTRATION', status: 'NOT_APPLICABLE', blocking: false }),
      expect.objectContaining({ code: 'SA_NATIONAL_ADDRESS', status: 'NOT_APPLICABLE', blocking: false }),
    ]);
    expect(readiness.requirements.every(({ blocking }) => blocking === false)).toBe(true);
  });

  it.each([
    ['YE', 'NOT_APPLICABLE'],
    ['SA', 'OPTIONAL'],
    ['US', 'OPTIONAL'],
  ] as const)('does not invent unverified compliance requirements for %s', (countryCode, expectedStatus) => {
    const readiness = evaluateCompanyProfileReadiness({
      ...completeProfile,
      countryCode,
      hasCommercialRegistration: false,
      hasTaxRegistration: false,
      hasNationalAddress: false,
    });
    for (const code of ['COMMERCIAL_REGISTRATION', 'TAX_REGISTRATION', 'NATIONAL_ADDRESS']) {
      expect(readiness.requirements.find((item) => item.code === code)).toMatchObject({ status: expectedStatus, blocking: false });
      expect(readiness.missingRequirements).not.toContain(code);
    }
  });

  it.each([
    ['YE', 'NOT_APPLICABLE'],
    ['US', 'NOT_APPLICABLE'],
    ['GB', 'NOT_APPLICABLE'],
    ['SA', 'OPTIONAL'],
  ] as const)('applies Saudi-specific requirements only to SA, not %s', (countryCode, expectedStatus) => {
    const readiness = evaluateCompanyProfileReadiness({ ...completeProfile, countryCode });
    for (const requirement of readiness.requirements.filter(({ code }) => code.startsWith('SA_'))) {
      expect(requirement).toMatchObject({ status: expectedStatus, blocking: false });
    }
  });

  it('reports current, due-soon, expired, and untracked renewal states at date boundaries', () => {
    const now = new Date('2026-09-09T18:30:00.000Z');
    expect(renewalStatus(null, now)).toBe('NOT_APPLICABLE');
    expect(renewalStatus(new Date('2026-09-08T00:00:00.000Z'), now)).toBe('EXPIRED');
    expect(renewalStatus(new Date('2026-09-09T00:00:00.000Z'), now)).toBe('DUE_SOON');
    expect(renewalStatus(new Date('2026-11-08T00:00:00.000Z'), now)).toBe('DUE_SOON');
    expect(renewalStatus(new Date('2026-11-09T00:00:00.000Z'), now)).toBe('CURRENT');
  });

  it('exposes logo and letterhead capability metadata without accepting binary uploads', () => {
    expect(companyBrandingAssetCapabilities()).toEqual([
      { kind: 'LOGO', status: 'STORAGE_POLICY_REQUIRED', uploadSupported: false, metadataAccepted: false },
      { kind: 'LETTERHEAD', status: 'STORAGE_POLICY_REQUIRED', uploadSupported: false, metadataAccepted: false },
    ]);
  });
});
