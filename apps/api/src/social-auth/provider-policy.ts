import type { ProviderIdentity, SocialProvider } from './social-auth-policy.js';

export const SOCIAL_PROVIDER_POLICY = {
  GOOGLE: {
    canonicalIssuer: 'https://accounts.google.com',
    acceptedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
    callbackMode: 'query',
  },
  APPLE: {
    canonicalIssuer: 'https://appleid.apple.com',
    acceptedIssuers: ['https://appleid.apple.com'],
    callbackMode: 'form_post',
  },
} as const satisfies Record<SocialProvider, {
  canonicalIssuer: string;
  acceptedIssuers: readonly string[];
  callbackMode: 'query' | 'form_post';
}>;

export type ProviderIdentityResult =
  | Readonly<{ kind: 'accepted'; identity: ProviderIdentity }>
  | Readonly<{ kind: 'rejected'; reason: 'ISSUER_MISMATCH' | 'EMPTY_SUBJECT' }>;

/** Canonicalizes only claims that a trusted OIDC adapter has already verified. */
export function providerIdentityFromVerifiedClaims(input: Readonly<{
  provider: SocialProvider;
  issuer: string;
  subject: string;
}>): ProviderIdentityResult {
  const policy = SOCIAL_PROVIDER_POLICY[input.provider];
  if (!(policy.acceptedIssuers as readonly string[]).includes(input.issuer)) {
    return { kind: 'rejected', reason: 'ISSUER_MISMATCH' };
  }
  if (!input.subject.trim()) return { kind: 'rejected', reason: 'EMPTY_SUBJECT' };
  return {
    kind: 'accepted',
    identity: { provider: input.provider, issuer: policy.canonicalIssuer, subject: input.subject },
  };
}

export function isApplePrivateRelayEmail(email: string): boolean {
  return email.trim().toLocaleLowerCase('en-US').endsWith('@privaterelay.appleid.com');
}

