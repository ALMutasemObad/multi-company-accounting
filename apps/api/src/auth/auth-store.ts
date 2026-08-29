export type StoredSession = {
  id: bigint;
  state: 'PRE_AUTH' | 'AUTHENTICATED';
  userId: bigint | null;
  selectedCompanyId: bigint | null;
  csrfHash: Uint8Array<ArrayBuffer>;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type StoredUser = {
  id: bigint;
  emailNormalized: string;
  passwordHash: string;
  displayName: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

export type CompanyAccess = { id: bigint; name: string; timezone: string };
export type AuthorizationSnapshot = {
  user: { id: bigint; displayName: string };
  selectedCompany: CompanyAccess | null;
  permissions: string[];
};
export type SessionSummary = { id: bigint; createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null };
export type ClientMetadata = { ipAddress?: string | undefined; userAgent?: string | undefined };

export interface AuthStore {
  createPreAuth(input: { tokenHash: Uint8Array<ArrayBuffer>; csrfHash: Uint8Array<ArrayBuffer>; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: Uint8Array<ArrayBuffer>): Promise<StoredSession | null>;
  findUser(emailNormalized: string): Promise<StoredUser | null>;
  recordFailedLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined): Promise<void>;
  recordLockedLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined): Promise<void>;
  recordDisabledLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined): Promise<void>;
  rotateToAuthenticated(input: {
    oldSessionId: bigint;
    userId: bigint;
    tokenHash: Uint8Array<ArrayBuffer>;
    csrfHash: Uint8Array<ArrayBuffer>;
    authenticatedAt: Date;
    expiresAt: Date;
    metadata?: ClientMetadata | undefined;
  }): Promise<void>;
  listCompanies(userId: bigint): Promise<CompanyAccess[]>;
  readAuthorizationSnapshot(input: { userId: bigint; companyId: bigint | null }): Promise<AuthorizationSnapshot | null>;
  selectCompany(input: { sessionId: bigint; userId: bigint; companyId: bigint; metadata?: ClientMetadata | undefined }): Promise<boolean>;
  revokeCurrentSession(sessionId: bigint, metadata?: ClientMetadata | undefined): Promise<void>;
  hasPermission(input: { userId: bigint; companyId: bigint; code: string }): Promise<boolean>;
  listUserSessions(input: { userId: bigint; skip: number; take: number }): Promise<{ data: SessionSummary[]; total: number }>;
  revokeUserSession(input: { userId: bigint; sessionId: bigint; actorSessionId: bigint; metadata?: ClientMetadata | undefined }): Promise<void>;
}

export interface PasswordVerifier {
  verify(passwordHash: string, password: string): Promise<boolean>;
}
