import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentRegistrationMailer, ResendRegistrationMailer } from '../src/registration/registration-mailer.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('registration mailers', () => {
  it('appends a machine-readable verification message when capture is explicitly configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcap-registration-mailer-'));
    temporaryDirectories.push(directory);
    const capturePath = join(directory, 'messages.jsonl');
    const expiresAt = new Date('2026-08-22T00:00:00.000Z');

    await new DevelopmentRegistrationMailer(capturePath).sendVerification({
      to: 'owner@example.com',
      locale: 'en',
      verificationUrl: 'http://127.0.0.1:3200/#register?token=test-token',
      expiresAt,
    });

    expect(JSON.parse((await readFile(capturePath, 'utf8')).trim())).toEqual({
      to: 'owner@example.com',
      locale: 'en',
      verificationUrl: 'http://127.0.0.1:3200/#register?token=test-token',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('captures a password-reset message without changing the verification contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcap-password-reset-mailer-'));
    temporaryDirectories.push(directory);
    const capturePath = join(directory, 'messages.jsonl');
    const expiresAt = new Date('2026-08-22T01:00:00.000Z');

    await new DevelopmentRegistrationMailer(capturePath).sendPasswordReset({
      to: 'user@example.com',
      locale: 'ar',
      resetUrl: 'http://127.0.0.1:3200/#reset-password?token=test-token',
      expiresAt,
    });

    expect(JSON.parse((await readFile(capturePath, 'utf8')).trim())).toEqual({
      to: 'user@example.com',
      locale: 'ar',
      resetUrl: 'http://127.0.0.1:3200/#reset-password?token=test-token',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('renders Urdu RTL verification and Hindi LTR password-reset messages', async () => {
    const provider = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', provider);
    const mailer = new ResendRegistrationMailer('test-key', 'Jawar <no-reply@example.com>');
    const expiresAt = new Date('2026-08-22T01:00:00.000Z');

    await mailer.sendVerification({
      to: 'urdu@example.com', locale: 'ur', verificationUrl: 'https://example.com/#register?token=urdu', expiresAt,
    });
    await mailer.sendPasswordReset({
      to: 'hindi@example.com', locale: 'hi', resetUrl: 'https://example.com/#reset-password?token=hindi', expiresAt,
    });

    const urduBody = JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
    const hindiBody = JSON.parse(String(provider.mock.calls[1]?.[1]?.body));
    expect(urduBody).toMatchObject({ subject: 'اپنی کمپنی بنانے کے لیے اپنے ای میل کی تصدیق کریں' });
    expect(urduBody.html).toContain('dir="rtl"');
    expect(urduBody.html).toContain('تصدیق کریں اور کمپنی بنائیں');
    expect(hindiBody).toMatchObject({ subject: 'अपना पासवर्ड रीसेट करें' });
    expect(hindiBody.html).toContain('dir="ltr"');
    expect(hindiBody.html).toContain('नया पासवर्ड बनाएँ');
  });
});
