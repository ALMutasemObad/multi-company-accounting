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
    expect(openApiContractCoverage).toEqual({ operations: 269, requestBodies: 144, responseBodies: 1768 });
    expect(guardedOpenApiOperations).toHaveLength(144);
    expect(guardedOpenApiOperations).toEqual(expect.arrayContaining([
      'login', 'createUser', 'linkUserEmployee', 'createManualJournal', 'createReceipt', 'updatePaymentMethod', 'createWarehouse', 'createUnitOfMeasure', 'createInventoryItem', 'createInventoryMovement', 'initializeInventoryBalanceValuation', 'reverseInventoryMovement', 'previewDataImport', 'commitDataImport', 'previewBankStatement', 'commitBankStatementImport', 'createBankReconciliationSession', 'generateBankReconciliationSuggestions', 'approveBankReconciliationMatch', 'createManualBankReconciliationMatch', 'releaseBankReconciliationMatch', 'classifyBankStatementLine', 'closeBankReconciliationSession', 'startFinancialCloseRun', 'refreshFinancialCloseRun', 'createApprovalRequest', 'approveApprovalRequest', 'rejectApprovalRequest', 'createProfessionalProject', 'assignProfessionalProjectMember', 'createProfessionalTimeEntry', 'createProfessionalTimesheet', 'createProfessionalServiceContract', 'endProfessionalServiceContract', 'createProfessionalServiceRate', 'endProfessionalServiceRate', 'createProfessionalBillingRun', 'updateProfessionalProjectAccess', 'grantProfessionalProjectAccess', 'revokeProfessionalProjectAccess', 'updateProfessionalProjectTimeBudget', 'createProfessionalProjectStage', 'updateProfessionalProjectStage', 'transitionProfessionalProjectStage', 'createProfessionalProjectTask', 'updateProfessionalProjectTask', 'transitionProfessionalProjectTask', 'createProfessionalProjectTaskDependency', 'removeProfessionalProjectTaskDependency', 'createHrDepartment', 'updateHrDepartment', 'createHrPosition', 'updateHrPosition', 'createEmployee', 'updateEmployee', 'transitionEmployee', 'createEmploymentContract', 'endEmploymentContract', 'returnFinancialCloseRun', 'updateCashFlowMapping',
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

  it('validates professional project and personal time commands', () => {
    expect(openApiRequestBodySchemas.createProfessionalProject.parse({
      customerId: '12',
      nameAr: '  قضية استشارية  ',
      kind: 'LEGAL_MATTER',
      billingModel: 'TIME_AND_MATERIALS',
      startDate: '2057-08-27',
    })).toMatchObject({ customerId: 12n, nameAr: 'قضية استشارية' });
    expect(openApiRequestBodySchemas.createProfessionalProject.safeParse({
      code: 'MANUAL', customerId: '12', nameAr: 'قضية', kind: 'LEGAL_MATTER', billingModel: 'FIXED_FEE', startDate: '2057-08-27',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createProfessionalTimeEntry.safeParse({
      projectId: '5aa8b232-356c-4d55-8b89-f27d44d1678d', workDate: '2057-08-27', minutes: 1441, isBillable: true, description: 'عمل',
    }).success).toBe(false);
  });

  it('validates ethical-wall commands and the strict access response', () => {
    const projectId = '5aa8b232-356c-4d55-8b89-f27d44d1678d';
    const grantId = '74d5c65e-3381-4aba-a3ae-0b61409375f6';

    expect(openApiRequestBodySchemas.updateProfessionalProjectAccess.parse({
      accessVersion: 2,
      accessMode: 'RESTRICTED',
      reason: '  قضية سرية  ',
    })).toEqual({ accessVersion: 2, accessMode: 'RESTRICTED', reason: 'قضية سرية' });
    expect(openApiRequestBodySchemas.grantProfessionalProjectAccess.parse({
      accessVersion: 3,
      userId: '7',
      reason: '  عضو فريق القضية  ',
    })).toEqual({ accessVersion: 3, userId: 7n, reason: 'عضو فريق القضية' });
    expect(openApiRequestBodySchemas.revokeProfessionalProjectAccess.parse({
      accessVersion: 4,
      grantVersion: 1,
      reason: '  انتهت الحاجة  ',
    })).toEqual({ accessVersion: 4, grantVersion: 1, reason: 'انتهت الحاجة' });
    expect(openApiRequestBodySchemas.updateProfessionalProjectAccess.safeParse({
      accessVersion: 2,
      accessMode: 'BYPASS',
      reason: 'غير مسموح',
    }).success).toBe(false);

    expect(parseOpenApiResponseBody('getProfessionalProjectAccess', 200, {
      projectId,
      accessMode: 'RESTRICTED',
      accessVersion: 5,
      grants: [{
        id: grantId,
        user: { id: '7', displayName: 'مستشار القضية', nameEn: null },
        isActive: true,
        version: 1,
        grantReason: 'عضو فريق القضية',
        grantedAt: '2057-08-27T10:00:00.000Z',
        revocationReason: null,
        revokedAt: null,
      }],
    })).toMatchObject({ accessMode: 'RESTRICTED', grants: [{ user: { id: '7' } }] });
    expect(() => parseOpenApiResponseBody('getProfessionalProjectAccess', 200, {
      projectId,
      accessMode: 'RESTRICTED',
      accessVersion: 5,
      grants: [],
      bypass: true,
    })).toThrow();
  });

  it('validates professional contracts, rates, and billing commands', () => {
    expect(openApiRequestBodySchemas.createProfessionalServiceContract.parse({
      projectId: '5aa8b232-356c-4d55-8b89-f27d44d1678d',
      currencyId: '12',
      contractReference: '  RET-2026-01  ',
      effectiveFrom: '2057-08-27',
      paymentTermsDays: 30,
    })).toMatchObject({ currencyId: 12n, contractReference: 'RET-2026-01' });
    expect(openApiRequestBodySchemas.createProfessionalServiceRate.parse({
      contractId: '5aa8b232-356c-4d55-8b89-f27d44d1678d',
      userId: '7',
      hourlyRate: '450.0000',
      effectiveFrom: '2057-08-27',
    })).toMatchObject({ userId: 7n, hourlyRate: '450.0000' });
    expect(openApiRequestBodySchemas.createProfessionalBillingRun.parse({
      projectId: '5aa8b232-356c-4d55-8b89-f27d44d1678d',
      contractId: '74d5c65e-3381-4aba-a3ae-0b61409375f6',
      contractVersion: 0,
      sourceDateFrom: '2057-08-27',
      sourceDateTo: '2057-08-31',
      fiscalPeriodId: '3',
      documentDate: '2057-08-31',
      exchangeRate: '1.00000000',
      revenueAccountId: '9',
      costCenterId: null,
    })).toMatchObject({ fiscalPeriodId: 3n, revenueAccountId: 9n, costCenterId: null });
    expect(openApiRequestBodySchemas.createProfessionalBillingRun.safeParse({
      projectId: '5aa8b232-356c-4d55-8b89-f27d44d1678d',
      contractId: '74d5c65e-3381-4aba-a3ae-0b61409375f6',
      contractVersion: 0,
      sourceDateFrom: '2057-08-27',
      sourceDateTo: '2057-08-31',
      fiscalPeriodId: '3',
      documentDate: '2057-08-31',
      exchangeRate: '1',
      revenueAccountId: '9',
    }).success).toBe(false);
  });

  it('validates professional planning commands and the derived plan response', () => {
    const stageId = '5aa8b232-356c-4d55-8b89-f27d44d1678d';
    const predecessorTaskId = '74d5c65e-3381-4aba-a3ae-0b61409375f6';
    const successorTaskId = 'a4bb7408-9423-4fa3-81d5-3d34ea7f6a12';
    expect(openApiRequestBodySchemas.updateProfessionalProjectTimeBudget.parse({
      planningVersion: 2, timeBudgetMinutes: null,
    })).toEqual({ planningVersion: 2, timeBudgetMinutes: null });
    expect(openApiRequestBodySchemas.updateProfessionalProjectTimeBudget.safeParse({
      planningVersion: 2, timeBudgetMinutes: 0,
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateProfessionalProjectTimeBudget.parse({
      planningVersion: 2, timeBudgetMinutes: 4294967295,
    })).toEqual({ planningVersion: 2, timeBudgetMinutes: 4294967295 });
    expect(openApiRequestBodySchemas.updateProfessionalProjectTimeBudget.safeParse({
      planningVersion: 2, timeBudgetMinutes: 4294967296,
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createProfessionalProjectStage.parse({
      planningVersion: 2, nameAr: '  البحث والتحليل  ', plannedStartDate: null, targetEndDate: '2057-09-30',
    })).toEqual({ planningVersion: 2, nameAr: 'البحث والتحليل', plannedStartDate: null, targetEndDate: '2057-09-30' });
    expect(openApiRequestBodySchemas.createProfessionalProjectTask.parse({
      planningVersion: 3, titleAr: '  إعداد المذكرة  ', assigneeUserId: '7', estimatedMinutes: 240,
      plannedStartDate: null, dueDate: null,
    })).toMatchObject({ planningVersion: 3, titleAr: 'إعداد المذكرة', assigneeUserId: 7n, estimatedMinutes: 240 });
    expect(openApiRequestBodySchemas.createProfessionalProjectTaskDependency.parse({
      planningVersion: 4, predecessorTaskId, successorTaskId,
    })).toEqual({ planningVersion: 4, predecessorTaskId, successorTaskId });
    expect(openApiRequestBodySchemas.transitionProfessionalProjectTask.safeParse({
      planningVersion: 4, version: 0, status: 'BLOCKED', reason: 'سبب غير صالح',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateProfessionalProjectStage.safeParse({
      planningVersion: 4, version: 0,
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createProfessionalProjectTask.safeParse({
      planningVersion: 4, titleAr: 'مهمة', assigneeUserId: '7', estimatedMinutes: 0,
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createProfessionalProjectTask.safeParse({
      planningVersion: 4, titleAr: 'مهمة', assigneeUserId: '7', estimatedMinutes: 4294967296,
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateProfessionalProjectTask.safeParse({
      planningVersion: 4, version: 0, estimatedMinutes: 4294967296,
    }).success).toBe(false);

    expect(parseOpenApiResponseBody('getProfessionalProjectPlan', 200, {
      projectId: stageId,
      planningVersion: 5,
      summary: {
        timeBudgetMinutes: 1200,
        estimatedMinutes: 480,
        actualMinutes: 90,
        approvedMinutes: 60,
        allocatedActualMinutes: 90,
        unallocatedActualMinutes: 0,
        remainingBudgetMinutes: 1110,
        overBudgetMinutes: 0,
        taskCounts: { TODO: 1, IN_PROGRESS: 1, COMPLETED: 0, CANCELLED: 0 },
      },
      stages: [{
        id: stageId,
        sequence: 1,
        nameAr: 'البحث والتحليل',
        nameEn: null,
        description: null,
        status: 'IN_PROGRESS',
        plannedStartDate: null,
        targetEndDate: '2057-09-30',
        version: 1,
        summary: {
          estimatedMinutes: 480,
          actualMinutes: 90,
          approvedMinutes: 60,
          taskCounts: { TODO: 1, IN_PROGRESS: 1, COMPLETED: 0, CANCELLED: 0 },
        },
        tasks: [{
          id: predecessorTaskId,
          stageId,
          sequence: 1,
          titleAr: 'إعداد المذكرة',
          titleEn: null,
          description: null,
          status: 'IN_PROGRESS',
          assigneeUserId: '7',
          estimatedMinutes: 240,
          plannedStartDate: null,
          dueDate: null,
          completedAt: null,
          version: 1,
          actualMinutes: 90,
          approvedMinutes: 60,
        }],
      }],
      dependencies: [{ id: successorTaskId, predecessorTaskId, successorTaskId, isActive: true, version: 0 }],
    })).toMatchObject({ planningVersion: 5, stages: [{ tasks: [{ assigneeUserId: '7' }] }] });
  });

  it('validates HR foundation commands and keeps master-data codes server-owned', () => {
    expect(openApiRequestBodySchemas.createHrDepartment.parse({
      nameAr: '  الشؤون القانونية  ', nameEn: '  Legal affairs  ', description: null,
    })).toEqual({ nameAr: 'الشؤون القانونية', nameEn: 'Legal affairs', description: null });
    expect(openApiRequestBodySchemas.createHrDepartment.safeParse({
      code: 'DEP-MANUAL', nameAr: 'الشؤون القانونية',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.updateHrDepartment.safeParse({
      version: 0, isActive: false,
    }).success).toBe(true);
    expect(openApiRequestBodySchemas.createEmployee.parse({
      nameAr: '  مستشار قانوني  ', employmentType: 'FULL_TIME', hireDate: '2057-08-27',
    })).toMatchObject({ nameAr: 'مستشار قانوني', employmentType: 'FULL_TIME' });
    expect(openApiRequestBodySchemas.createEmployee.safeParse({
      nameAr: 'مستشار قانوني', employmentType: 'FULL_TIME', hireDate: '2057-08-27', userId: '12',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.createUser.parse({
      employeeId: 'f219c95d-f972-4943-badc-9a84aa78c0a3',
      email: 'counsel@example.com',
      temporaryPassword: 'temporary-secret',
    })).toMatchObject({ email: 'counsel@example.com' });
    expect(openApiRequestBodySchemas.createUser.safeParse({
      employeeId: 'f219c95d-f972-4943-badc-9a84aa78c0a3',
      email: 'counsel@example.com',
      temporaryPassword: 'temporary-secret',
      nameAr: 'اسم مكرر',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.linkUserEmployee.safeParse({
      employeeId: 'f219c95d-f972-4943-badc-9a84aa78c0a3',
    }).success).toBe(true);
    expect(openApiRequestBodySchemas.createEmployee.safeParse({
      employeeNumber: 'EMP-MANUAL', nameAr: 'مستشار', employmentType: 'FULL_TIME', hireDate: '2057-08-27',
    }).success).toBe(false);
    expect(openApiRequestBodySchemas.transitionEmployee.safeParse({
      version: 1, status: 'TERMINATED', effectiveDate: '2057-09-01', reason: 'إنهاء موثق',
    }).success).toBe(true);
    expect(openApiRequestBodySchemas.createEmploymentContract.safeParse({
      contractType: 'CONSULTANT', titleAr: 'عقد استشاري', startDate: '2057-08-27', salary: '1000.00',
    }).success).toBe(false);
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
    expect(parseOpenApiResponseBody('getCurrentFinancialCloseRun', 200, { run: null })).toEqual({ run: null });
    expect(parseOpenApiResponseBody('createProfessionalBillingRun', 201, {
      run: {
        id: '74d5c65e-3381-4aba-a3ae-0b61409375f6',
        project: { id: '5aa8b232-356c-4d55-8b89-f27d44d1678d', code: 'PRJ-000001', nameAr: 'قضية', nameEn: null },
        contract: { id: 'db98e719-b9f2-443a-adb2-58ae58128c38', contractReference: 'RET-1' },
        contractVersion: 0,
        sourceDateFrom: '2057-08-27',
        sourceDateTo: '2057-08-27',
        sourceEntryCount: 1,
        sourceMinutes: 60,
        invoice: {
          id: '11', documentId: '12', documentNumber: 'SINV-000001', status: 'POSTED',
          currency: { id: '2', code: 'SAR', nameAr: 'الريال' }, total: '450.0000', baseTotal: '450.0000',
        },
        createdAt: '2057-08-27T12:00:00.000Z',
      },
    })).toMatchObject({ run: { sourceEntryCount: 1, invoice: { status: 'POSTED' } } });
  });

  it('validates financial close workflow command bodies', () => {
    expect(openApiRequestBodySchemas.startFinancialCloseRun.parse({ version: 3 })).toEqual({ version: 3 });
    expect(openApiRequestBodySchemas.createApprovalRequest.parse({
      subjectType: 'FINANCIAL_CLOSE_RUN',
      subjectId: '37e9cfd7-fde1-4d9e-a5d5-3193390c38bd',
      subjectVersion: 1,
    })).toMatchObject({ subjectType: 'FINANCIAL_CLOSE_RUN', subjectVersion: 1 });
    expect(openApiRequestBodySchemas.approveApprovalRequest.parse({ version: 1 })).toEqual({ version: 1 });
    expect(openApiRequestBodySchemas.rejectApprovalRequest.parse({ version: 1, reason: 'حزمة تحتاج إلى مراجعة إضافية' })).toMatchObject({ version: 1 });
    expect(openApiRequestBodySchemas.returnFinancialCloseRun.parse({ version: 2, reason: 'إعادة موثقة للتحضير' })).toEqual({ version: 2, reason: 'إعادة موثقة للتحضير' });
    expect(openApiRequestBodySchemas.closeFiscalPeriod.parse({
      version: 4,
      closeRunId: '37e9cfd7-fde1-4d9e-a5d5-3193390c38bd',
      closeRunVersion: 2,
    })).toMatchObject({ version: 4, closeRunVersion: 2 });
  });
});
