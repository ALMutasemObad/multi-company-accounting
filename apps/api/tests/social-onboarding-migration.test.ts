import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../prisma/migrations/20260906210000_social_onboarding_continuation/', import.meta.url);

describe('social onboarding migration', () => {
  it('is migration 73 and stores only hashed or protected continuation material', async () => {
    const [directories, migration, schema] = await Promise.all([
      readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true }),
      readFile(new URL('migration.sql', migrationRoot), 'utf8'),
      readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
    ]);
    expect(directories.filter((entry) => entry.isDirectory())).toHaveLength(73);
    expect(migration).toContain('`token_hash` BINARY(32) NOT NULL');
    expect(migration).toContain('`protected_profile` VARBINARY(2048) NOT NULL');
    expect(migration).toContain('`browser_binding_hash` BINARY(32) NOT NULL');
    expect(migration).not.toMatch(/access_token|refresh_token|id_token/u);
    expect(schema).toMatch(/passwordHash\s+String\?/u);
  });

  it('rolls back fail-closed before dropping evidence and never rewrites social-only credentials', async () => {
    const rollback = await readFile(new URL('rollback.sql', migrationRoot), 'utf8');
    const restorePasswordConstraint = rollback.indexOf('MODIFY `password_hash` VARCHAR(255) NOT NULL');
    const dropContinuation = rollback.indexOf('DROP TABLE IF EXISTS `social_onboarding_continuations`');
    expect(restorePasswordConstraint).toBeGreaterThanOrEqual(0);
    expect(dropContinuation).toBeGreaterThan(restorePasswordConstraint);
    expect(rollback).not.toMatch(/\b(?:DELETE|UPDATE)\s+`?users`?/iu);
  });
});
