import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHENTICATED_CSRF_VERSION = 'acsrf1';
export const AUTHENTICATED_CSRF_TTL_MS = 15 * 60_000;

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

export function authenticatedCsrfSigningKey(sid: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256')
    .update('authenticated-csrf-signing-key\0', 'utf8')
    .update(sid, 'utf8')
    .digest());
}

export function tokenMatches(token: string, expectedHash: Uint8Array<ArrayBuffer>): boolean {
  const actualHash = hashToken(token);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

function authenticatedCsrfSignature(input: {
  sessionId: bigint;
  expiresAtMs: number;
  nonce: string;
  sessionSigningKey: Uint8Array<ArrayBuffer>;
}) {
  return createHmac('sha256', input.sessionSigningKey)
    .update(`authenticated-csrf:${AUTHENTICATED_CSRF_VERSION}:${input.sessionId}:${input.expiresAtMs}:${input.nonce}`, 'utf8')
    .digest();
}

export function createAuthenticatedCsrfToken(input: {
  sessionId: bigint;
  expiresAt: Date;
  sessionSigningKey: Uint8Array<ArrayBuffer>;
}) {
  const expiresAtMs = input.expiresAt.getTime();
  const nonce = randomBytes(16).toString('base64url');
  const signature = authenticatedCsrfSignature({
    sessionId: input.sessionId,
    expiresAtMs,
    nonce,
    sessionSigningKey: input.sessionSigningKey,
  }).toString('base64url');
  return `${AUTHENTICATED_CSRF_VERSION}.${expiresAtMs}.${nonce}.${signature}`;
}

export function authenticatedCsrfTokenMatches(token: string, input: {
  sessionId: bigint;
  sessionExpiresAt: Date;
  sessionSigningKey: Uint8Array<ArrayBuffer>;
  now: Date;
}) {
  const [version, expiresAtRaw, nonce, signatureRaw, ...extra] = token.split('.');
  if (extra.length || version !== AUTHENTICATED_CSRF_VERSION
    || !/^[1-9][0-9]{11,15}$/u.test(expiresAtRaw ?? '')
    || !/^[A-Za-z0-9_-]{22}$/u.test(nonce ?? '')
    || !/^[A-Za-z0-9_-]{43}$/u.test(signatureRaw ?? '')) return false;
  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= input.now.getTime()
    || expiresAtMs > input.sessionExpiresAt.getTime()
    || expiresAtMs - input.now.getTime() > AUTHENTICATED_CSRF_TTL_MS) return false;
  const expected = authenticatedCsrfSignature({
    sessionId: input.sessionId,
    expiresAtMs,
    nonce: nonce!,
    sessionSigningKey: input.sessionSigningKey,
  }).toString('base64url');
  const actual = Buffer.from(signatureRaw!, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}
