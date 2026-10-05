import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupEncryptTransform, BackupDecryptTransform, validateBackupPassphrase } from '../../scripts/lib/backup-format.mjs';

const fail = () => { throw new Error('Payroll key recovery preflight failed; inspect protected configuration without logging secrets'); };
function protectedPath(file, directory = false) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail();
  if (realpathSync(file) !== path.resolve(file)) fail();
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail();
}

export function validatePayrollKeys(value) {
  if (!value || value.format !== 'mcap-payroll-keys-v1') fail();
  const ring = value.keys;
  if (!ring || typeof ring !== 'object' || Array.isArray(ring) || !Object.keys(ring).length) fail();
  for (const [id, key] of Object.entries(ring)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof key !== 'string' ||
        Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) fail();
  }
  if (!Object.hasOwn(ring, value.activeKeyId) || !Object.hasOwn(ring, value.fingerprintKeyId)) fail();
  return value;
}

const collect = async (...streams) => {
  const chunks = [];
  await pipeline(...streams, new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }));
  return Buffer.concat(chunks);
};

export async function preparePayrollRecovery({ keyFile, backupDirectory, passphrase, allowBootstrap = false }) {
  validateBackupPassphrase(passphrase);
  protectedPath(path.dirname(keyFile), true);
  protectedPath(backupDirectory, true);
  let value;
  if (existsSync(keyFile)) {
    protectedPath(keyFile);
    value = validatePayrollKeys(JSON.parse(readFileSync(keyFile, 'utf8')));
  } else {
    if (!allowBootstrap) fail();
    value = { format: 'mcap-payroll-keys-v1', activeKeyId: 'enc_20261005', fingerprintKeyId: 'fp_20261005',
      keys: { enc_20261005: randomBytes(32).toString('base64'), fp_20261005: randomBytes(32).toString('base64') } };
    // Exclusive creation: never replace keys after partial or repeated deployments.
    writeFileSync(keyFile, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  }
  const plaintext = Buffer.from(JSON.stringify(value));
  const encrypted = await collect(Readable.from([plaintext]), new BackupEncryptTransform(passphrase));
  const backupFile = path.join(backupDirectory, `payroll-keys-${Date.now()}-${randomUUID()}.jwb`);
  writeFileSync(backupFile, encrypted, { flag: 'wx', mode: 0o600 });
  protectedPath(backupFile);
  const recovered = await collect(Readable.from([readFileSync(backupFile)]), new BackupDecryptTransform(passphrase));
  if (!recovered.equals(plaintext)) fail();
  const restored = validatePayrollKeys(JSON.parse(recovered.toString('utf8')));
  // Prove every retained encryption key, including historical keys, survived restore.
  for (const [id, encoded] of Object.entries(value.keys)) {
    const nonce = randomBytes(12), aad = Buffer.from(`payroll-recovery:${id}`), sample = randomBytes(32);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(encoded, 'base64'), nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(sample), cipher.final()]);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(restored.keys[id], 'base64'), nonce);
    decipher.setAAD(aad); decipher.setAuthTag(cipher.getAuthTag());
    if (!Buffer.concat([decipher.update(ciphertext), decipher.final()]).equals(sample)) fail();
  }
  let rejected = false;
  try { await collect(Readable.from([encrypted]), new BackupDecryptTransform(randomBytes(48).toString('base64'))); }
  catch { rejected = true; }
  if (!rejected) fail();
  plaintext.fill(0); recovered.fill(0);
  return { status: 'verified', backupFile, keyIds: Object.keys(value.keys), activeKeyId: value.activeKeyId, fingerprintKeyId: value.fingerprintKeyId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 10000) fail(); }
    const result = await preparePayrollRecovery({ keyFile: process.argv[2], backupDirectory: process.argv[3],
      passphrase: input.replace(/\r?\n$/, ''), allowBootstrap: process.env.MCAP_PAYROLL_BOOTSTRAP === 'true' });
    console.log(JSON.stringify(result));
  } catch { console.error('Payroll key recovery preflight failed (secret details suppressed)'); process.exitCode = 1; }
}
