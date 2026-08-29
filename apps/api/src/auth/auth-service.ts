import type { AuthStore, ClientMetadata, PasswordVerifier, StoredSession } from './auth-store.js';
import { createOpaqueToken, hashToken, tokenMatches } from './session-tokens.js';

export class AuthError extends Error {
  constructor(public readonly reason: 'UNAUTHENTICATED' | 'INVALID_CSRF' | 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'FORBIDDEN') {
    super(reason);
  }
}

type AuthOptions = { preAuthTtlMinutes: number; sessionTtlHours: number };

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordVerifier,
    private readonly options: AuthOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueCsrf() {
    const sid = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(this.now().getTime() + this.options.preAuthTtlMinutes * 60_000);
    await this.store.createPreAuth({ tokenHash: hashToken(sid), csrfHash: hashToken(csrfToken), expiresAt });
    return { sid, csrfToken, expiresAt };
  }

  async login(input: { sid?: string | undefined; csrfToken?: string | undefined; email: string; password: string; metadata?: ClientMetadata }) {
    const session = await this.requireSession(input.sid, input.csrfToken, 'PRE_AUTH');
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const user = await this.store.findUser(emailNormalized);
    const validPassword = user ? await this.passwords.verify(user.passwordHash, input.password) : false;
    const now = this.now();

    if (!user || !user.isActive || !validPassword) {
      if (user?.isActive) await this.store.recordFailedLogin(user.id, now, input.metadata);
      else if (user) await this.store.recordDisabledLogin(user.id, now, input.metadata);
      throw new AuthError('INVALID_CREDENTIALS');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.store.recordLockedLogin(user.id, now, input.metadata);
      throw new AuthError('ACCOUNT_LOCKED');
    }

    const sid = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlHours * 3_600_000);
    await this.store.rotateToAuthenticated({
      oldSessionId: session.id,
      userId: user.id,
      tokenHash: hashToken(sid),
      csrfHash: hashToken(csrfToken),
      authenticatedAt: now,
      expiresAt,
      metadata: input.metadata,
    });
    return { sid, csrfToken, expiresAt, user: { id: user.id.toString(), displayName: user.displayName } };
  }

  async validatePreAuth(input: { sid?: string | undefined; csrfToken?: string | undefined }) {
    await this.requireSession(input.sid, input.csrfToken, 'PRE_AUTH');
  }

  async companies(input: { sid?: string | undefined }) {
    const session = await this.requireAuthenticated(input.sid);
    return this.store.listCompanies(session.userId!);
  }

  async me(input: { sid?: string | undefined }) {
    const session = await this.requireAuthenticated(input.sid);
    const snapshot = await this.store.readAuthorizationSnapshot({
      userId: session.userId!,
      companyId: session.selectedCompanyId,
    });
    if (!snapshot) {
      throw new AuthError(session.selectedCompanyId ? 'FORBIDDEN' : 'UNAUTHENTICATED');
    }
    return snapshot;
  }

  async selectCompany(input: { sid?: string | undefined; csrfToken?: string | undefined; companyId: bigint; metadata?: ClientMetadata }) {
    const session = await this.requireSession(input.sid, input.csrfToken, 'AUTHENTICATED');
    if (input.companyId <= 0n) throw new AuthError('FORBIDDEN');
    const selected = await this.store.selectCompany({ sessionId: session.id, userId: session.userId!, companyId: input.companyId, metadata: input.metadata });
    if (!selected) throw new AuthError('FORBIDDEN');
  }

  async logout(input: { sid?: string | undefined; csrfToken?: string | undefined; metadata?: ClientMetadata }) {
    const session = await this.requireSession(input.sid, input.csrfToken, 'AUTHENTICATED');
    await this.store.revokeCurrentSession(session.id, input.metadata);
  }

  async sessions(input: { sid?: string | undefined; page: number; pageSize: number }) {
    const session = await this.requireAuthenticated(input.sid);
    await this.requirePermission(session, 'auth.sessions.view');
    const result = await this.store.listUserSessions({ userId: session.userId!, skip: (input.page - 1) * input.pageSize, take: input.pageSize });
    return { ...result, currentSessionId: session.id };
  }

  async revokeSession(input: { sid?: string | undefined; csrfToken?: string | undefined; sessionId: string; metadata?: ClientMetadata }) {
    const session = await this.requireSession(input.sid, input.csrfToken, 'AUTHENTICATED');
    await this.requirePermission(session, 'auth.sessions.revoke');
    if (!/^[1-9][0-9]*$/.test(input.sessionId)) throw new AuthError('FORBIDDEN');
    await this.store.revokeUserSession({ userId: session.userId!, sessionId: BigInt(input.sessionId), actorSessionId: session.id, metadata: input.metadata });
  }

  async authorize(input: { sid?: string | undefined; csrfToken?: string | undefined; permission: string; requireCsrf: boolean }) {
    const session = input.requireCsrf
      ? await this.requireSession(input.sid, input.csrfToken, 'AUTHENTICATED')
      : await this.requireAuthenticated(input.sid);
    await this.requirePermission(session, input.permission);
    return { sessionId: session.id, userId: session.userId!, companyId: session.selectedCompanyId! };
  }

  async authenticate(input: { sid?: string | undefined; csrfToken?: string | undefined; requireCsrf?: boolean | undefined }) {
    const session = input.requireCsrf
      ? await this.requireSession(input.sid, input.csrfToken, 'AUTHENTICATED')
      : await this.requireAuthenticated(input.sid);
    return { sessionId: session.id, userId: session.userId! };
  }

  private async requirePermission(session: StoredSession, code: string) {
    if (!session.selectedCompanyId) throw new AuthError('FORBIDDEN');
    const allowed = await this.store.hasPermission({ userId: session.userId!, companyId: session.selectedCompanyId, code });
    if (!allowed) throw new AuthError('FORBIDDEN');
  }

  private async requireAuthenticated(sid?: string) {
    if (!sid) throw new AuthError('UNAUTHENTICATED');
    const session = await this.store.findSession(hashToken(sid));
    if (!session || session.state !== 'AUTHENTICATED' || !session.userId || session.revokedAt || session.expiresAt <= this.now()) {
      throw new AuthError('UNAUTHENTICATED');
    }
    return session;
  }

  private async requireSession(sid: string | undefined, csrfToken: string | undefined, state: 'PRE_AUTH' | 'AUTHENTICATED') {
    if (!sid) throw new AuthError('UNAUTHENTICATED');
    const session = await this.store.findSession(hashToken(sid));
    if (!session || session.state !== state || session.revokedAt || session.expiresAt <= this.now()) throw new AuthError('UNAUTHENTICATED');
    if (!csrfToken || !tokenMatches(csrfToken, session.csrfHash)) throw new AuthError('INVALID_CSRF');
    return session;
  }
}
