import { describe, expect, it, vi } from 'vitest';
import { createOpaqueToken, hashToken } from '../src/auth/session-tokens.js';
import { SocialAuthError, SocialAuthService } from '../src/social-auth/social-auth-service.js';

const now = new Date('2026-09-06T12:00:00.000Z');

function serviceWith(prisma: unknown) {
  return new SocialAuthService(prisma as never, {
    transactionSecret: 'unit-social-onboarding-secret-123456789',
    transactionTtlMinutes: 10,
    sessionTtlHours: 12,
    providers: {},
    onboarding: { continuationTtlMinutes: 10, provisioning: {} as never, owners: {} as never },
  }, undefined, () => now);
}

describe('social onboarding continuation lifecycle', () => {
  it('rejects a disabled provider before creating or cleaning database state', async () => {
    const deleteMany = vi.fn();
    const service = serviceWith({ socialOnboardingContinuation: { deleteMany } });

    await expect(service.start({
      provider: 'GOOGLE', purpose: 'SIGN_IN', consent: false,
    })).rejects.toEqual(new SocialAuthError('PROVIDER_DISABLED'));
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an expired continuation even when its session and browser binding are otherwise valid', async () => {
    const sid = createOpaqueToken();
    const continuation = createOpaqueToken();
    const browserBinding = createOpaqueToken();
    const crypto = await import('node:crypto');
    const browserBindingHash = crypto.createHash('sha256').update(browserBinding).digest();
    const service = serviceWith({
      socialOnboardingContinuation: {
        findUnique: vi.fn(async () => ({
          id: 1n,
          usedAt: null,
          expiresAt: new Date(now.getTime() - 1),
          browserBindingHash,
          initiatingSession: {
            state: 'PRE_AUTH', revokedAt: null, expiresAt: new Date(now.getTime() + 60_000), tokenHash: hashToken(sid),
          },
        })),
      },
    });

    await expect(service.onboardingOptions({ sid, continuation, browserBinding }))
      .rejects.toEqual(new SocialAuthError('ONBOARDING_INVALID'));
  });

  it('removes only continuation and authorization records beyond the retention window', async () => {
    const continuationDelete = vi.fn(async () => ({ count: 2 }));
    const authorizationDelete = vi.fn(async () => ({ count: 3 }));
    const service = serviceWith({
      socialOnboardingContinuation: { deleteMany: continuationDelete },
      socialAuthorizationTransaction: { deleteMany: authorizationDelete },
    });

    await expect(service.cleanupExpired(7)).resolves.toEqual({ count: 3 });
    const cutoff = new Date('2026-08-30T12:00:00.000Z');
    expect(continuationDelete).toHaveBeenCalledWith({
      where: { OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    expect(authorizationDelete).toHaveBeenCalledWith({
      where: {
        onboardingContinuation: { is: null },
        OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
  });
});
