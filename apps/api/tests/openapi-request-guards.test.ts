import { describe, expect, it } from 'vitest';
import {
  companyCurrencyCreateRequestSchema,
  companyCurrencyUpdateRequestSchema,
  companyExchangeRateUpsertRequestSchema,
  companyUpdateRequestSchema,
  guardedOpenApiOperations,
  loginRequestSchema,
  passwordResetCompleteRequestSchema,
  passwordResetStartRequestSchema,
  registrationResendRequestSchema,
  registrationStartRequestSchema,
  registrationVerifyRequestSchema,
  selectCompanyRequestSchema,
  settingUpdateListSchema,
  type CompanyCurrencyCreateRequest,
  type CompanyCurrencyUpdateRequest,
  type CompanyExchangeRateUpsertRequest,
  type CompanyUpdateRequest,
  type LoginRequest,
  type SelectCompanyRequest,
  type SettingUpdateList,
} from '../src/generated/openapi-request-guards.js';

describe('generated OpenAPI request guards', () => {
  it('exposes the guarded operation inventory', () => {
    expect(guardedOpenApiOperations).toEqual([
      'login',
      'startPasswordReset',
      'completePasswordReset',
      'startSelfRegistration',
      'resendSelfRegistrationVerification',
      'verifySelfRegistration',
      'selectCompanyContext',
      'updateCurrentCompany',
      'replaceCompanySettings',
      'createCompanyCurrency',
      'replaceCompanyCurrencies',
      'upsertCompanyExchangeRate',
    ]);
  });

  it('enforces the password-reset boundary from OpenAPI', () => {
    expect(passwordResetStartRequestSchema.parse({ email: ' owner@example.com ', locale: 'ar' }))
      .toEqual({ email: 'owner@example.com', locale: 'ar' });
    expect(passwordResetStartRequestSchema.safeParse({ email: 'owner@example.com', locale: 'fr' }).success).toBe(false);
    expect(passwordResetStartRequestSchema.safeParse({ email: 'owner@example.com', locale: 'ar', extra: true }).success).toBe(false);

    const token = 'a'.repeat(43);
    expect(passwordResetCompleteRequestSchema.safeParse({ token, password: 'a secure new password' }).success).toBe(true);
    expect(passwordResetCompleteRequestSchema.safeParse({ token: 'bad token', password: 'a secure new password' }).success).toBe(false);
    expect(passwordResetCompleteRequestSchema.safeParse({ token, password: 'too short' }).success).toBe(false);
  });

  it('enforces the public registration boundary from OpenAPI', () => {
    const registration = {
      email: ' owner@example.com ', password: 'a secure password', displayName: '  Owner  ',
      organizationName: '  Group  ', companyName: '  Company  ', timezone: ' Asia/Aden ',
      baseCurrencyCode: 'YER', locale: 'ar', chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
    } as const;
    expect(registrationStartRequestSchema.parse(registration)).toMatchObject({ email: 'owner@example.com', displayName: 'Owner', timezone: 'Asia/Aden' });
    expect(registrationStartRequestSchema.safeParse({ ...registration, password: 'short' }).success).toBe(false);
    expect(registrationStartRequestSchema.safeParse({ ...registration, baseCurrencyCode: 'yer' }).success).toBe(false);
    expect(registrationStartRequestSchema.safeParse({ ...registration, extra: true }).success).toBe(false);
    expect(registrationResendRequestSchema.parse({ email: ' owner@example.com ' })).toEqual({ email: 'owner@example.com' });
    expect(registrationVerifyRequestSchema.safeParse({ token: 'x'.repeat(43) }).success).toBe(true);
    expect(registrationVerifyRequestSchema.safeParse({ token: 'bad token' }).success).toBe(false);
  });

  it('validates login with the compatibility limits declared in OpenAPI', () => {
    const input: LoginRequest = { email: 'user@example.com', password: 'x'.repeat(1024) };
    expect(loginRequestSchema.parse(input)).toEqual(input);
    expect(loginRequestSchema.safeParse({ ...input, password: '' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ ...input, password: 'x'.repeat(1025) }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('validates the selected company identifier without coercion', () => {
    const input: SelectCompanyRequest = { companyId: '1001' };
    expect(selectCompanyRequestSchema.parse(input)).toEqual(input);
    expect(selectCompanyRequestSchema.safeParse({ companyId: '0' }).success).toBe(false);
    expect(selectCompanyRequestSchema.safeParse({ companyId: 1001 }).success).toBe(false);
    expect(selectCompanyRequestSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('trims company updates and requires at least one declared field', () => {
    const input: CompanyUpdateRequest = { name: '  شركة الاختبار  ', timezone: '  Asia/Riyadh  ' };
    expect(companyUpdateRequestSchema.parse(input)).toEqual({ name: 'شركة الاختبار', timezone: 'Asia/Riyadh' });
    expect(companyUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(companyUpdateRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(companyUpdateRequestSchema.safeParse({ name: 'شركة', extra: true }).success).toBe(false);
  });

  it('requires the single supported company setting', () => {
    const input: SettingUpdateList = { settings: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: true }] };
    expect(settingUpdateListSchema.parse(input)).toEqual(input);
    expect(settingUpdateListSchema.safeParse({ settings: [] }).success).toBe(false);
    expect(settingUpdateListSchema.safeParse({ settings: [input.settings[0], input.settings[0]] }).success).toBe(false);
    expect(settingUpdateListSchema.safeParse({ settings: [{ key: 'unknown', value: true }] }).success).toBe(false);
  });

  it('keeps duplicate currency identifiers compatible and validates their transport type', () => {
    const input: CompanyCurrencyUpdateRequest = { currencyIds: ['2', '2'] };
    expect(companyCurrencyUpdateRequestSchema.parse(input)).toEqual(input);
    expect(companyCurrencyUpdateRequestSchema.safeParse({ currencyIds: ['0'] }).success).toBe(false);
    expect(companyCurrencyUpdateRequestSchema.safeParse({ currencyIds: [2] }).success).toBe(false);
    expect(companyCurrencyUpdateRequestSchema.safeParse({ currencyIds: Array.from({ length: 51 }, () => '2') }).success).toBe(false);
  });

  it('normalizes and validates a company-owned currency request', () => {
    const input: CompanyCurrencyCreateRequest = { code: ' ABC ', nameAr: '  عملة اختبار  ', decimals: 3 };
    expect(companyCurrencyCreateRequestSchema.parse(input)).toEqual({ code: 'ABC', nameAr: 'عملة اختبار', decimals: 3 });
    expect(companyCurrencyCreateRequestSchema.safeParse({ ...input, code: 'abc' }).success).toBe(false);
    expect(companyCurrencyCreateRequestSchema.safeParse({ ...input, code: 'ABCD' }).success).toBe(false);
    expect(companyCurrencyCreateRequestSchema.safeParse({ ...input, decimals: 9 }).success).toBe(false);
    expect(companyCurrencyCreateRequestSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('validates positive exchange rates and trims their optional source', () => {
    const input: CompanyExchangeRateUpsertRequest = { currencyId: '2', rateDate: '2026-08-21', rate: '0.10000000', source: '  البنك  ' };
    expect(companyExchangeRateUpsertRequestSchema.parse(input)).toEqual({ ...input, source: 'البنك' });
    expect(companyExchangeRateUpsertRequestSchema.safeParse({ ...input, rate: '0.00000000' }).success).toBe(false);
    expect(companyExchangeRateUpsertRequestSchema.safeParse({ ...input, rate: '1.0000000' }).success).toBe(false);
    expect(companyExchangeRateUpsertRequestSchema.safeParse({ ...input, source: '   ' }).success).toBe(false);
  });
});
