import * as oidc from 'openid-client';
import type { SocialProvider, VerifiedProviderProfile } from './social-auth-policy.js';
import { isApplePrivateRelayEmail, providerIdentityFromVerifiedClaims, SOCIAL_PROVIDER_POLICY } from './provider-policy.js';

export type OidcProviderSettings = Readonly<{
  provider: SocialProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  allowInsecureForTests?: boolean;
}>;

export interface SocialOidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string;
  exchange(input: { callback: URL | Request; state: string; nonce: string; codeVerifier: string; appleUser?: string | undefined }): Promise<VerifiedProviderProfile>;
}

export class OidcProviderAdapter implements SocialOidcProvider {
  private readonly configuration: oidc.Configuration;

  constructor(readonly settings: OidcProviderSettings) {
    const issuer = SOCIAL_PROVIDER_POLICY[settings.provider].canonicalIssuer;
    this.configuration = new oidc.Configuration({
      issuer,
      authorization_endpoint: settings.authorizationEndpoint,
      token_endpoint: settings.tokenEndpoint,
      jwks_uri: settings.jwksUri,
      id_token_signing_alg_values_supported: ['RS256'],
    }, settings.clientId, { client_secret: settings.clientSecret }, oidc.ClientSecretPost(settings.clientSecret));
    if (settings.allowInsecureForTests) oidc.allowInsecureRequests(this.configuration);
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }) {
    return oidc.buildAuthorizationUrl(this.configuration, {
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: 'code',
      response_mode: this.settings.provider === 'APPLE' ? 'form_post' : 'query',
      scope: 'openid email profile',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).href;
  }

  async exchange(input: { callback: URL | Request; state: string; nonce: string; codeVerifier: string; appleUser?: string | undefined }): Promise<VerifiedProviderProfile> {
    let callback: URL | Request;
    if (input.callback instanceof URL) {
      callback = new URL(this.settings.redirectUri);
      callback.search = input.callback.search;
    } else {
      callback = new Request(this.settings.redirectUri, { method: input.callback.method, headers: input.callback.headers, body: await input.callback.text() });
    }
    const tokens = await oidc.authorizationCodeGrant(this.configuration, callback, {
      expectedState: input.state,
      expectedNonce: input.nonce,
      pkceCodeVerifier: input.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('OIDC_ID_TOKEN_REQUIRED');
    const identity = providerIdentityFromVerifiedClaims({
      provider: this.settings.provider,
      issuer: String(claims.iss),
      subject: String(claims.sub),
    });
    if (identity.kind === 'rejected') throw new Error(identity.reason);
    const email = typeof claims.email === 'string' ? claims.email.trim().toLocaleLowerCase('en-US') : null;
    let appleName: string | null = null;
    if (this.settings.provider === 'APPLE' && input.appleUser) {
      try {
        const parsed = JSON.parse(input.appleUser) as { name?: { firstName?: string; lastName?: string } };
        appleName = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(' ').trim() || null;
      } catch { /* malformed optional profile data does not affect verified identity */ }
    }
    return {
      identity: identity.identity,
      email: email ? { value: email, verified: claims.email_verified === true || claims.email_verified === 'true', privateRelay: isApplePrivateRelayEmail(email) } : null,
      displayName: appleName ?? (typeof claims.name === 'string' ? claims.name.slice(0, 160) : null),
    };
  }
}

export { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from 'openid-client';
