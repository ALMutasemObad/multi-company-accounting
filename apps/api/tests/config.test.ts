import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('production configuration', () => {
  it('fails fast when production transport settings are unsafe', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'http://finance.example.com',
      SESSION_COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
    })).toThrow();
  });

  it('accepts a complete production configuration and applies operational defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
    });
    expect(config.SESSION_COOKIE_SECURE).toBe(true);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.RATE_LIMIT_MAX).toBe(300);
    expect(config.AUTH_RATE_LIMIT_MAX).toBe(20);
    expect(config.READINESS_TIMEOUT_MS).toBe(3_000);
  });
});
