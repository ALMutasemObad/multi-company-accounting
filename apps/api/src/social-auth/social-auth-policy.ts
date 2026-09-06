export type SocialProvider = 'GOOGLE' | 'APPLE';

export type ProviderIdentity = Readonly<{
  provider: SocialProvider;
  issuer: string;
  subject: string;
}>;

export type ProviderEmail = Readonly<{
  value: string;
  verified: boolean;
  privateRelay: boolean;
}>;

/**
 * Output of a trusted OIDC adapter after signature and protocol validation.
 * This policy deliberately never accepts or decodes a raw ID token.
 */
export type VerifiedProviderProfile = Readonly<{
  identity: ProviderIdentity;
  email: ProviderEmail | null;
  displayName: string | null;
}>;

export type ExistingIdentityLink =
  | Readonly<{ kind: 'not_linked' }>
  | Readonly<{ kind: 'linked'; userId: bigint; userActive: boolean }>;

export type ExistingEmailAccount =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'exists'; userId: bigint }>;

export type AccountLinkAuthorization =
  | Readonly<{ kind: 'not_requested' }>
  | Readonly<{
      kind: 'requested';
      authenticatedUserId: bigint;
      recentAuthenticationProved: boolean;
      explicitConsent: boolean;
    }>;

export type SocialAuthDecision =
  | Readonly<{ kind: 'sign_in'; userId: bigint }>
  | Readonly<{ kind: 'reject'; reason: 'USER_DISABLED' | 'IDENTITY_ALREADY_LINKED_TO_ANOTHER_USER' }>
  | Readonly<{ kind: 'require_recent_authentication' }>
  | Readonly<{ kind: 'require_link_consent' }>
  | Readonly<{ kind: 'link_to_authenticated_user'; userId: bigint; identity: ProviderIdentity }>
  | Readonly<{ kind: 'require_existing_account_proof' }>
  | Readonly<{ kind: 'continue_registration'; profile: VerifiedProviderProfile }>
  | Readonly<{ kind: 'require_verified_contact_email'; profile: VerifiedProviderProfile }>;

export function decideSocialAuthentication(input: Readonly<{
  profile: VerifiedProviderProfile;
  identityLink: ExistingIdentityLink;
  emailAccount: ExistingEmailAccount;
  linkAuthorization: AccountLinkAuthorization;
}>): SocialAuthDecision {
  if (input.identityLink.kind === 'linked') {
    if (!input.identityLink.userActive) return { kind: 'reject', reason: 'USER_DISABLED' };
    if (
      input.linkAuthorization.kind === 'requested'
      && input.linkAuthorization.authenticatedUserId !== input.identityLink.userId
    ) {
      return { kind: 'reject', reason: 'IDENTITY_ALREADY_LINKED_TO_ANOTHER_USER' };
    }
    return { kind: 'sign_in', userId: input.identityLink.userId };
  }

  if (input.linkAuthorization.kind === 'requested') {
    if (!input.linkAuthorization.recentAuthenticationProved) return { kind: 'require_recent_authentication' };
    if (!input.linkAuthorization.explicitConsent) return { kind: 'require_link_consent' };
    return {
      kind: 'link_to_authenticated_user',
      userId: input.linkAuthorization.authenticatedUserId,
      identity: input.profile.identity,
    };
  }

  // Email is profile/contact data. It never establishes ownership of an existing account.
  if (input.emailAccount.kind === 'exists') return { kind: 'require_existing_account_proof' };
  if (!input.profile.email?.verified) return { kind: 'require_verified_contact_email', profile: input.profile };
  return { kind: 'continue_registration', profile: input.profile };
}

