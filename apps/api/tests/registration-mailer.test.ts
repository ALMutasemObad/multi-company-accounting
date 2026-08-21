import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevelopmentRegistrationMailer } from '../src/registration/registration-mailer.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('development registration mailer', () => {
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
});
