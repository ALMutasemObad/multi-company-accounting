import { describe, expect, it } from 'vitest';
import {
  createCompanyCurrencyRequestSchema,
  createReceiptRequestSchema,
  guardedOpenApiOperations,
  loginRequestSchema,
  openApiContractCoverage,
  openApiRequestBodySchemas,
  parseOpenApiResponseBody,
  completePasswordResetRequestSchema,
  startPasswordResetRequestSchema,
  resendSelfRegistrationVerificationRequestSchema,
  startSelfRegistrationRequestSchema,
  verifySelfRegistrationRequestSchema,
  selectCompanyContextRequestSchema,
  replaceCompanySettingsRequestSchema,
  replaceCompanyCurrenciesRequestSchema,
  updateCurrentCompanyRequestSchema,
  upsertCompanyExchangeRateRequestSchema,
  type LoginRequest,
} from '../src/generated/openapi-request-guards.js';

describe('generated OpenAPI request guards', () => {
  it('exposes the guarded operation inventory', () => {
    expect(openApiContractCoverage).toEqual({ operations: 178, requestBodies: 91, responseBodies: 1237 });
    expect(guardedOpenApiOperations).toHaveLength(91);
    expect(guardedOpenApiOperations).toEqual(expect.arrayContaining([
      'login', 'createUser', 'createManualJournal', 'createReceipt', 'updatePaymentMethod', 'createWarehouse', 'createUnitOfMeasure', 'createInventoryItem', 'createInventoryMovement', 'initializeInventoryBalanceValuation', 'reverseInventoryMovement', 'previewDataImport', 'commitDataImport',
    ]));
  });

  it('keeps warehouse codes server-owned and versioned changes contract-backed', () => {
    expect(openApiRequestBodySchemas.createWarehouse.parse({
      nameAr: '  المستودع الرئيسي  ', nameEn: 'Main', address: 'Riyadh',
    })).toEqual({ nameAr: 'المستودع الرئيسي', nameEn: 'Main', address: 'Riyadh' });
    expect(openApiRequestBodySchemas.createWarehouse.safeParse({ code: 'MANUAL', nameAr: 'مستودع' }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateWarehouse.safeParse({ nameAr: 'مستودع' }).success).toBe(false);
    expect(openApiRequestBodySchemas.deactivateWarehouse.safeParse({ version: 0, reason: 'لا' }).success).toBe(false);
  });

  it('enforces semantic unit codes and server-owned inventory item codes', () => {
    expect(openApiRequestBodySchemas.createUnitOfMeasure.parse({
      code: ' ea ', nameAr: '  حبة  ', decimalPlaces: 0,
    })).toEqual({ code: 'ea', nameAr: 'حبة', decimalPlaces: 0 });
    expect(openApiRequestBodySchemas.createUnitOfMeasure.safeParse({ code: '1EA', nameAr: 'حبة', decimalPlaces: 0 }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateUnitOfMeasure.safeParse({ version: 0, code: 'KG' }).success).toBe(false);
    expect(openApiRequestBodySchemas.createInventoryItem.parse({
      unitOfMeasureId: '12', nameAr: '  قلم  ', description: null,
    })).toEqual({ unitOfMeasureId: 12n, nameAr: 'قلم', description: null });
    expect(openApiRequestBodySchemas.createInventoryItem.safeParse({
      code: 'MANUAL', unitOfMeasureId: '12', nameAr: 'قلم',
    }).success).toBe(false);
  });

  it('validates invoice catalog links and six-decimal item quantities', () => {
    const line = {
      inventoryItemId: '41',
      description: 'قلم',
      quantity: '2.125000',
      unitPrice: '10.0000',
      discountAmount: '0.0000',
      revenueAccountId: '8',
    };
    expect(openApiRequestBodySchemas.createSalesInvoice.parse({
      documentType: 'SALES_INVOICE',
      fiscalPeriodId: '1',
      documentDate: '2045-01-01',
      dueDate: '2045-01-01',
      description: 'فاتورة أصناف',
      customerId: '2',
      warehouseId: '9',
      currencyId: '3',
      exchangeRate: '1.00000000',
      lines: [line],
    })).toMatchObject({ warehouseId: 9n, lines: [{ inventoryItemId: 41n, quantity: '2.125000' }] });
    expect(openApiRequestBodySchemas.createSalesInvoice.safeParse({
      documentType: 'SALES_INVOICE', fiscalPeriodId: '1', documentDate: '2045-01-01',
      dueDate: '2045-01-01', description: 'فاتورة', customerId: '2', currencyId: '3',
      exchangeRate: '1.00000000', lines: [{ ...line, quantity: '2.1234567' }],
    }).success).toBe(false);
  });

  it('normalizes inventory movement identifiers and bounds quantity precision', () => {
    expect(openApiRequestBodySchemas.createInventoryMovement.parse({
      movementType: 'TRANSFER',
      movementDate: '2026-08-24',
      description: '  تحويل بين مستودعين  ',
      externalReference: null,
      lines: [{ inventoryItemId: '41', fromWarehouseId: '9', toWarehouseId: '10', quantity: '2.125000' }],
    })).toEqual({
      movementType: 'TRANSFER',
      movementDate: '2026-08-24',
      description: 'تحويل بين مستودعين',
      externalReference: null,
      lines: [{ inventoryItemId: 41n, fromWarehouseId: 9n, toWarehouseId: 10n, quantity: '2.125000' }],
    });
    expect(openApiRequestBodySchemas.createInventoryMovement.safeParse({
      movementType: 'RECEIPT', movementDate: '2026-08-24', description: 'استلام',
      lines: [{ inventoryItemId: '41', toWarehouseId: '9', quantity: '2.1234567' }],
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createInventoryMovement.safeParse({
      movementType: 'DELETE_STOCK', movementDate: '2026-08-24', description: 'نوع مرفوض',
      lines: [{ inventoryItemId: '41', toWarehouseId: '9', quantity: '1' }],
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.reverseInventoryMovement.parse({
      version: 0,
      reversalDate: '2026-08-25',
      reason: '  تصحيح حركة خاطئة  ',
    })).toEqual({ version: 0, reversalDate: '2026-08-25', reason: 'تصحيح حركة خاطئة' });
  });

  it('enforces the password-reset boundary from OpenAPI', () => {
    expect(startPasswordResetRequestSchema.parse({ email: ' owner@example.com ', locale: 'ar' }))
      .toEqual({ email: 'owner@example.com', locale: 'ar' });
    expect(startPasswordResetRequestSchema.safeParse({ email: 'owner@example.com', locale: 'ur' }).success).toBe(true);
    expect(startPasswordResetRequestSchema.safeParse({ email: 'owner@example.com', locale: 'hi' }).success).toBe(true);
    expect(startPasswordResetRequestSchema.safeParse({ email: 'owner@example.com', locale: 'fr' }).success).toBe(false);
    expect(startPasswordResetRequestSchema.safeParse({ email: 'owner@example.com', locale: 'ar', extra: true }).success).toBe(false);

    const token = 'a'.repeat(43);
    expect(completePasswordResetRequestSchema.safeParse({ token, password: 'a secure new password' }).success).toBe(true);
    expect(completePasswordResetRequestSchema.safeParse({ token: 'bad token', password: 'a secure new password' }).success).toBe(false);
    expect(completePasswordResetRequestSchema.safeParse({ token, password: 'too short' }).success).toBe(false);
  });

  it('enforces the public registration boundary from OpenAPI', () => {
    const registration = {
      email: ' owner@example.com ', password: 'a secure password', displayName: '  Owner  ',
      organizationName: '  Group  ', companyName: '  Company  ', timezone: ' Asia/Aden ',
      baseCurrencyCode: 'YER', locale: 'ar', chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
    } as const;
    expect(startSelfRegistrationRequestSchema.parse(registration)).toMatchObject({ email: 'owner@example.com', displayName: 'Owner', timezone: 'Asia/Aden' });
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, locale: 'ur' }).success).toBe(true);
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, locale: 'hi' }).success).toBe(true);
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, password: 'short' }).success).toBe(false);
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, baseCurrencyCode: 'yer' }).success).toBe(false);
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, extra: true }).success).toBe(false);
    expect(resendSelfRegistrationVerificationRequestSchema.parse({ email: ' owner@example.com ' })).toEqual({ email: 'owner@example.com' });
    expect(verifySelfRegistrationRequestSchema.safeParse({ token: 'x'.repeat(43) }).success).toBe(true);
    expect(verifySelfRegistrationRequestSchema.safeParse({ token: 'bad token' }).success).toBe(false);
  });

  it('validates login with the compatibility limits declared in OpenAPI', () => {
    const input: LoginRequest = { email: 'user@example.com', password: 'x'.repeat(1024) };
    expect(loginRequestSchema.parse(input)).toEqual(input);
    expect(loginRequestSchema.safeParse({ ...input, password: '' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ ...input, password: 'x'.repeat(1025) }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('validates the selected company identifier without coercion', () => {
    expect(selectCompanyContextRequestSchema.parse({ companyId: '1001' })).toEqual({ companyId: 1001n });
    expect(selectCompanyContextRequestSchema.safeParse({ companyId: '0' }).success).toBe(false);
    expect(selectCompanyContextRequestSchema.safeParse({ companyId: 1001 }).success).toBe(false);
    expect(selectCompanyContextRequestSchema.safeParse({ companyId: '1001', extra: true }).success).toBe(false);
  });

  it('trims company updates and requires at least one declared field', () => {
    const input = { name: '  شركة الاختبار  ', timezone: '  Asia/Riyadh  ' };
    expect(updateCurrentCompanyRequestSchema.parse(input)).toEqual({ name: 'شركة الاختبار', timezone: 'Asia/Riyadh' });
    expect(updateCurrentCompanyRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCurrentCompanyRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateCurrentCompanyRequestSchema.safeParse({ name: 'شركة', extra: true }).success).toBe(false);
  });

  it('requires the single supported company setting', () => {
    const input = { settings: [{ key: 'accounting.manual_journal_maker_checker_enabled' as const, value: true }] };
    expect(replaceCompanySettingsRequestSchema.parse(input)).toEqual(input);
    expect(replaceCompanySettingsRequestSchema.safeParse({ settings: [] }).success).toBe(false);
    expect(replaceCompanySettingsRequestSchema.safeParse({ settings: [input.settings[0], input.settings[0]] }).success).toBe(false);
    expect(replaceCompanySettingsRequestSchema.safeParse({ settings: [{ key: 'unknown', value: true }] }).success).toBe(false);
  });

  it('keeps duplicate currency identifiers compatible and validates their transport type', () => {
    const input = { currencyIds: ['2', '2'] };
    expect(replaceCompanyCurrenciesRequestSchema.parse(input)).toEqual({ currencyIds: [2n, 2n] });
    expect(replaceCompanyCurrenciesRequestSchema.safeParse({ currencyIds: ['0'] }).success).toBe(false);
    expect(replaceCompanyCurrenciesRequestSchema.safeParse({ currencyIds: [2] }).success).toBe(false);
    expect(replaceCompanyCurrenciesRequestSchema.safeParse({ currencyIds: Array.from({ length: 51 }, () => '2') }).success).toBe(false);
  });

  it('normalizes and validates a company-owned currency request', () => {
    const input = { code: ' ABC ', nameAr: '  عملة اختبار  ', decimals: 3 };
    expect(createCompanyCurrencyRequestSchema.parse(input)).toEqual({ code: 'ABC', nameAr: 'عملة اختبار', decimals: 3 });
    expect(createCompanyCurrencyRequestSchema.safeParse({ ...input, code: 'abc' }).success).toBe(false);
    expect(createCompanyCurrencyRequestSchema.safeParse({ ...input, code: 'ABCD' }).success).toBe(false);
    expect(createCompanyCurrencyRequestSchema.safeParse({ ...input, decimals: 9 }).success).toBe(false);
    expect(createCompanyCurrencyRequestSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('validates positive exchange rates and trims their optional source', () => {
    const input = { currencyId: '2', rateDate: '2026-08-21', rate: '0.10000000', source: '  البنك  ' };
    expect(upsertCompanyExchangeRateRequestSchema.parse(input)).toEqual({ ...input, currencyId: 2n, source: 'البنك' });
    expect(upsertCompanyExchangeRateRequestSchema.safeParse({ ...input, rate: '0.00000000' }).success).toBe(false);
    expect(upsertCompanyExchangeRateRequestSchema.safeParse({ ...input, rate: '1.0000000' }).success).toBe(false);
    expect(upsertCompanyExchangeRateRequestSchema.safeParse({ ...input, source: '   ' }).success).toBe(false);
  });

  it('enforces nested BIGINT conversion and receipt counterparty XOR', () => {
    const input = {
      fiscalPeriodId: '1', documentDate: '2026-08-22', description: 'قبض', customerId: '2',
      cashBankAccountId: '3', paymentMethodId: '4', currencyId: '5', exchangeRate: '1.00000000',
      amount: '10.0000', counterpartyName: 'عميل', allocations: [{ receivableItemId: '6', allocatedAmount: '10.0000' }],
    };
    expect(createReceiptRequestSchema.parse(input)).toMatchObject({
      fiscalPeriodId: 1n, customerId: 2n, cashBankAccountId: 3n,
      allocations: [{ receivableItemId: 6n, allocatedAmount: '10.0000' }],
    });
    expect(createReceiptRequestSchema.safeParse({ ...input, counterAccountId: null }).success).toBe(true);
    expect(createReceiptRequestSchema.safeParse({ ...input, counterAccountId: '7' }).success).toBe(false);
    expect(createReceiptRequestSchema.safeParse({ ...input, customerId: undefined }).success).toBe(false);
  });

  it('preserves legacy normalization and optional defaults in generated operational guards', () => {
    expect(openApiRequestBodySchemas.createRole.parse({
      nameAr: '  مدير مخصص  ', nameEn: '  Custom manager  ',
    })).toEqual({ nameAr: 'مدير مخصص', nameEn: 'Custom manager', permissionIds: [] });

    expect(openApiRequestBodySchemas.updateSalesInvoice.parse({
      version: 2,
      description: '  تعديل الفاتورة  ',
      customerAddress: '  الرياض  ',
      notes: '  ملاحظة  ',
    })).toEqual({
      version: 2,
      description: 'تعديل الفاتورة',
      customerAddress: 'الرياض',
      notes: 'ملاحظة',
    });

    expect(openApiRequestBodySchemas.createCustomer.safeParse({
      receivableAccountId: '1', nameAr: 'عميل', nameEn: 'x'.repeat(201),
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createReceipt.safeParse({
      fiscalPeriodId: '1', documentDate: '2026-08-22', description: 'قبض', customerId: '2',
      cashBankAccountId: '3', paymentMethodId: '4', currencyId: '5', exchangeRate: '1.00000000',
      amount: '10.0000', counterpartyName: 'عميل', counterpartyTaxNumber: 'x'.repeat(65),
    }).success).toBe(false);
  });

  it('validates generated JSON response bodies', () => {
    expect(parseOpenApiResponseBody('getHealth', 200, {
      status: 'ok', service: 'mcap-finance-api', checks: { database: 'up' },
    })).toMatchObject({ status: 'ok', service: 'mcap-finance-api' });
    expect(() => parseOpenApiResponseBody('getHealth', 200, {
      status: 'invalid', service: 'mcap-finance-api',
    })).toThrow();
  });
});
