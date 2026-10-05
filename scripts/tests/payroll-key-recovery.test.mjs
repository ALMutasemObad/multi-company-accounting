import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePayrollRecovery, validatePayrollKeys } from '../../deploy/scripts/payroll-key-recovery.mjs';

const passphrase = 'isolated-test-only-backup-passphrase-2026';
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'payroll-recovery-'));
  const backupDirectory = path.join(root, 'backups'), keyDirectory = path.join(root, 'keys');
  mkdirSync(backupDirectory, { mode: 0o700 }); mkdirSync(keyDirectory, { mode: 0o700 });
  return { keyFile: path.join(keyDirectory, 'keys.json'), backupDirectory, passphrase };
}
test('bootstrap is explicit; encrypted backup restores all keys without disclosing them', async () => {
  const f = fixture();
  await assert.rejects(preparePayrollRecovery(f));
  const result = await preparePayrollRecovery({ ...f, allowBootstrap: true });
  assert.equal(result.status, 'verified');
  const keys = JSON.parse(readFileSync(f.keyFile, 'utf8'));
  for (const key of Object.values(keys.keys)) {
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(readFileSync(result.backupFile).includes(Buffer.from(key)), false);
  }
  const before = readFileSync(f.keyFile);
  await preparePayrollRecovery(f);
  assert.deepEqual(readFileSync(f.keyFile), before);
});
test('corrupt existing keys fail closed instead of being replaced', async () => {
  const f = fixture();
  writeFileSync(f.keyFile, '{}', { mode: 0o600 });
  await assert.rejects(preparePayrollRecovery({ ...f, allowBootstrap: true }));
  assert.equal(readFileSync(f.keyFile, 'utf8'), '{}');
});
test('invalid keys or missing stable fingerprint key are rejected', () => {
  assert.throws(() => validatePayrollKeys({ format: 'mcap-payroll-keys-v1', keys: { x: 'bad' }, activeKeyId: 'x', fingerprintKeyId: 'x' }));
  assert.throws(() => validatePayrollKeys({ format: 'mcap-payroll-keys-v1', keys: { x: Buffer.alloc(32).toString('base64') }, activeKeyId: 'x', fingerprintKeyId: 'absent' }));
});
