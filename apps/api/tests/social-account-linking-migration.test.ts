import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../prisma/migrations/20260906220000_social_account_provider_uniqueness/', import.meta.url);

describe('social account linking migration', () => {
  it('is migration 74 and adds one provider identity per user without rewriting rows', async () => {
    const [directories, migration, schema] = await Promise.all([
      readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true }),
      readFile(new URL('migration.sql', migrationRoot), 'utf8'),
      readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
    ]);
    expect(directories.filter((entry) => entry.isDirectory())).toHaveLength(75);
    expect(migration).toContain('ADD UNIQUE INDEX `ext_identity_user_provider_key` (`user_id`, `provider`)');
    expect(migration).not.toMatch(/\b(?:DELETE|UPDATE|REPLACE)\b/iu);
    expect(schema).toContain('@@unique([userId, provider], map: "ext_identity_user_provider_key")');
  });

  it('rolls back only the provider uniqueness index and restores the prior lookup index', async () => {
    const rollback = await readFile(new URL('rollback.sql', migrationRoot), 'utf8');
    expect(rollback).toContain('DROP INDEX `ext_identity_user_provider_key`');
    expect(rollback).toContain('ADD INDEX `external_identities_user_provider_idx` (`user_id`, `provider`)');
    expect(rollback).not.toMatch(/\b(?:DELETE|UPDATE|REPLACE)\b/iu);
  });
});
