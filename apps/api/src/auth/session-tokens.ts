import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

export function tokenMatches(token: string, expectedHash: Uint8Array<ArrayBuffer>): boolean {
  const actualHash = hashToken(token);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}
