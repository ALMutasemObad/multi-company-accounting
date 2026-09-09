import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../prisma/migrations/20260909110000_company_business_profile_bp1/', import.meta.url);

describe('company business profile migration', () => {
  it('is additive for pending registrations, backfills old companies, and stores only number suffixes', async () => {
    const migration = await readFile(new URL('migration.sql', root), 'utf8');
    expect(migration).toContain('ADD COLUMN `phone` VARCHAR(40) NULL');
    expect(migration).toContain("SELECT `id`, `name`, 'SMALL_BUSINESS_GENERAL', CURRENT_TIMESTAMP(3)");
    expect(migration).toContain('`number_last4` VARCHAR(4) NULL');
    expect(migration).not.toContain('`number` VARCHAR');
    expect(migration).toContain("'companies.profile.view'");
    expect(migration).toContain("'companies.compliance.manage'");
  });

  it('refuses destructive rollback after profile, compliance, or new registration use', async () => {
    const rollback = await readFile(new URL('rollback.sql', root), 'utf8');
    const refusal = rollback.indexOf('company_business_profile_rollback_refused_business_data_exists');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(rollback.indexOf('DROP TABLE `company_addresses`'));
    expect(rollback).toContain('`grandfathered_at` IS NULL OR `version` <> 0 OR `compliance_version` <> 0');
    expect(rollback).toContain('SELECT 1 FROM `registration_requests`');
  });
});
