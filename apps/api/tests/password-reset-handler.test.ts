import { describe, expect, it } from 'vitest';
import { derivePasswordResetToken } from '../src/auth/password-reset-handler.js';
import { deriveRegistrationVerificationToken } from '../src/registration/registration-verification-handler.js';

describe('password reset token derivation', () => {
  it('is stable for retries and domain-separated from registration tokens', () => {
    const secret = 'test-secret-that-is-at-least-thirty-two-characters';
    const eventId = '5eeb7f58-46fd-46d6-b0fd-8f68df39f05c';
    expect(derivePasswordResetToken(eventId, secret)).toBe(derivePasswordResetToken(eventId, secret));
    expect(derivePasswordResetToken(eventId, secret)).not.toBe(deriveRegistrationVerificationToken(eventId, secret));
  });
});
