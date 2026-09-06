import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OidcProviderAdapter } from '../src/social-auth/oidc-provider-adapter.js';
import {
  decideAuthorizationCallback,
  decideSocialAuthentication,
  isApplePrivateRelayEmail,
  providerIdentityFromVerifiedClaims,
  type VerifiedProviderProfile,
} from '../src/social-auth/index.js';

const googleProfile: VerifiedProviderProfile = {
  identity: { provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: 'google-subject-7' },
  email: { value: 'owner@example.com', verified: true, privateRelay: false },
  displayName: 'مالك الحساب',
};

describe('social authentication account policy', () => {
  it('signs in by the stored issuer and subject link, not by email', () => {
    expect(decideSocialAuthentication({
      profile: { ...googleProfile, email: { ...googleProfile.email!, value: 'changed@example.com' } },
      identityLink: { kind: 'linked', userId: 7n, userActive: true },
      emailAccount: { kind: 'exists', userId: 99n },
      linkAuthorization: { kind: 'not_requested' },
    })).toEqual({ kind: 'sign_in', userId: 7n });
  });

  it('never merges an unlinked provider identity into an existing account by email', () => {
    expect(decideSocialAuthentication({
      profile: googleProfile,
      identityLink: { kind: 'not_linked' },
      emailAccount: { kind: 'exists', userId: 7n },
      linkAuthorization: { kind: 'not_requested' },
    })).toEqual({ kind: 'require_existing_account_proof' });
  });

  it('requires both recent authentication and explicit consent before linking', () => {
    const base = {
      profile: googleProfile,
      identityLink: { kind: 'not_linked' } as const,
      emailAccount: { kind: 'none' } as const,
    };
    expect(decideSocialAuthentication({ ...base, linkAuthorization: { kind: 'requested', authenticatedUserId: 7n, recentAuthenticationProved: false, explicitConsent: true } }))
      .toEqual({ kind: 'require_recent_authentication' });
    expect(decideSocialAuthentication({ ...base, linkAuthorization: { kind: 'requested', authenticatedUserId: 7n, recentAuthenticationProved: true, explicitConsent: false } }))
      .toEqual({ kind: 'require_link_consent' });
    expect(decideSocialAuthentication({ ...base, linkAuthorization: { kind: 'requested', authenticatedUserId: 7n, recentAuthenticationProved: true, explicitConsent: true } }))
      .toEqual({ kind: 'link_to_authenticated_user', userId: 7n, identity: googleProfile.identity });
  });

  it('rejects linking an identity already owned by another user', () => {
    expect(decideSocialAuthentication({
      profile: googleProfile,
      identityLink: { kind: 'linked', userId: 8n, userActive: true },
      emailAccount: { kind: 'none' },
      linkAuthorization: { kind: 'requested', authenticatedUserId: 7n, recentAuthenticationProved: true, explicitConsent: true },
    })).toEqual({ kind: 'reject', reason: 'IDENTITY_ALREADY_LINKED_TO_ANOTHER_USER' });
  });

  it('does not provision without a verified contact email', () => {
    expect(decideSocialAuthentication({
      profile: { ...googleProfile, email: null },
      identityLink: { kind: 'not_linked' },
      emailAccount: { kind: 'none' },
      linkAuthorization: { kind: 'not_requested' },
    }).kind).toBe('require_verified_contact_email');
  });
});

describe('provider and authorization transaction policy', () => {
  it('cryptographically verifies a local OIDC issuer simulation through openid-client', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    let expectedNonce = '';
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/jwks') { response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] })); return; }
      if (request.url === '/token') {
        const now = Math.floor(Date.now() / 1000);
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const unsigned = `${encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${encode({ iss: 'https://accounts.google.com', sub: 'crypto-subject', aud: 'test-client', iat: now, exp: now + 300, nonce: expectedNonce, email: 'relay@example.test', email_verified: true })}`;
        const idToken = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
        response.end(JSON.stringify({ access_token: 'not-stored', token_type: 'Bearer', expires_in: 300, id_token: idToken })); return;
      }
      response.statusCode = 404; response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('test server unavailable');
      const base = `http://127.0.0.1:${address.port}`;
      const adapter = new OidcProviderAdapter({ provider: 'GOOGLE', clientId: 'test-client', clientSecret: 'test-secret', redirectUri: `${base}/callback`, authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token`, jwksUri: `${base}/jwks`, allowInsecureForTests: true });
      expectedNonce = 'nonce-from-server-transaction';
      const verified = await adapter.exchange({ callback: new URL(`${base}/callback?code=code-1&state=state-1`), state: 'state-1', nonce: expectedNonce, codeVerifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~' });
      expect(verified.identity).toEqual({ provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: 'crypto-subject' });
      expect(verified.email?.verified).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
  it('canonicalizes the documented legacy Google issuer but rejects foreign issuers', () => {
    expect(providerIdentityFromVerifiedClaims({ provider: 'GOOGLE', issuer: 'accounts.google.com', subject: 'abc' }))
      .toEqual({ kind: 'accepted', identity: { provider: 'GOOGLE', issuer: 'https://accounts.google.com', subject: 'abc' } });
    expect(providerIdentityFromVerifiedClaims({ provider: 'GOOGLE', issuer: 'https://attacker.example', subject: 'abc' }))
      .toEqual({ kind: 'rejected', reason: 'ISSUER_MISMATCH' });
  });

  it('recognizes Apple private relay addresses without treating them as identity', () => {
    expect(isApplePrivateRelayEmail('Alias@privaterelay.appleid.com')).toBe(true);
    expect(isApplePrivateRelayEmail('owner@example.com')).toBe(false);
  });

  it('requires a live, unused state/nonce/PKCE-bound transaction', () => {
    const transaction = {
      provider: 'APPLE' as const,
      browserBinding: 'browser-session-1',
      state: 'state-1',
      nonce: 'nonce-1',
      pkceVerifierPresent: true,
      expiresAt: new Date('2026-09-06T12:10:00Z'),
      consumedAt: null,
    };
    expect(decideAuthorizationCallback({ transaction, callbackProvider: 'APPLE', callbackBrowserBinding: 'browser-session-1', callbackState: 'state-1', verifiedTokenNonce: 'nonce-1', now: new Date('2026-09-06T12:00:00Z') }))
      .toEqual({ kind: 'accept_and_consume' });
    expect(decideAuthorizationCallback({ transaction, callbackProvider: 'APPLE', callbackBrowserBinding: 'browser-session-1', callbackState: 'wrong', verifiedTokenNonce: 'nonce-1', now: new Date('2026-09-06T12:00:00Z') }))
      .toEqual({ kind: 'reject', reason: 'STATE_MISMATCH' });
    expect(decideAuthorizationCallback({ transaction, callbackProvider: 'APPLE', callbackBrowserBinding: 'attacker-session', callbackState: 'state-1', verifiedTokenNonce: 'nonce-1', now: new Date('2026-09-06T12:00:00Z') }))
      .toEqual({ kind: 'reject', reason: 'BROWSER_BINDING_MISMATCH' });
    expect(decideAuthorizationCallback({ transaction: { ...transaction, consumedAt: new Date('2026-09-06T12:00:01Z') }, callbackProvider: 'APPLE', callbackBrowserBinding: 'browser-session-1', callbackState: 'state-1', verifiedTokenNonce: 'nonce-1', now: new Date('2026-09-06T12:00:02Z') }))
      .toEqual({ kind: 'reject', reason: 'TRANSACTION_REPLAYED' });
  });
});
