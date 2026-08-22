import { describe, expect, it } from 'vitest';
import { AuthError, AuthService } from '../src/auth/auth-service.js';
import type { AuthStore, CompanyAccess, StoredSession, StoredUser } from '../src/auth/auth-store.js';

class TestStore implements AuthStore {
  sessions = new Map<string, StoredSession>();
  users = new Map<string, StoredUser>();
  companies: CompanyAccess[] = [];
  failedLogins = 0;
  selectedCompanyId: bigint | null = null;
  private nextSessionId = 1n;

  async createPreAuth(input: { tokenHash: Uint8Array<ArrayBuffer>; csrfHash: Uint8Array<ArrayBuffer>; expiresAt: Date }) {
    this.sessions.set(Buffer.from(input.tokenHash).toString('hex'), { id: this.nextSessionId++, state: 'PRE_AUTH', userId: null, selectedCompanyId: null, csrfHash: input.csrfHash, expiresAt: input.expiresAt, revokedAt: null });
  }
  async findSession(tokenHash: Uint8Array<ArrayBuffer>) { return this.sessions.get(Buffer.from(tokenHash).toString('hex')) ?? null; }
  async findUser(emailNormalized: string) { return this.users.get(emailNormalized) ?? null; }
  async recordFailedLogin() { this.failedLogins += 1; }
  async recordLockedLogin() {}
  async recordDisabledLogin() {}
  async rotateToAuthenticated(input: { oldSessionId: bigint; userId: bigint; tokenHash: Uint8Array<ArrayBuffer>; csrfHash: Uint8Array<ArrayBuffer>; authenticatedAt: Date; expiresAt: Date }) {
    for (const [key, session] of this.sessions) if (session.id === input.oldSessionId) this.sessions.delete(key);
    this.sessions.set(Buffer.from(input.tokenHash).toString('hex'), { id: this.nextSessionId++, state: 'AUTHENTICATED', userId: input.userId, selectedCompanyId: null, csrfHash: input.csrfHash, expiresAt: input.expiresAt, revokedAt: null });
  }
  async listCompanies() { return this.companies; }
  async selectCompany(input: { sessionId: bigint; userId: bigint; companyId: bigint }) {
    const allowed = this.companies.some((company) => company.id === input.companyId);
    if (allowed) this.selectedCompanyId = input.companyId;
    return allowed;
  }
  async revokeCurrentSession(sessionId: bigint) {
    for (const session of this.sessions.values()) if (session.id === sessionId) session.revokedAt = now;
  }
  async hasPermission() { return this.selectedCompanyId !== null; }
  async listUserSessions(input: { userId: bigint; skip: number; take: number }) {
    const sessions = [...this.sessions.values()].filter((session) => session.userId === input.userId);
    return {
      data: sessions.slice(input.skip, input.skip + input.take).map((session) => ({ id: session.id, createdAt: now, lastSeenAt: now, expiresAt: session.expiresAt, revokedAt: session.revokedAt })),
      total: sessions.length,
    };
  }
  async revokeUserSession(input: { userId: bigint; sessionId: bigint }) {
    for (const session of this.sessions.values()) if (session.id === input.sessionId && session.userId === input.userId) session.revokedAt = now;
  }
}

const now = new Date('2026-08-01T12:00:00.000Z');
const user: StoredUser = { id: 7n, emailNormalized: 'user@example.com', passwordHash: 'valid-hash', displayName: 'مستخدم الاختبار', isActive: true, failedLoginAttempts: 0, lockedUntil: null };

function fixture() {
  const store = new TestStore();
  store.users.set(user.emailNormalized, user);
  const auth = new AuthService(store, { verify: async (hash, password) => hash === 'valid-hash' && password === 'correct-password' }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 }, () => now);
  return { store, auth };
}

describe('AuthService', () => {
  it('issues PRE_AUTH CSRF and rotates the session after login', async () => {
    const { auth } = fixture();
    const preAuth = await auth.issueCsrf();
    const result = await auth.login({ sid: preAuth.sid, csrfToken: preAuth.csrfToken, email: ' USER@example.com ', password: 'correct-password' });
    expect(result.sid).not.toBe(preAuth.sid);
    expect(result.user.id).toBe('7');
    await expect(auth.companies({ sid: preAuth.sid })).rejects.toMatchObject({ reason: 'UNAUTHENTICATED' });
  });

  it('rejects login without a CSRF token', async () => {
    const { auth } = fixture();
    const preAuth = await auth.issueCsrf();
    await expect(auth.login({ sid: preAuth.sid, email: user.emailNormalized, password: 'correct-password' })).rejects.toEqual(new AuthError('INVALID_CSRF'));
  });

  it('validates the PRE_AUTH cookie and CSRF pair for anonymous state changes', async () => {
    const { auth } = fixture();
    const preAuth = await auth.issueCsrf();
    await expect(auth.validatePreAuth({ sid: preAuth.sid, csrfToken: preAuth.csrfToken })).resolves.toBeUndefined();
    await expect(auth.validatePreAuth({ sid: preAuth.sid, csrfToken: 'wrong' })).rejects.toEqual(new AuthError('INVALID_CSRF'));
  });

  it('uses the same public error for an unknown email and a wrong password', async () => {
    const { auth, store } = fixture();
    for (const email of ['missing@example.com', user.emailNormalized]) {
      const preAuth = await auth.issueCsrf();
      await expect(auth.login({ sid: preAuth.sid, csrfToken: preAuth.csrfToken, email, password: 'wrong' })).rejects.toMatchObject({ reason: 'INVALID_CREDENTIALS' });
    }
    expect(store.failedLogins).toBe(1);
  });

  it('prevents selecting a company outside the user assignments', async () => {
    const { auth, store } = fixture();
    store.companies = [{ id: 10n, name: 'الشركة التجريبية', timezone: 'Asia/Riyadh' }];
    const preAuth = await auth.issueCsrf();
    const login = await auth.login({ sid: preAuth.sid, csrfToken: preAuth.csrfToken, email: user.emailNormalized, password: 'correct-password' });
    await expect(auth.selectCompany({ sid: login.sid, csrfToken: login.csrfToken, companyId: 11n })).rejects.toMatchObject({ reason: 'FORBIDDEN' });
    await auth.selectCompany({ sid: login.sid, csrfToken: login.csrfToken, companyId: 10n });
    expect(store.selectedCompanyId).toBe(10n);
  });
});
