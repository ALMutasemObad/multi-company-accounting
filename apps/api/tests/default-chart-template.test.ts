import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDefaultChartTemplate,
  chartTemplateCatalog,
  defaultChartDefinitions,
  isAllowedOnboardingChartTemplate,
  isSupportedChartTemplate,
  onboardingChartTemplates,
} from '../src/accounts/default-chart-template.js';

describe('default chart template contract', () => {
  it('has stable unique keys and codes with parents declared before children', () => {
    expect(defaultChartDefinitions).toHaveLength(62);
    expect(new Set(defaultChartDefinitions.map(({ key }) => key)).size).toBe(defaultChartDefinitions.length);
    expect(new Set(defaultChartDefinitions.map(({ code }) => code)).size).toBe(defaultChartDefinitions.length);
    const seen = new Map<string, (typeof defaultChartDefinitions)[number]>();
    for (const definition of defaultChartDefinitions) {
      if (definition.parentKey) {
        const parent = seen.get(definition.parentKey);
        expect(parent, `missing parent ${definition.parentKey} for ${definition.key}`).toBeDefined();
        expect(parent?.allowsPosting, `posting parent ${definition.parentKey}`).toBe(false);
        expect(parent?.accountTypeCode).toBe(definition.accountTypeCode);
      }
      seen.set(definition.key, definition);
    }
  });

  it('keeps every control account postable and every leaf structurally valid', () => {
    const parentKeys = new Set(defaultChartDefinitions.map(({ parentKey }) => parentKey).filter(Boolean));
    for (const definition of defaultChartDefinitions) {
      if (parentKeys.has(definition.key)) expect(definition.allowsPosting).toBe(false);
      if (definition.isControlAccount) expect(definition.allowsPosting).toBe(true);
    }
  });

  it('offers the three business-specific onboarding templates while preserving the legacy code', () => {
    expect(onboardingChartTemplates().map(({ code }) => code)).toEqual([
      'PROFESSIONAL_SERVICES',
      'RETAIL_INVENTORY',
      'MANUFACTURING',
    ]);
    expect(chartTemplateCatalog.find(({ code }) => code === 'SMALL_BUSINESS_GENERAL')).toMatchObject({ availableForOnboarding: false });
    for (const code of ['PROFESSIONAL_SERVICES', 'RETAIL_INVENTORY', 'MANUFACTURING', 'SMALL_BUSINESS_GENERAL']) {
      expect(isSupportedChartTemplate(code)).toBe(true);
    }
    expect(isAllowedOnboardingChartTemplate('PROFESSIONAL_SERVICES')).toBe(true);
    expect(isAllowedOnboardingChartTemplate('SMALL_BUSINESS_GENERAL')).toBe(false);
    expect(isSupportedChartTemplate('UNVERIFIED_TEMPLATE')).toBe(false);
  });

  it('links an existing account with company-scoped CAS once and keeps reapply idempotent', async () => {
    const accounts = defaultChartDefinitions.map((definition, index) => ({
      id: BigInt(index + 1), code: definition.code, parentAccountId: null, level: 1,
      allowsPosting: definition.allowsPosting, isActive: true, version: 4,
      sourceTemplateCode: index === 0 ? null : 'SMALL_BUSINESS_GENERAL',
      sourceTemplateKey: index === 0 ? null : definition.key,
    }));
    const updateMany = vi.fn(async ({ where, data }) => {
      const account = accounts.find((candidate) => candidate.id === where.id && candidate.version === where.version);
      if (!account || where.companyId !== 71n) return { count: 0 };
      account.sourceTemplateCode = data.sourceTemplateCode;
      account.sourceTemplateKey = data.sourceTemplateKey;
      account.version += 1;
      return { count: 1 };
    });
    const tx = {
      accountType: { findMany: vi.fn(async () => ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((code, index) => ({ id: BigInt(index + 1), code }))) },
      account: {
        findMany: vi.fn(async () => accounts), updateMany,
        findFirstOrThrow: vi.fn(async ({ where }) => accounts.find((account) => account.id === where.id && where.companyId === 71n)),
        create: vi.fn(),
      },
    };

    await expect(applyDefaultChartTemplate(tx as never, 71n)).resolves.toMatchObject({ linked: 1, existing: defaultChartDefinitions.length - 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1n, companyId: 71n, version: 4 },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
    expect(accounts[0]?.version).toBe(5);

    await expect(applyDefaultChartTemplate(tx as never, 71n)).resolves.toMatchObject({ linked: 0, existing: defaultChartDefinitions.length });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(accounts[0]?.version).toBe(5);
  });

  it('keeps the monotonic version column across rollback and guards demo normalization with CAS', () => {
    const migration = readFileSync(new URL('../prisma/migrations/20260921170000_account_version_cas/migration.sql', import.meta.url), 'utf8');
    const rollback = readFileSync(new URL('../prisma/migrations/20260921170000_account_version_cas/rollback.sql', import.meta.url), 'utf8');
    const demoSeed = readFileSync(new URL('../prisma/demo-seed.ts', import.meta.url), 'utf8');
    expect(migration).toMatch(/ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 0/u);
    expect(rollback).not.toMatch(/DROP\s+COLUMN/iu);
    expect(rollback).toContain("AND `COLUMN_NAME` = 'version'");
    expect(rollback).toContain("SIGNAL SQLSTATE ''45000''");
    expect(demoSeed).toContain('companyId: company.id, version: existing.version');
    expect(demoSeed).toContain('version: { increment: 1 }');
    expect(demoSeed).toContain('DEMO_SEED_ACCOUNT_VERSION_CONFLICT');
  });
});
