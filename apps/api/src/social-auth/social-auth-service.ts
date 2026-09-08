import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient, type SocialAuthorizationPurpose } from '@prisma/client';
import { createOpaqueToken, hashToken, tokenMatches } from '../auth/session-tokens.js';
import type { ClientMetadata } from '../auth/auth-store.js';
import { CompanyProvisioningError, type CompanyProvisioningPort } from '../platform/company-provisioning-ports.js';
import type { SecurityEventAppendPort } from '../platform/security-event-append-port.js';
import { TransactionExecutor } from '../platform/transaction-executor.js';
import type { RegistrationOwnerPorts } from '../registration/registration-owner-ports.js';
import { emailTemplateLocales, normalizeSupportedLocale, type SupportedLocale } from '../registration/supported-locales.js';
import { PrismaSecurityEventAppendAdapter } from '../security/prisma-security-event-append-adapter.js';
import { decideSocialAuthentication, type SocialProvider, type VerifiedProviderProfile } from './social-auth-policy.js';
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState, type SocialOidcProvider } from './oidc-provider-adapter.js';

export class SocialAuthError extends Error {
  constructor(public readonly code:
    | 'PROVIDER_DISABLED'
    | 'INVALID_REQUEST'
    | 'TRANSACTION_INVALID'
    | 'AUTHENTICATION_REQUIRED'
    | 'RECENT_AUTHENTICATION_REQUIRED'
    | 'IDENTITY_CONFLICT'
    | 'IDENTITY_NOT_LINKED'
    | 'LAST_SIGN_IN_METHOD'
    | 'ONBOARDING_INVALID'
    | 'ACCOUNT_PROOF_REQUIRED'
    | 'PROVISIONING_FAILED') {
    super(code);
    this.name = 'SocialAuthError';
  }
}

export type SocialOnboardingInput = {
  displayName: string;
  organizationName: string;
  companyName: string;
  timezone: string;
  baseCurrencyCode: string;
  locale: SupportedLocale;
  chartTemplateCode: string;
  consent: boolean;
};

type SocialOnboardingDependencies = {
  continuationTtlMinutes: number;
  provisioning: CompanyProvisioningPort;
  owners: RegistrationOwnerPorts;
};

type ServiceOptions = {
  transactionSecret: string;
  transactionTtlMinutes: number;
  sessionTtlHours: number;
  providers: Partial<Record<SocialProvider, SocialOidcProvider>>;
  onboarding?: SocialOnboardingDependencies;
};

const digest = (value: string) => createHash('sha256').update(value).digest();
const buffersEqual = (left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(Buffer.from(right));

export class SocialAuthService {
  private readonly transactions: TransactionExecutor;
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: ServiceOptions,
    private readonly security: SecurityEventAppendPort = new PrismaSecurityEventAppendAdapter(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.encryptionKey = digest(options.transactionSecret);
  }

  capabilities() {
    return { google: Boolean(this.options.providers.GOOGLE), apple: Boolean(this.options.providers.APPLE) };
  }

  async accounts(input: { sid?: string }) {
    const session = await this.authenticatedSession(input.sid);
    const identities = await this.prisma.externalIdentity.findMany({
      where: { userId: session.userId! },
      select: { provider: true, createdAt: true },
    });
    const byProvider = new Map(identities.map((identity) => [identity.provider, identity.createdAt]));
    const data = (['GOOGLE', 'APPLE'] as const)
      .filter((provider) => Boolean(this.options.providers[provider]))
      .map((provider) => ({
        provider,
        status: byProvider.has(provider) ? 'LINKED' as const : 'NOT_LINKED' as const,
        linkedAt: byProvider.get(provider) ?? null,
      }));
    return {
      data,
      recentAuthenticationRequired: !session.authenticatedAt
        || this.now().getTime() - session.authenticatedAt.getTime() > 10 * 60_000,
    };
  }

  async unlink(input: {
    provider: SocialProvider;
    sid?: string;
    csrfToken?: string;
    consent: boolean;
    metadata?: ClientMetadata;
  }) {
    if (!this.options.providers[input.provider]) throw new SocialAuthError('PROVIDER_DISABLED');
    if (!input.consent) throw new SocialAuthError('INVALID_REQUEST');
    const session = await this.authenticatedSession(input.sid, input.csrfToken);
    if (!session.authenticatedAt || this.now().getTime() - session.authenticatedAt.getTime() > 10 * 60_000) {
      throw new SocialAuthError('RECENT_AUTHENTICATION_REQUIRED');
    }
    const now = this.now();
    return this.transactions.execute({
      operation: 'SOCIAL_IDENTITY_UNLINK',
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWaitMs: 2_000,
      timeoutMs: 8_000,
      deadlineMs: 15_000,
    }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${session.userId!} FOR UPDATE`;
      const currentSession = await tx.session.findUnique({ where: { id: session.id } });
      if (!currentSession || currentSession.revokedAt || currentSession.expiresAt <= now
        || currentSession.state !== 'AUTHENTICATED' || currentSession.userId !== session.userId
        || !tokenMatches(input.csrfToken!, currentSession.csrfHash)) {
        throw new SocialAuthError('AUTHENTICATION_REQUIRED');
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: session.userId! },
        select: {
          passwordHash: true,
          emailNormalized: true,
          externalIdentities: { select: { id: true, provider: true } },
          assignments: {
            where: { isActive: true, company: { isActive: true } },
            select: { companyId: true },
          },
        },
      });
      const identity = user.externalIdentities.find((entry) => entry.provider === input.provider);
      if (!identity) throw new SocialAuthError('IDENTITY_NOT_LINKED');
      if (!user.passwordHash && user.externalIdentities.length <= 1) {
        throw new SocialAuthError('LAST_SIGN_IN_METHOD');
      }
      // SecurityEvent is company-scoped. Do not perform an unaudited unlink for
      // a detached/platform-only identity until that schema has a global scope.
      if (!user.assignments.length) throw new SocialAuthError('INVALID_REQUEST');
      const removed = await tx.externalIdentity.deleteMany({
        where: { id: identity.id, userId: session.userId!, provider: input.provider },
      });
      if (removed.count !== 1) throw new SocialAuthError('IDENTITY_NOT_LINKED');
      await this.security.appendMany(tx, user.assignments.map(({ companyId }) => ({
        companyId,
        userId: session.userId!,
        sessionId: currentSession.id,
        eventType: 'SOCIAL_IDENTITY_UNLINKED',
        severity: 'WARNING',
        emailSnapshot: user.emailNormalized,
        ipAddress: input.metadata?.ipAddress ?? null,
        userAgent: input.metadata?.userAgent ?? null,
        details: { provider: input.provider },
      })));
    });
  }

  async callbackReturnPath(input: { provider: SocialProvider; state?: string; browserBinding?: string }) {
    if (!input.state || !input.browserBinding) return '/login';
    const record = await this.prisma.socialAuthorizationTransaction.findUnique({
      where: { stateHash: digest(input.state) },
      select: { provider: true, browserBindingHash: true, returnPath: true },
    });
    return record && record.provider === input.provider
      && buffersEqual(record.browserBindingHash, digest(input.browserBinding))
      ? this.safeReturnPath(record.returnPath)
      : '/login';
  }

  async cancelAuthorization(input: { provider: SocialProvider; state?: string; browserBinding?: string }) {
    if (!input.state || !input.browserBinding) return '/login';
    const now = this.now();
    const record = await this.prisma.socialAuthorizationTransaction.findUnique({
      where: { stateHash: digest(input.state) },
      select: { id: true, provider: true, browserBindingHash: true, returnPath: true, usedAt: true, expiresAt: true },
    });
    if (!record || record.provider !== input.provider || record.usedAt || record.expiresAt <= now
      || !buffersEqual(record.browserBindingHash, digest(input.browserBinding))) return '/login';
    const consumed = await this.prisma.socialAuthorizationTransaction.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return consumed.count === 1 ? this.safeReturnPath(record.returnPath) : '/login';
  }

  async start(input: { provider: SocialProvider; purpose: SocialAuthorizationPurpose; sid?: string; csrfToken?: string; consent: boolean; returnPath?: string; browserBinding?: string }) {
    const provider = this.options.providers[input.provider];
    if (!provider) throw new SocialAuthError('PROVIDER_DISABLED');
    if (!input.sid || !input.csrfToken) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(input.sid) } });
    if (!session || session.revokedAt || session.expiresAt <= this.now() || !tokenMatches(input.csrfToken, session.csrfHash)) {
      throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    }
    if (input.purpose === 'SIGN_IN' && session.state !== 'PRE_AUTH') throw new SocialAuthError('INVALID_REQUEST');
    if (input.purpose === 'LINK') {
      if (session.state !== 'AUTHENTICATED' || !session.userId) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
      if (!session.authenticatedAt || this.now().getTime() - session.authenticatedAt.getTime() > 10 * 60_000) {
        throw new SocialAuthError('RECENT_AUTHENTICATION_REQUIRED');
      }
      if (!input.consent) throw new SocialAuthError('INVALID_REQUEST');
    }
    await this.cleanupExpired();
    const state = randomState();
    const nonce = randomNonce();
    const verifier = randomPKCECodeVerifier();
    const browserBinding = input.browserBinding ?? createOpaqueToken();
    const challenge = await calculatePKCECodeChallenge(verifier);
    const expiresAt = new Date(this.now().getTime() + this.options.transactionTtlMinutes * 60_000);
    await this.prisma.socialAuthorizationTransaction.create({ data: {
      provider: input.provider,
      purpose: input.purpose,
      initiatingSessionId: session.id,
      initiatingUserId: input.purpose === 'LINK' ? session.userId : null,
      stateHash: digest(state),
      nonceHash: digest(nonce),
      protectedNonce: this.protect(nonce),
      browserBindingHash: digest(browserBinding),
      protectedPkceVerifier: this.protect(verifier),
      returnPath: this.safeReturnPath(input.returnPath),
      consentedAt: input.purpose === 'LINK' ? this.now() : null,
      expiresAt,
    } });
    return { authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge: challenge }), browserBinding, expiresAt };
  }

  async callback(input: { provider: SocialProvider; state: string; browserBinding?: string; callback: URL | Request; appleUser?: string; metadata?: ClientMetadata }) {
    const provider = this.options.providers[input.provider];
    if (!provider || !input.browserBinding || !input.state) throw new SocialAuthError('TRANSACTION_INVALID');
    const record = await this.prisma.socialAuthorizationTransaction.findUnique({ where: { stateHash: digest(input.state) } });
    if (!record || record.provider !== input.provider || record.usedAt || record.expiresAt <= this.now()
      || !buffersEqual(record.browserBindingHash, digest(input.browserBinding))) {
      throw new SocialAuthError('TRANSACTION_INVALID');
    }
    const verifier = this.unprotect(Buffer.from(record.protectedPkceVerifier));
    const nonce = this.unprotect(Buffer.from(record.protectedNonce));
    if (!buffersEqual(digest(nonce), record.nonceHash)) throw new SocialAuthError('TRANSACTION_INVALID');
    const profile = await provider.exchange({ callback: input.callback, state: input.state, nonce, codeVerifier: verifier, appleUser: input.appleUser });
    return this.finish(record.id, profile, input.browserBinding, input.metadata);
  }

  async onboardingOptions(input: { sid?: string; continuation?: string; browserBinding?: string }) {
    this.requireOnboarding();
    await this.validContinuation(input);
    const owners = this.options.onboarding!.owners;
    return {
      currencies: await owners.tenant.listGlobalCurrencies(),
      locales: emailTemplateLocales,
      timezones: [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])],
      chartTemplates: owners.accounting.listChartTemplates(),
    };
  }

  async completeOnboarding(input: {
    sid?: string;
    csrfToken?: string;
    continuation?: string;
    browserBinding?: string;
    form: SocialOnboardingInput;
    metadata?: ClientMetadata;
  }) {
    const onboarding = this.requireOnboarding();
    const form = this.normalizeOnboardingInput(input.form);
    const tokenHash = input.continuation ? hashToken(input.continuation) : null;
    if (!tokenHash || !input.sid || !input.csrfToken || !input.browserBinding) {
      throw new SocialAuthError('ONBOARDING_INVALID');
    }
    const now = this.now();
    try {
      const outcome = await this.transactions.execute({
        operation: 'SOCIAL_ONBOARDING',
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWaitMs: 10_000,
        timeoutMs: 45_000,
        deadlineMs: 60_000,
      }, async (tx) => {
        const continuation = await tx.socialOnboardingContinuation.findUnique({
          where: { tokenHash },
          include: { initiatingSession: true, authorizationTransaction: true },
        });
        if (!continuation || continuation.usedAt || continuation.expiresAt <= now
          || continuation.authorizationTransaction.purpose !== 'SIGN_IN'
          || !continuation.authorizationTransaction.usedAt
          || continuation.initiatingSession.state !== 'PRE_AUTH'
          || continuation.initiatingSession.revokedAt
          || continuation.initiatingSession.expiresAt <= now
          || !buffersEqual(continuation.initiatingSession.tokenHash, hashToken(input.sid!))
          || !tokenMatches(input.csrfToken!, continuation.initiatingSession.csrfHash)
          || !buffersEqual(continuation.browserBindingHash, digest(input.browserBinding!))) {
          throw new SocialAuthError('ONBOARDING_INVALID');
        }
        const consumed = await tx.socialOnboardingContinuation.updateMany({
          where: { id: continuation.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) throw new SocialAuthError('ONBOARDING_INVALID');

        const profile = this.readProtectedProfile(continuation.protectedProfile);
        if (profile.identity.provider !== continuation.authorizationTransaction.provider) {
          throw new SocialAuthError('ONBOARDING_INVALID');
        }
        const emailNormalized = profile.email!.value.trim().toLocaleLowerCase('en-US');
        const [linkedIdentity, emailAccount, validCurrency] = await Promise.all([
          tx.externalIdentity.findUnique({
            where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } },
            select: { id: true },
          }),
          tx.user.findUnique({ where: { emailNormalized }, select: { id: true } }),
          onboarding.owners.tenant.isActiveGlobalCurrency(tx, form.baseCurrencyCode),
        ]);
        if (linkedIdentity || emailAccount) return { kind: 'account_proof_required' as const };
        if (!validCurrency || !onboarding.owners.accounting.isSupportedChartTemplate(form.chartTemplateCode)) {
          throw new SocialAuthError('INVALID_REQUEST');
        }

        const provisioned = await onboarding.provisioning.provisionPreparedInTransaction(tx, {
          organizationCode: `SOCIAL_${continuation.publicId.replaceAll('-', '').toUpperCase()}`,
          organizationName: form.organizationName,
          companyCode: 'MAIN',
          companyName: form.companyName,
          timezone: form.timezone,
          baseCurrencyCode: form.baseCurrencyCode,
          adminEmail: emailNormalized,
          adminDisplayName: form.displayName,
        }, null, {
          requireNewAdminIdentity: true,
          externalIdentity: {
            provider: profile.identity.provider,
            issuer: profile.identity.issuer,
            subject: profile.identity.subject,
            emailSnapshot: emailNormalized,
            privateRelay: profile.email!.privateRelay,
          },
        });

        const userId = BigInt(provisioned.administrator.id);
        const companyId = BigInt(provisioned.company.id);
        const sid = createOpaqueToken();
        const csrfToken = createOpaqueToken();
        const expiresAt = new Date(now.getTime() + this.options.sessionTtlHours * 3_600_000);
        await tx.session.update({ where: { id: continuation.initiatingSessionId }, data: { revokedAt: now } });
        const session = await tx.session.create({ data: {
          state: 'AUTHENTICATED',
          userId,
          selectedCompanyId: companyId,
          tokenHash: hashToken(sid),
          csrfHash: hashToken(csrfToken),
          authenticatedAt: now,
          expiresAt,
        } });
        await tx.socialOnboardingContinuation.update({
          where: { id: continuation.id },
          data: { completedUserId: userId },
        });
        await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
        await this.security.append(tx, {
          companyId,
          userId,
          sessionId: session.id,
          eventType: 'SOCIAL_REGISTRATION_COMPLETED',
          severity: 'INFO',
          emailSnapshot: emailNormalized,
          ipAddress: input.metadata?.ipAddress ?? null,
          userAgent: input.metadata?.userAgent ?? null,
          details: { provider: profile.identity.provider, onboardingPublicId: continuation.publicId },
        });
        return {
          kind: 'completed' as const,
          sid,
          csrfToken,
          expiresAt,
          user: { id: userId.toString(), displayName: form.displayName },
          companyId: companyId.toString(),
        };
      });
      if (outcome.kind === 'account_proof_required') throw new SocialAuthError('ACCOUNT_PROOF_REQUIRED');
      return outcome;
    } catch (error) {
      if (error instanceof SocialAuthError) throw error;
      const conflict = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        || (error instanceof CompanyProvisioningError
          && ['ADMIN_USER_EXISTS', 'EXTERNAL_IDENTITY_EXISTS'].includes(error.reason));
      if (conflict) {
        await this.burnContinuation(tokenHash);
        throw new SocialAuthError('ACCOUNT_PROOF_REQUIRED');
      }
      throw new SocialAuthError('PROVISIONING_FAILED');
    }
  }

  async cancelOnboarding(input: { sid?: string; csrfToken?: string; continuation?: string; browserBinding?: string }) {
    const continuation = await this.validContinuation(input);
    if (!input.csrfToken || !tokenMatches(input.csrfToken, continuation.initiatingSession.csrfHash)) {
      throw new SocialAuthError('ONBOARDING_INVALID');
    }
    const cancelled = await this.prisma.socialOnboardingContinuation.updateMany({
      where: { id: continuation.id, usedAt: null, expiresAt: { gt: this.now() } },
      data: { usedAt: this.now() },
    });
    if (cancelled.count !== 1) throw new SocialAuthError('ONBOARDING_INVALID');
  }

  private async finish(
    transactionId: bigint,
    profile: Awaited<ReturnType<SocialOidcProvider['exchange']>>,
    browserBinding: string,
    metadata?: ClientMetadata,
  ) {
    const sid = createOpaqueToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlHours * 3_600_000);
    return this.transactions.execute({ operation: 'social-auth-callback', maxAttempts: 3 }, async (tx) => {
      const record = await tx.socialAuthorizationTransaction.findUniqueOrThrow({
        where: { id: transactionId },
        include: { initiatingSession: true },
      });
      const consumed = await tx.socialAuthorizationTransaction.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1 || record.initiatingSession.revokedAt || record.initiatingSession.expiresAt <= now) {
        throw new SocialAuthError('TRANSACTION_INVALID');
      }
      const linked = await tx.externalIdentity.findUnique({
        where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } },
        include: { user: { select: { id: true, isActive: true, emailNormalized: true } } },
      });
      const profileEmailNormalized = profile.email?.value.trim().toLocaleLowerCase('en-US');
      const emailAccount = profileEmailNormalized
        ? await tx.user.findUnique({ where: { emailNormalized: profileEmailNormalized }, select: { id: true } })
        : null;
      const decision = decideSocialAuthentication({
        profile,
        identityLink: linked
          ? { kind: 'linked', userId: linked.user.id, userActive: linked.user.isActive }
          : { kind: 'not_linked' },
        emailAccount: emailAccount ? { kind: 'exists', userId: emailAccount.id } : { kind: 'none' },
        linkAuthorization: record.purpose === 'LINK' && record.initiatingUserId ? {
          kind: 'requested',
          authenticatedUserId: record.initiatingUserId,
          recentAuthenticationProved: Boolean(
            record.initiatingSession.authenticatedAt
            && now.getTime() - record.initiatingSession.authenticatedAt.getTime() <= 10 * 60_000,
          ),
          explicitConsent: Boolean(record.consentedAt),
        } : { kind: 'not_requested' },
      });
      if (decision.kind === 'continue_registration') {
        const onboarding = this.requireOnboarding();
        const continuationToken = createOpaqueToken();
        const continuationExpiresAt = new Date(Math.min(
          record.initiatingSession.expiresAt.getTime(),
          now.getTime() + onboarding.continuationTtlMinutes * 60_000,
        ));
        await tx.socialOnboardingContinuation.updateMany({
          where: { initiatingSessionId: record.initiatingSessionId, usedAt: null },
          data: { usedAt: now },
        });
        await tx.socialOnboardingContinuation.create({ data: {
          tokenHash: hashToken(continuationToken),
          authorizationTransactionId: record.id,
          initiatingSessionId: record.initiatingSessionId,
          protectedProfile: this.protect(JSON.stringify(profile)),
          browserBindingHash: digest(browserBinding),
          expiresAt: continuationExpiresAt,
        } });
        return {
          kind: 'onboarding_required' as const,
          continuation: continuationToken,
          browserBinding,
          expiresAt: continuationExpiresAt,
          returnPath: record.returnPath,
        };
      }
      if (decision.kind === 'require_verified_contact_email') {
        return { kind: 'contact_verification_required' as const, returnPath: record.returnPath };
      }
      if (decision.kind === 'require_existing_account_proof') {
        return { kind: 'account_proof_required' as const, returnPath: record.returnPath };
      }
      if (decision.kind === 'require_recent_authentication') throw new SocialAuthError('RECENT_AUTHENTICATION_REQUIRED');
      if (decision.kind === 'require_link_consent') throw new SocialAuthError('INVALID_REQUEST');
      if (decision.kind === 'reject') throw new SocialAuthError('IDENTITY_CONFLICT');

      const userId = decision.userId;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          emailNormalized: true,
          assignments: {
            where: { isActive: true, company: { isActive: true } },
            select: { companyId: true },
          },
        },
      });
      // SecurityEvent is currently company-scoped. Match unlink's fail-closed
      // behavior: never create an unaudited account link for a detached or
      // platform-only identity until a global security-event scope exists.
      if (decision.kind === 'link_to_authenticated_user' && !user.assignments.length) {
        throw new SocialAuthError('INVALID_REQUEST');
      }
      if (decision.kind === 'link_to_authenticated_user') {
        await tx.externalIdentity.create({ data: {
          userId,
          provider: profile.identity.provider,
          issuer: profile.identity.issuer,
          subject: profile.identity.subject,
          emailSnapshot: profileEmailNormalized ?? null,
          privateRelay: profile.email?.privateRelay ?? false,
        } });
      }
      await tx.session.update({ where: { id: record.initiatingSessionId }, data: { revokedAt: now } });
      const session = await tx.session.create({ data: {
        state: 'AUTHENTICATED',
        userId,
        selectedCompanyId: record.purpose === 'LINK' ? record.initiatingSession.selectedCompanyId : null,
        tokenHash: hashToken(sid),
        // The opaque SID is rotated. Keeping the already browser-held CSRF
        // proof avoids putting a new secret in an OAuth redirect or URL.
        csrfHash: record.initiatingSession.csrfHash,
        authenticatedAt: now,
        expiresAt,
      } });
      await tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: now, failedLoginAttempts: 0, lockedUntil: null },
      });
      if (user.assignments.length) {
        await this.security.appendMany(tx, user.assignments.map(({ companyId }) => ({
          companyId,
          userId,
          sessionId: session.id,
          eventType: decision.kind === 'sign_in' ? 'SOCIAL_LOGIN_SUCCEEDED' : 'SOCIAL_IDENTITY_LINKED',
          severity: 'INFO',
          emailSnapshot: user.emailNormalized,
          ipAddress: metadata?.ipAddress ?? null,
          userAgent: metadata?.userAgent ?? null,
          details: { provider: profile.identity.provider },
        })));
      }
      return {
        kind: decision.kind === 'sign_in' ? 'signed_in' as const : 'linked' as const,
        sid,
        expiresAt,
        returnPath: record.returnPath,
      };
    });
  }

  async cleanupExpired(retainDays = 7) {
    const cutoff = new Date(this.now().getTime() - retainDays * 86_400_000);
    await this.prisma.socialOnboardingContinuation.deleteMany({
      where: { OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    return this.prisma.socialAuthorizationTransaction.deleteMany({
      where: {
        onboardingContinuation: { is: null },
        OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
  }

  private requireOnboarding() {
    if (!this.options.onboarding) throw new SocialAuthError('ONBOARDING_INVALID');
    return this.options.onboarding;
  }

  private async authenticatedSession(sid?: string, csrfToken?: string) {
    if (!sid) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(sid) } });
    if (!session || session.state !== 'AUTHENTICATED' || !session.userId
      || session.revokedAt || session.expiresAt <= this.now()
      || (csrfToken !== undefined && !tokenMatches(csrfToken, session.csrfHash))) {
      throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    }
    return session;
  }

  private async validContinuation(input: { sid?: string; continuation?: string; browserBinding?: string }) {
    if (!input.sid || !input.continuation || !input.browserBinding) {
      throw new SocialAuthError('ONBOARDING_INVALID');
    }
    const continuation = await this.prisma.socialOnboardingContinuation.findUnique({
      where: { tokenHash: hashToken(input.continuation) },
      include: { initiatingSession: true },
    });
    const now = this.now();
    if (!continuation || continuation.usedAt || continuation.expiresAt <= now
      || continuation.initiatingSession.state !== 'PRE_AUTH'
      || continuation.initiatingSession.revokedAt
      || continuation.initiatingSession.expiresAt <= now
      || !buffersEqual(continuation.initiatingSession.tokenHash, hashToken(input.sid))
      || !buffersEqual(continuation.browserBindingHash, digest(input.browserBinding))) {
      throw new SocialAuthError('ONBOARDING_INVALID');
    }
    return continuation;
  }

  private normalizeOnboardingInput(input: SocialOnboardingInput): SocialOnboardingInput {
    const locale = normalizeSupportedLocale(input.locale);
    const normalized = {
      ...input,
      displayName: input.displayName.trim(),
      organizationName: input.organizationName.trim(),
      companyName: input.companyName.trim(),
      timezone: input.timezone.trim(),
      baseCurrencyCode: input.baseCurrencyCode.trim().toUpperCase(),
      chartTemplateCode: input.chartTemplateCode.trim(),
      locale: locale ?? input.locale,
    };
    let timezoneValid = true;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized.timezone }).format();
    } catch {
      timezoneValid = false;
    }
    if (!normalized.consent
      || normalized.displayName.length < 1 || normalized.displayName.length > 160
      || normalized.organizationName.length < 1 || normalized.organizationName.length > 200
      || normalized.companyName.length < 1 || normalized.companyName.length > 200
      || !timezoneValid
      || !/^[A-Z]{3}$/u.test(normalized.baseCurrencyCode)
      || normalized.chartTemplateCode.length < 1 || normalized.chartTemplateCode.length > 80
      || !locale) {
      throw new SocialAuthError('INVALID_REQUEST');
    }
    return normalized;
  }

  private readProtectedProfile(value: Uint8Array): VerifiedProviderProfile {
    try {
      const parsed = JSON.parse(this.unprotect(Buffer.from(value))) as VerifiedProviderProfile;
      if (!['GOOGLE', 'APPLE'].includes(parsed.identity?.provider)
        || !parsed.identity?.issuer || parsed.identity.issuer.length > 255
        || !parsed.identity?.subject || parsed.identity.subject.length > 255
        || !parsed.email?.verified || !parsed.email.value || parsed.email.value.length > 320) {
        throw new Error('invalid protected profile');
      }
      return parsed;
    } catch {
      throw new SocialAuthError('ONBOARDING_INVALID');
    }
  }

  private async burnContinuation(tokenHash: Uint8Array<ArrayBuffer>) {
    await this.prisma.socialOnboardingContinuation.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: this.now() },
    });
  }

  private safeReturnPath(value?: string) {
    return value && /^\/(?!\/)[A-Za-z0-9/_?=&.-]{0,254}$/u.test(value) ? value : '/';
  }

  private protect(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  private unprotect(value: Buffer) {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  }
}
