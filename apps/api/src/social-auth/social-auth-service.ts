import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient, type SocialAuthorizationPurpose } from '@prisma/client';
import { createOpaqueToken, hashToken, tokenMatches } from '../auth/session-tokens.js';
import type { ClientMetadata } from '../auth/auth-store.js';
import type { SecurityEventAppendPort } from '../platform/security-event-append-port.js';
import { TransactionExecutor } from '../platform/transaction-executor.js';
import { PrismaSecurityEventAppendAdapter } from '../security/prisma-security-event-append-adapter.js';
import { decideSocialAuthentication, type SocialProvider } from './social-auth-policy.js';
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState, type SocialOidcProvider } from './oidc-provider-adapter.js';

export class SocialAuthError extends Error {
  constructor(public readonly code: 'PROVIDER_DISABLED' | 'INVALID_REQUEST' | 'TRANSACTION_INVALID' | 'AUTHENTICATION_REQUIRED' | 'RECENT_AUTHENTICATION_REQUIRED' | 'IDENTITY_CONFLICT') { super(code); this.name = 'SocialAuthError'; }
}

type ServiceOptions = { transactionSecret: string; transactionTtlMinutes: number; sessionTtlHours: number; providers: Partial<Record<SocialProvider, SocialOidcProvider>> };
const digest = (value: string) => createHash('sha256').update(value).digest();

export class SocialAuthService {
  private readonly transactions: TransactionExecutor;
  private readonly encryptionKey: Buffer;
  constructor(private readonly prisma: PrismaClient, private readonly options: ServiceOptions, private readonly security: SecurityEventAppendPort = new PrismaSecurityEventAppendAdapter(), private readonly now: () => Date = () => new Date()) {
    this.transactions = new TransactionExecutor(prisma);
    this.encryptionKey = digest(options.transactionSecret);
  }

  capabilities() { return { google: Boolean(this.options.providers.GOOGLE), apple: Boolean(this.options.providers.APPLE) }; }

  async start(input: { provider: SocialProvider; purpose: SocialAuthorizationPurpose; sid?: string; csrfToken?: string; consent: boolean; returnPath?: string; browserBinding?: string }) {
    const provider = this.options.providers[input.provider];
    if (!provider) throw new SocialAuthError('PROVIDER_DISABLED');
    if (!input.sid || !input.csrfToken) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(input.sid) } });
    if (!session || session.revokedAt || session.expiresAt <= this.now() || !tokenMatches(input.csrfToken, session.csrfHash)) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
    if (input.purpose === 'SIGN_IN' && session.state !== 'PRE_AUTH') throw new SocialAuthError('INVALID_REQUEST');
    if (input.purpose === 'LINK') {
      if (session.state !== 'AUTHENTICATED' || !session.userId) throw new SocialAuthError('AUTHENTICATION_REQUIRED');
      if (!session.authenticatedAt || this.now().getTime() - session.authenticatedAt.getTime() > 10 * 60_000) throw new SocialAuthError('RECENT_AUTHENTICATION_REQUIRED');
      if (!input.consent) throw new SocialAuthError('INVALID_REQUEST');
    }
    const state = randomState(); const nonce = randomNonce(); const verifier = randomPKCECodeVerifier();
    const browserBinding = input.browserBinding ?? createOpaqueToken();
    const challenge = await calculatePKCECodeChallenge(verifier);
    const expiresAt = new Date(this.now().getTime() + this.options.transactionTtlMinutes * 60_000);
    await this.prisma.socialAuthorizationTransaction.create({ data: {
      provider: input.provider, purpose: input.purpose, initiatingSessionId: session.id,
      initiatingUserId: input.purpose === 'LINK' ? session.userId : null,
      stateHash: digest(state), nonceHash: digest(nonce), protectedNonce: this.protect(nonce), browserBindingHash: digest(browserBinding),
      protectedPkceVerifier: this.protect(verifier), returnPath: this.safeReturnPath(input.returnPath),
      consentedAt: input.purpose === 'LINK' ? this.now() : null, expiresAt,
    } });
    return { authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge: challenge }), browserBinding, expiresAt };
  }

  async callback(input: { provider: SocialProvider; state: string; browserBinding?: string; callback: URL | Request; appleUser?: string; metadata?: ClientMetadata }) {
    const provider = this.options.providers[input.provider];
    if (!provider || !input.browserBinding || !input.state) throw new SocialAuthError('TRANSACTION_INVALID');
    const record = await this.prisma.socialAuthorizationTransaction.findUnique({ where: { stateHash: digest(input.state) } });
    if (!record || record.provider !== input.provider || record.usedAt || record.expiresAt <= this.now() || !Buffer.from(record.browserBindingHash).equals(digest(input.browserBinding))) throw new SocialAuthError('TRANSACTION_INVALID');
    const verifier = this.unprotect(Buffer.from(record.protectedPkceVerifier));
    const nonce = this.unprotect(Buffer.from(record.protectedNonce));
    if (!digest(nonce).equals(Buffer.from(record.nonceHash))) throw new SocialAuthError('TRANSACTION_INVALID');
    const profile = await provider.exchange({ callback: input.callback, state: input.state, nonce, codeVerifier: verifier, appleUser: input.appleUser });
    return this.finish(record.id, profile, input.metadata);
  }

  private async finish(transactionId: bigint, profile: Awaited<ReturnType<SocialOidcProvider['exchange']>>, metadata?: ClientMetadata) {
    const sid = createOpaqueToken(); const csrfToken = createOpaqueToken(); const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlHours * 3_600_000);
    return this.transactions.execute({ operation: 'social-auth-callback', maxAttempts: 3 }, async (tx) => {
      const record = await tx.socialAuthorizationTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { initiatingSession: true } });
      const consumed = await tx.socialAuthorizationTransaction.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (consumed.count !== 1 || record.initiatingSession.revokedAt || record.initiatingSession.expiresAt <= now) throw new SocialAuthError('TRANSACTION_INVALID');
      const linked = await tx.externalIdentity.findUnique({ where: { issuer_subject: { issuer: profile.identity.issuer, subject: profile.identity.subject } }, include: { user: { select: { id: true, isActive: true, emailNormalized: true } } } });
      const emailAccount = profile.email ? await tx.user.findUnique({ where: { emailNormalized: profile.email.value }, select: { id: true } }) : null;
      const decision = decideSocialAuthentication({ profile, identityLink: linked ? { kind: 'linked', userId: linked.user.id, userActive: linked.user.isActive } : { kind: 'not_linked' }, emailAccount: emailAccount ? { kind: 'exists', userId: emailAccount.id } : { kind: 'none' }, linkAuthorization: record.purpose === 'LINK' && record.initiatingUserId ? { kind: 'requested', authenticatedUserId: record.initiatingUserId, recentAuthenticationProved: Boolean(record.initiatingSession.authenticatedAt && now.getTime() - record.initiatingSession.authenticatedAt.getTime() <= 10 * 60_000), explicitConsent: Boolean(record.consentedAt) } : { kind: 'not_requested' } });
      if (decision.kind === 'continue_registration' || decision.kind === 'require_verified_contact_email') return { kind: 'onboarding_required' as const, returnPath: record.returnPath };
      if (decision.kind === 'require_existing_account_proof') return { kind: 'account_proof_required' as const, returnPath: record.returnPath };
      if (decision.kind === 'require_recent_authentication') throw new SocialAuthError('RECENT_AUTHENTICATION_REQUIRED');
      if (decision.kind === 'require_link_consent') throw new SocialAuthError('INVALID_REQUEST');
      if (decision.kind === 'reject') throw new SocialAuthError('IDENTITY_CONFLICT');
      const userId = decision.userId;
      if (decision.kind === 'link_to_authenticated_user') await tx.externalIdentity.create({ data: { userId, provider: profile.identity.provider, issuer: profile.identity.issuer, subject: profile.identity.subject, emailSnapshot: profile.email?.value ?? null, privateRelay: profile.email?.privateRelay ?? false } });
      await tx.session.update({ where: { id: record.initiatingSessionId }, data: { revokedAt: now } });
      const session = await tx.session.create({ data: { state: 'AUTHENTICATED', userId, tokenHash: hashToken(sid), csrfHash: hashToken(csrfToken), authenticatedAt: now, expiresAt } });
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now, failedLoginAttempts: 0, lockedUntil: null } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { emailNormalized: true, assignments: { where: { isActive: true, company: { isActive: true } }, select: { companyId: true } } } });
      if (user.assignments.length) await this.security.appendMany(tx, user.assignments.map(({ companyId }) => ({ companyId, userId, sessionId: session.id, eventType: decision.kind === 'sign_in' ? 'SOCIAL_LOGIN_SUCCEEDED' : 'SOCIAL_IDENTITY_LINKED', severity: 'INFO', emailSnapshot: user.emailNormalized, ipAddress: metadata?.ipAddress ?? null, userAgent: metadata?.userAgent ?? null, details: { provider: profile.identity.provider } })));
      return { kind: decision.kind === 'sign_in' ? 'signed_in' as const : 'linked' as const, sid, csrfToken, expiresAt, returnPath: record.returnPath };
    });
  }

  async cleanupExpired(retainDays = 7) { return this.prisma.socialAuthorizationTransaction.deleteMany({ where: { OR: [{ usedAt: { lt: new Date(this.now().getTime() - retainDays * 86_400_000) } }, { expiresAt: { lt: new Date(this.now().getTime() - retainDays * 86_400_000) } }] } }); }
  private safeReturnPath(value?: string) { return value && /^\/(?!\/)[A-Za-z0-9/_?=&.-]{0,254}$/.test(value) ? value : '/'; }
  private protect(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }
  private unprotect(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); }
}
