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
      SELF_REGISTRATION_ENABLED: 'false',
    });
    expect(config.SESSION_COOKIE_SECURE).toBe(true);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.SERVE_WEB_ASSETS).toBe(false);
    expect(config.RATE_LIMIT_MAX).toBe(300);
    expect(config.AUTH_RATE_LIMIT_MAX).toBe(20);
    expect(config.REGISTRATION_RATE_LIMIT_MAX).toBe(5);
    expect(config.PASSWORD_RESET_ENABLED).toBe(false);
    expect(config.BANK_RECONCILIATION_ENABLED).toBe(false);
    expect(config.BANK_RECONCILIATION_COMPANY_IDS).toBe('');
    expect(config.BANK_RECONCILIATION_ROLLOUT_STAGE).toBe('OFF');
    expect(config.READINESS_TIMEOUT_MS).toBe(3_000);
    expect(config.OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(config.OUTBOX_LEASE_MS).toBe(30_000);
    expect(config.OUTBOX_HANDLER_TIMEOUT_MS).toBe(8_000);
    expect(config.HTTP_REQUEST_TIMEOUT_MS).toBe(70_000);
    expect(config.HTTP_HEADERS_TIMEOUT_MS).toBe(10_000);
    expect(config.HTTP_KEEP_ALIVE_TIMEOUT_MS).toBe(5_000);
    expect(config.API_READ_DEADLINE_MS).toBe(10_000);
    expect(config.API_WRITE_DEADLINE_MS).toBe(15_000);
    expect(config.API_REGISTRATION_WRITE_DEADLINE_MS).toBe(65_000);
    expect(config.METRICS_ENABLED).toBe(false);
  });

  it('requires a real email provider when production self-registration is enabled', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'true',
      REGISTRATION_EMAIL_MODE: 'log',
    })).toThrow();

    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'true',
      REGISTRATION_EMAIL_MODE: 'resend',
      REGISTRATION_EMAIL_FROM: 'accounts@example.com',
      RESEND_API_KEY: 're_test_12345678901234567890',
      REGISTRATION_AUDIT_PEPPER: 'test-registration-audit-pepper-1234567890',
      REGISTRATION_TOKEN_SECRET: 'test-registration-token-secret-1234567890',
    });
    expect(config.REGISTRATION_EMAIL_MODE).toBe('resend');
  });

  it('requires an explicit production company allowlist for bank reconciliation', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      BANK_RECONCILIATION_ENABLED: 'true',
      BANK_RECONCILIATION_ROLLOUT_STAGE: 'SHADOW',
    } as const;
    expect(() => loadConfig(production)).toThrow(/BANK_RECONCILIATION_COMPANY_IDS|allowlist/);
    expect(() => loadConfig({ ...production, BANK_RECONCILIATION_COMPANY_IDS: '*' })).toThrow(/Wildcard/);
    expect(loadConfig({ ...production, BANK_RECONCILIATION_COMPANY_IDS: '42' }).BANK_RECONCILIATION_ROLLOUT_STAGE).toBe('SHADOW');
  });

  it('requires a real email provider and token secret when password reset is enabled', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      PASSWORD_RESET_ENABLED: 'true',
      REGISTRATION_EMAIL_MODE: 'log',
    })).toThrow();

    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      PASSWORD_RESET_ENABLED: 'true',
      REGISTRATION_EMAIL_MODE: 'resend',
      REGISTRATION_EMAIL_FROM: 'accounts@example.com',
      RESEND_API_KEY: 're_test_12345678901234567890',
      REGISTRATION_TOKEN_SECRET: 'test-password-reset-token-secret-1234567890',
    });
    expect(config.PASSWORD_RESET_ENABLED).toBe(true);
  });

  it('rejects an outbox lease that can expire before its handler deadline', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      OUTBOX_LEASE_MS: '15000',
      OUTBOX_HANDLER_TIMEOUT_MS: '15000',
    })).toThrow(/OUTBOX_LEASE_MS/);
  });

  it('keeps the outbox handler deadline inside the graceful shutdown budget', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      OUTBOX_HANDLER_TIMEOUT_MS: '9000',
      SHUTDOWN_TIMEOUT_MS: '10000',
    })).toThrow(/SHUTDOWN_TIMEOUT_MS/);
  });

  it('enforces the HTTP and application deadline hierarchy', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      HTTP_REQUEST_TIMEOUT_MS: '20000',
      API_REGISTRATION_WRITE_DEADLINE_MS: '20000',
    })).toThrow(/HTTP_REQUEST_TIMEOUT_MS/);
    expect(() => loadConfig({
      NODE_ENV: 'test',
      HTTP_REQUEST_TIMEOUT_MS: '70000',
      HTTP_HEADERS_TIMEOUT_MS: '71000',
    })).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
    expect(() => loadConfig({
      NODE_ENV: 'test',
      API_READ_DEADLINE_MS: '20000',
      API_WRITE_DEADLINE_MS: '10000',
    })).toThrow(/API_WRITE_DEADLINE_MS/);
  });

  it('requires a bearer secret for production metric exposition', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      METRICS_ENABLED: 'true',
    })).toThrow(/METRICS_BEARER_TOKEN/);

    expect(loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'test-metrics-bearer-token-1234567890',
    }).METRICS_ENABLED).toBe(true);
  });

  it('accepts an explicit comma-separated platform operator allowlist', () => {
    expect(loadConfig({
      NODE_ENV: 'test',
      PLATFORM_OPERATOR_EMAILS: 'owner@example.com, operations@example.com',
    }).PLATFORM_OPERATOR_EMAILS).toBe('owner@example.com, operations@example.com');

    expect(() => loadConfig({
      NODE_ENV: 'test',
      PLATFORM_OPERATOR_EMAILS: 'owner@example.com,*',
    })).toThrow(/PLATFORM_OPERATOR_EMAILS/);
  });

  it('allows verification capture only outside production', () => {
    expect(loadConfig({
      NODE_ENV: 'test',
      REGISTRATION_EMAIL_CAPTURE_PATH: 'tmp/e2e-registration.jsonl',
    }).REGISTRATION_EMAIL_CAPTURE_PATH).toBe('tmp/e2e-registration.jsonl');

    expect(() => loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://runtime:secret@db.internal/mcap',
      WEB_ORIGIN: 'https://finance.example.com',
      SESSION_COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SELF_REGISTRATION_ENABLED: 'false',
      PASSWORD_RESET_ENABLED: 'false',
      REGISTRATION_EMAIL_CAPTURE_PATH: '/tmp/registration.jsonl',
    })).toThrow(/Registration email capture is forbidden in production/);
  });
});
