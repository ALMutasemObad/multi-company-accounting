import type { SocialProvider } from './social-auth-policy.js';

export type AuthorizationTransaction = Readonly<{
  provider: SocialProvider;
  browserBinding: string;
  state: string;
  nonce: string;
  pkceVerifierPresent: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
}>;

export type AuthorizationCallbackDecision =
  | Readonly<{ kind: 'accept_and_consume' }>
  | Readonly<{
      kind: 'reject';
      reason: 'TRANSACTION_EXPIRED' | 'TRANSACTION_REPLAYED' | 'PROVIDER_MISMATCH' | 'BROWSER_BINDING_MISMATCH' | 'STATE_MISMATCH' | 'NONCE_MISMATCH' | 'PKCE_BINDING_MISSING';
    }>;

/**
 * Checks the application-owned, single-use browser transaction. Token/JWS checks stay
 * in the trusted OIDC adapter and must succeed before this policy is invoked.
 */
export function decideAuthorizationCallback(input: Readonly<{
  transaction: AuthorizationTransaction;
  callbackProvider: SocialProvider;
  callbackBrowserBinding: string;
  callbackState: string;
  verifiedTokenNonce: string;
  now: Date;
}>): AuthorizationCallbackDecision {
  const { transaction } = input;
  if (transaction.consumedAt) return { kind: 'reject', reason: 'TRANSACTION_REPLAYED' };
  if (transaction.expiresAt <= input.now) return { kind: 'reject', reason: 'TRANSACTION_EXPIRED' };
  if (transaction.provider !== input.callbackProvider) return { kind: 'reject', reason: 'PROVIDER_MISMATCH' };
  if (transaction.browserBinding !== input.callbackBrowserBinding) return { kind: 'reject', reason: 'BROWSER_BINDING_MISMATCH' };
  if (transaction.state !== input.callbackState) return { kind: 'reject', reason: 'STATE_MISMATCH' };
  if (transaction.nonce !== input.verifiedTokenNonce) return { kind: 'reject', reason: 'NONCE_MISMATCH' };
  if (!transaction.pkceVerifierPresent) return { kind: 'reject', reason: 'PKCE_BINDING_MISSING' };
  return { kind: 'accept_and_consume' };
}
