import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PROFILE_POLICY_VERSION,
  companyBrandingAssetCapabilities,
  evaluateCompanyProfileReadiness,
  renewalStatus,
} from '../src/companies/company-profile-policy.js';

const completeProfile = {
  tradeName: 'Juwar', countryCode: 'YE', phone: '+9671000000', legalName: 'Juwar LLC',
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
