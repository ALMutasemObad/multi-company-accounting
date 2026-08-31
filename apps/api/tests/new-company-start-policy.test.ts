import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  configuredStartPlanVersionId,
  SubscriptionStartPolicyError,
  type StartPlanVersion,
  validateNewCompanyStartPlan,
} from '../src/platform-subscriptions/new-company-start-policy.js';
import { PrismaNewCompanySubscriptionProvisioningAdapter } from '../src/platform-subscriptions/prisma-new-company-subscription-provisioning-adapter.js';
import { PrismaPlatformBillingSubscriptionSnapshotAdapter } from '../src/platform-subscriptions/prisma-platform-billing-subscription-snapshot-adapter.js';

const effectiveAt = new Date('2026-08-31T12:00:00.000Z');
const publishedAt = new Date('2026-08-30T00:00:00.000Z');
const versionId = 9007199254740993n;
type Entitlement = StartPlanVersion['entitlements'][number];

function entitlement(
  moduleId: bigint,
  code: string,
  dependencies: bigint[] = [],
  selectionMode: Entitlement['selectionMode'] = 'INCLUDED',
): Entitlement {
  return {
    planVersionId: versionId,
    moduleId,
    selectionMode,
    additionalRecurringFee: null,
    createdAt: publishedAt,
    module: {
      id: moduleId,
      code,
      displayName: code,
      isActive: true,
      version: 0,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      dependencies: dependencies.map((dependsOnModuleId) => ({ moduleId, dependsOnModuleId, createdAt: publishedAt })),
    },
  };
}

function startPlan(overrides: Partial<StartPlanVersion> = {}): StartPlanVersion {
  return {
    id: versionId,
    planId: 200n,
    versionNumber: 4,
    displayName: 'Synthetic server-configured start plan',
    description: null,
    billingCycle: 'MONTHLY',
    currencyCode: 'SAR',
    version: 8,
    recurringFee: new Prisma.Decimal('0'),
    includedUsers: 3,
    pricePerAdditionalUser: new Prisma.Decimal('0'),
    includedEmployees: 17,
    pricePerAdditionalEmployee: new Prisma.Decimal('0'),
    includedPostedDocuments: 91,
    pricePerAdditionalPostedDocument: new Prisma.Decimal('0'),
    taxRate: new Prisma.Decimal('0'),
    paymentTermsDays: 0,
    trialDays: 0,
    effectiveFrom: publishedAt,
    selfServicePolicy: 'IMMEDIATE_FREE',
    publishedAt,
    publiclyListed: false,
    retiredAt: null,
    createdById: null,
    updatedById: null,
    publishedById: null,
    createdAt: publishedAt,
    plan: {
      id: 200n,
      code: 'SYNTHETIC_START_POLICY',
      isActive: true,
      version: 2,
      createdById: null,
      updatedById: null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
    },
    entitlements: [entitlement(1n, 'CORE_ACCOUNTING'), entitlement(2n, 'SALES', [1n])],
    ...overrides,
  };
}

function adapterFixture(plan: StartPlanVersion | null = startPlan(), existing = false) {
  const subscriptionFind = vi.fn().mockResolvedValue(existing ? { id: 300n } : null);
  const planFind = vi.fn().mockResolvedValue(plan);
  const subscriptionCreate = vi.fn<(args: Prisma.PlatformSubscriptionCreateArgs) => Promise<{ id: bigint }>>()
    .mockResolvedValue({ id: 300n });
  const entitlementCreate = vi.fn<(args: Prisma.PlatformSubscriptionEntitlementCreateManyArgs) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: 2 });
  const changeCreate = vi.fn<(args: Prisma.PlatformSubscriptionChangeCreateArgs) => Promise<{ id: bigint }>>()
    .mockResolvedValue({ id: 400n });
  const changeFind = vi.fn().mockResolvedValue(null);
  const legacyPlanCreate = vi.fn();
  const planVersionCreate = vi.fn();
  const planEntitlementCreate = vi.fn();
  const subscriptionUpdate = vi.fn();
  const entitlementUpdate = vi.fn();
  const tx = {
    platformSubscription: { findUnique: subscriptionFind, create: subscriptionCreate, updateMany: subscriptionUpdate },
    platformPlan: { create: legacyPlanCreate },
    platformPlanVersion: { findUnique: planFind, create: planVersionCreate },
    platformPlanEntitlement: { createMany: planEntitlementCreate },
    platformSubscriptionEntitlement: { createMany: entitlementCreate, updateMany: entitlementUpdate },
    platformSubscriptionChange: { create: changeCreate, findFirst: changeFind },
  } as unknown as Prisma.TransactionClient;
  const writes = [subscriptionCreate, entitlementCreate, changeCreate, legacyPlanCreate,
    planVersionCreate, planEntitlementCreate, subscriptionUpdate, entitlementUpdate];
  return { tx, subscriptionFind, planFind, subscriptionCreate, entitlementCreate, changeCreate,
    changeFind, legacyPlanCreate, planVersionCreate, planEntitlementCreate, subscriptionUpdate, entitlementUpdate, writes };
}

const provisioningInput = { companyId: 52n, baseCurrencyCode: 'SAR', effectiveFrom: effectiveAt };

describe('server-configured new-company start plan identifier', () => {
  it.each([undefined, ''])('fails closed when the start policy is absent (%s)', (value) => {
    expect(() => configuredStartPlanVersionId(value)).toThrowError(new SubscriptionStartPolicyError('NOT_CONFIGURED'));
  });

  it.each([' ', ' 12', '12 ', '0', '-1', '+1', '01', '1.0', '1e3', '0x10', '123abc',
    '18446744073709551616', '999999999999999999999'])('rejects a noncanonical or overflowing BIGINT (%s)', (value) => {
    expect(() => configuredStartPlanVersionId(value)).toThrowError(new SubscriptionStartPolicyError('INVALID_CONFIGURATION'));
  });

  it.each(['1', '9007199254740993', '18446744073709551615'])('preserves the exact unsigned BIGINT (%s)', (value) => {
    expect(configuredStartPlanVersionId(value)).toBe(BigInt(value));
  });
});

describe('new-company start plan eligibility', () => {
  it('keeps the configured immutable version, limits, and trial without requiring public listing', () => {
    const plan = startPlan({ trialDays: 11, includedUsers: 7, includedEmployees: 23, includedPostedDocuments: 131 });
    const selected = validateNewCompanyStartPlan(plan, effectiveAt, 'SAR');
    expect(selected.version).toBe(plan);
    expect(selected.version).toMatchObject({ id: versionId, versionNumber: 4, trialDays: 11,
      includedUsers: 7, includedEmployees: 23, includedPostedDocuments: 131, publiclyListed: false });
    expect(selected.modules).toEqual([{ moduleId: 1n, selectionMode: 'INCLUDED' }, { moduleId: 2n, selectionMode: 'INCLUDED' }]);
  });

  it('requires the referenced plan version to exist', () => {
    expect(() => validateNewCompanyStartPlan(null, effectiveAt, 'SAR'))
      .toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
  });

  const invalidVersions: [string, (plan: StartPlanVersion) => void][] = [
    ['inactive plan', (plan) => { plan.plan.isActive = false; }],
    ['company legacy plan', (plan) => { plan.plan.code = 'LEGACY_COMPANY_52'; }],
    ['other legacy plan', (plan) => { plan.plan.code = 'LEGACY_START'; }],
    ['unpublished version', (plan) => { plan.publishedAt = null; }],
    ['future publication', (plan) => { plan.publishedAt = new Date(effectiveAt.getTime() + 1); }],
    ['future effectivity', (plan) => { plan.effectiveFrom = new Date(effectiveAt.getTime() + 1); }],
    ['retired version', (plan) => { plan.retiredAt = publishedAt; }],
    ['disabled self-service', (plan) => { plan.selfServicePolicy = 'DISABLED'; }],
    ['request-only self-service', (plan) => { plan.selfServicePolicy = 'REQUEST_ONLY'; }],
    ['unpriced base fee', (plan) => { plan.recurringFee = null; }],
    ['positive base fee', (plan) => { plan.recurringFee = new Prisma.Decimal('0.0001'); }],
    ['negative base fee', (plan) => { plan.recurringFee = new Prisma.Decimal('-0.0001'); }],
    ['unconfigured additional-user fee', (plan) => { plan.pricePerAdditionalUser = null; }],
    ['unconfigured additional-employee fee', (plan) => { plan.pricePerAdditionalEmployee = null; }],
    ['unconfigured additional-document fee', (plan) => { plan.pricePerAdditionalPostedDocument = null; }],
    ['positive additional-user fee', (plan) => { plan.pricePerAdditionalUser = new Prisma.Decimal('0.0001'); }],
    ['positive additional-employee fee', (plan) => { plan.pricePerAdditionalEmployee = new Prisma.Decimal('0.0001'); }],
    ['positive additional-document fee', (plan) => { plan.pricePerAdditionalPostedDocument = new Prisma.Decimal('0.0001'); }],
    ['negative metered fee', (plan) => { plan.pricePerAdditionalUser = new Prisma.Decimal('-1'); }],
    ['unconfigured user limit', (plan) => { plan.includedUsers = null; }],
    ['unconfigured employee limit', (plan) => { plan.includedEmployees = null; }],
    ['unconfigured document limit', (plan) => { plan.includedPostedDocuments = null; }],
    ['negative limit', (plan) => { plan.includedUsers = -1; }],
    ['fractional limit', (plan) => { plan.includedEmployees = 0.5; }],
    ['overflowing limit', (plan) => { plan.includedPostedDocuments = 4294967296; }],
    ['different company currency', (plan) => { plan.currencyCode = 'USD'; }],
    ['malformed currency', (plan) => { plan.currencyCode = 'sar'; }],
    ['negative trial', (plan) => { plan.trialDays = -1; }],
    ['fractional trial', (plan) => { plan.trialDays = 0.5; }],
    ['overflowing trial', (plan) => { plan.trialDays = 65536; }],
    ['inactive included module', (plan) => { plan.entitlements[0]!.module.isActive = false; }],
    ['unknown included module', (plan) => { plan.entitlements[0]!.module.code = 'UNKNOWN_MODULE'; }],
    ['paid included module', (plan) => { plan.entitlements[0]!.additionalRecurringFee = new Prisma.Decimal('1'); }],
    ['misclassified included-module fee', (plan) => { plan.entitlements[0]!.additionalRecurringFee = new Prisma.Decimal('0'); }],
    ['duplicate included module', (plan) => { plan.entitlements.push(entitlement(1n, 'CORE_ACCOUNTING')); }],
    ['missing included dependency', (plan) => { plan.entitlements = [entitlement(2n, 'SALES', [1n])]; }],
    ['dependency available only as optional', (plan) => { plan.entitlements[0]!.selectionMode = 'OPTIONAL'; }],
    ['self dependency', (plan) => { plan.entitlements = [entitlement(1n, 'CORE_ACCOUNTING', [1n])]; }],
    ['cyclic dependencies', (plan) => { plan.entitlements = [entitlement(1n, 'CORE_ACCOUNTING', [2n]), entitlement(2n, 'SALES', [1n])]; }],
  ];

  it.each(invalidVersions)('rejects %s', (_description, mutate) => {
    const plan = startPlan();
    mutate(plan);
    expect(() => validateNewCompanyStartPlan(plan, effectiveAt, 'SAR'))
      .toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
  });

  it('rejects an invalid provisioning timestamp', () => {
    expect(() => validateNewCompanyStartPlan(startPlan(), new Date(Number.NaN), 'SAR'))
      .toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
  });

  it('accepts the exact publication/effectivity boundary and explicitly zero metered fees', () => {
    const plan = startPlan({ publishedAt: effectiveAt, effectiveFrom: effectiveAt,
      pricePerAdditionalUser: new Prisma.Decimal('0'), pricePerAdditionalEmployee: new Prisma.Decimal('0'),
      pricePerAdditionalPostedDocument: new Prisma.Decimal('0') });
    expect(validateNewCompanyStartPlan(plan, effectiveAt, 'SAR').version).toBe(plan);
  });

  it('grants only INCLUDED modules, leaving unselected paid or unavailable optional modules untouched', () => {
    const optional = entitlement(3n, 'POS', [999n], 'OPTIONAL');
    optional.additionalRecurringFee = new Prisma.Decimal('125.5000');
    optional.module.isActive = false;
    const plan = startPlan({ entitlements: [entitlement(1n, 'CORE_ACCOUNTING'), optional] });
    expect(validateNewCompanyStartPlan(plan, effectiveAt, 'SAR').modules)
      .toEqual([{ moduleId: 1n, selectionMode: 'INCLUDED' }]);
  });
});

describe('PrismaNewCompanySubscriptionProvisioningAdapter', () => {
  it('creates one company-scoped subscription with PLAN rights and operator-configured provenance', async () => {
    const plan = startPlan({ trialDays: 11 });
    plan.entitlements.push(entitlement(3n, 'POS', [2n], 'OPTIONAL'));
    const fixture = adapterFixture(plan);
    const adapter = new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString());
    await adapter.provisionNewCompanyAccess(fixture.tx, provisioningInput);

    expect(fixture.subscriptionFind).toHaveBeenCalledExactlyOnceWith({ where: { companyId: 52n }, select: { id: true } });
    expect(fixture.planFind).toHaveBeenCalledExactlyOnceWith({ where: { id: versionId },
      include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } });
    expect(fixture.subscriptionCreate).toHaveBeenCalledExactlyOnceWith({
      data: { companyId: 52n, planVersionId: versionId, status: 'TRIALING', startsAt: effectiveAt,
        trialEndsAt: new Date('2026-09-11T12:00:00.000Z') },
      select: { id: true },
    });
    expect(fixture.entitlementCreate).toHaveBeenCalledExactlyOnceWith({
      data: [1n, 2n].map((moduleId) => ({ companyId: 52n, subscriptionId: 300n, moduleId,
        source: 'PLAN', effectiveFrom: effectiveAt, reason: 'Server-configured new-company start policy' })),
    });
    expect(fixture.changeCreate).toHaveBeenCalledExactlyOnceWith({ data: {
      companyId: 52n, subscriptionId: 300n, targetPlanVersionId: versionId, state: 'APPROVED',
      source: 'PLATFORM_OPERATOR', requestedSubscriptionVersion: 0, requestedAt: effectiveAt,
      effectiveAt, decidedAt: effectiveAt, decisionReason: 'Server-configured new-company start policy',
      currencyCode: 'SAR', baseRecurringFee: plan.recurringFee, optionalRecurringFee: '0', totalRecurringFee: plan.recurringFee,
      modules: { create: [{ moduleId: 1n, selectionMode: 'INCLUDED' }, { moduleId: 2n, selectionMode: 'INCLUDED' }] },
    } });
    const changeData = fixture.changeCreate.mock.calls[0]![0].data;
    expect(changeData).not.toHaveProperty('requestedById');
    expect(changeData).not.toHaveProperty('decidedById');
    expect(changeData).not.toHaveProperty('fromPlanVersionId');
    for (const unchanged of [fixture.legacyPlanCreate, fixture.planVersionCreate, fixture.planEntitlementCreate,
      fixture.subscriptionUpdate, fixture.entitlementUpdate]) expect(unchanged).not.toHaveBeenCalled();
  });

  it('uses ACTIVE without a trial when the configured version has zero trial days', async () => {
    const fixture = adapterFixture(startPlan({ trialDays: 0 }));
    await new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
      .provisionNewCompanyAccess(fixture.tx, provisioningInput);
    expect(fixture.subscriptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE', trialEndsAt: null }),
    }));
  });

  it('retains a complete zero-priced billing snapshot for the accepted start version', async () => {
    const fixture = adapterFixture();
    await new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
      .provisionNewCompanyAccess(fixture.tx, provisioningInput);
    fixture.subscriptionFind.mockResolvedValue({ id: 300n, planVersionId: versionId });
    fixture.changeFind.mockResolvedValue({ targetPlanVersionId: versionId, totalRecurringFee: new Prisma.Decimal('0') });
    const snapshot = await new PrismaPlatformBillingSubscriptionSnapshotAdapter().resolve(fixture.tx, {
      companyId: provisioningInput.companyId, asOf: effectiveAt,
    });
    expect(snapshot).toMatchObject({ subscriptionId: 300n, planVersionId: versionId,
      includedUsers: 3, includedEmployees: 17, includedPostedDocuments: 91 });
    expect([snapshot?.recurringFee, snapshot?.pricePerAdditionalUser,
      snapshot?.pricePerAdditionalEmployee, snapshot?.pricePerAdditionalPostedDocument]
      .map((fee) => fee?.toFixed(4))).toEqual(['0.0000', '0.0000', '0.0000', '0.0000']);
  });

  it.each([undefined, '', 'bad-id', '0', versionId.toString()])('preserves any existing subscription before consulting policy (%s)', async (configuration) => {
    const fixture = adapterFixture(null, true);
    await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(configuration)
      .provisionNewCompanyAccess(fixture.tx, provisioningInput)).resolves.toBeUndefined();
    expect(fixture.planFind).not.toHaveBeenCalled();
    for (const write of fixture.writes) expect(write).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '0', '1.5', '18446744073709551616'])('makes no subscription or catalog writes for invalid configuration (%s)', async (configuration) => {
    const fixture = adapterFixture();
    await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(configuration)
      .provisionNewCompanyAccess(fixture.tx, provisioningInput)).rejects.toBeInstanceOf(SubscriptionStartPolicyError);
    expect(fixture.planFind).not.toHaveBeenCalled();
    for (const write of fixture.writes) expect(write).not.toHaveBeenCalled();
  });

  it.each([null, startPlan({ recurringFee: new Prisma.Decimal('1') }), startPlan({ currencyCode: 'USD' })])
    ('makes no writes when the configured version is absent or ineligible', async (plan) => {
      const fixture = adapterFixture(plan);
      await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
        .provisionNewCompanyAccess(fixture.tx, provisioningInput)).rejects.toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
      for (const write of fixture.writes) expect(write).not.toHaveBeenCalled();
    });

  it.each(['pricePerAdditionalUser', 'pricePerAdditionalEmployee', 'pricePerAdditionalPostedDocument'] as const)
    ('rejects missing %s before all writes instead of allowing billing-account pricing fallback', async (field) => {
      const plan = startPlan({ [field]: null });
      const fixture = adapterFixture(plan);
      await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
        .provisionNewCompanyAccess(fixture.tx, provisioningInput)).rejects.toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
      expect(plan[field]).toBeNull();
      for (const write of fixture.writes) expect(write).not.toHaveBeenCalled();
    });

  it('leaves a configured empty module set empty instead of granting all active modules', async () => {
    const fixture = adapterFixture(startPlan({ entitlements: [] }));
    await new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
      .provisionNewCompanyAccess(fixture.tx, provisioningInput);
    expect(fixture.entitlementCreate).not.toHaveBeenCalled();
    expect(fixture.changeCreate.mock.calls[0]![0].data).not.toHaveProperty('modules');
    expect(fixture.legacyPlanCreate).not.toHaveBeenCalled();
  });

  it('propagates a subscription uniqueness race to the transaction owner without an internal retry or rights write', async () => {
    const fixture = adapterFixture();
    const conflict = new Prisma.PrismaClientKnownRequestError('Synthetic concurrent subscription insert', {
      code: 'P2002', clientVersion: 'unit-test', meta: { target: ['company_id'] },
    });
    fixture.subscriptionCreate.mockRejectedValueOnce(conflict);
    await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
      .provisionNewCompanyAccess(fixture.tx, provisioningInput)).rejects.toBe(conflict);
    expect(fixture.subscriptionCreate).toHaveBeenCalledOnce();
    expect(fixture.entitlementCreate).not.toHaveBeenCalled();
    expect(fixture.changeCreate).not.toHaveBeenCalled();
  });

  it('propagates entitlement write failures so the caller can roll back the complete provisioning transaction', async () => {
    const fixture = adapterFixture();
    const failure = new Error('SYNTHETIC_ENTITLEMENT_WRITE_FAILURE');
    fixture.entitlementCreate.mockRejectedValueOnce(failure);
    await expect(new PrismaNewCompanySubscriptionProvisioningAdapter(versionId.toString())
      .provisionNewCompanyAccess(fixture.tx, provisioningInput)).rejects.toBe(failure);
    expect(fixture.subscriptionCreate).toHaveBeenCalledOnce();
    expect(fixture.entitlementCreate).toHaveBeenCalledOnce();
    expect(fixture.changeCreate).not.toHaveBeenCalled();
  });
});
