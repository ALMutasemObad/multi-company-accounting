import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SERVE_WEB_ASSETS: booleanString.default(false),
  SESSION_COOKIE_SECURE: booleanString.default(false),
  PRE_AUTH_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  TRUST_PROXY: booleanString.default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  SELF_REGISTRATION_ENABLED: booleanString.default(true),
  REGISTRATION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(5),
  REGISTRATION_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  REGISTRATION_EMAIL_MODE: z.enum(['log', 'resend']).default('log'),
  REGISTRATION_EMAIL_FROM: z.string().email().max(320).optional(),
  REGISTRATION_EMAIL_CAPTURE_PATH: z.string().trim().min(1).max(1024).optional(),
  RESEND_API_KEY: z.string().min(20).max(500).optional(),
  REGISTRATION_AUDIT_PEPPER: z.string().min(32).max(500).optional(),
  REGISTRATION_TOKEN_SECRET: z.string().min(32).max(500).optional(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(2_000).max(600_000).default(30_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  OUTBOX_BASE_BACKOFF_MS: z.coerce.number().int().min(10).max(60_000).default(1_000),
  OUTBOX_HANDLER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(8_000),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  LOG_REQUESTS: booleanString.default(true),
}).superRefine((config, context) => {
  if (config.OUTBOX_LEASE_MS <= config.OUTBOX_HANDLER_TIMEOUT_MS + 1_000) {
    context.addIssue({ code: 'custom', path: ['OUTBOX_LEASE_MS'], message: 'OUTBOX_LEASE_MS must exceed OUTBOX_HANDLER_TIMEOUT_MS by more than one second' });
  }
  if (config.SHUTDOWN_TIMEOUT_MS <= config.OUTBOX_HANDLER_TIMEOUT_MS + 1_000) {
    context.addIssue({ code: 'custom', path: ['SHUTDOWN_TIMEOUT_MS'], message: 'SHUTDOWN_TIMEOUT_MS must exceed OUTBOX_HANDLER_TIMEOUT_MS by more than one second' });
  }
  if (config.NODE_ENV !== 'production') return;
  if (config.REGISTRATION_EMAIL_CAPTURE_PATH) {
    context.addIssue({ code: 'custom', path: ['REGISTRATION_EMAIL_CAPTURE_PATH'], message: 'Registration email capture is forbidden in production' });
  }
  if (!config.DATABASE_URL) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required in production' });
  }
  if (!config.SESSION_COOKIE_SECURE) {
    context.addIssue({ code: 'custom', path: ['SESSION_COOKIE_SECURE'], message: 'Secure cookies are required in production' });
  }
  if (!config.TRUST_PROXY) {
    context.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY must be enabled for the production reverse proxy deployment' });
  }
  if (!config.WEB_ORIGIN.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'WEB_ORIGIN must use HTTPS in production' });
  }
  if (config.SELF_REGISTRATION_ENABLED && config.REGISTRATION_EMAIL_MODE !== 'resend') {
    context.addIssue({ code: 'custom', path: ['REGISTRATION_EMAIL_MODE'], message: 'Production self-registration requires the resend delivery mode' });
  }
  if (config.SELF_REGISTRATION_ENABLED && !config.REGISTRATION_EMAIL_FROM) {
    context.addIssue({ code: 'custom', path: ['REGISTRATION_EMAIL_FROM'], message: 'REGISTRATION_EMAIL_FROM is required when production self-registration is enabled' });
  }
  if (config.SELF_REGISTRATION_ENABLED && !config.RESEND_API_KEY) {
    context.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when production self-registration is enabled' });
  }
  if (config.SELF_REGISTRATION_ENABLED && !config.REGISTRATION_AUDIT_PEPPER) {
    context.addIssue({ code: 'custom', path: ['REGISTRATION_AUDIT_PEPPER'], message: 'REGISTRATION_AUDIT_PEPPER is required when production self-registration is enabled' });
  }
  if (config.SELF_REGISTRATION_ENABLED && !config.REGISTRATION_TOKEN_SECRET) {
    context.addIssue({ code: 'custom', path: ['REGISTRATION_TOKEN_SECRET'], message: 'REGISTRATION_TOKEN_SECRET is required when production self-registration is enabled' });
  }
});

type LoadedAppConfig = z.infer<typeof configSchema>;

// The newer operational fields remain optional at construction sites so focused
// tests can keep using compact fixtures. loadConfig always returns every field.
export type AppConfig = Pick<LoadedAppConfig,
  'NODE_ENV' | 'PORT' | 'DATABASE_URL' | 'WEB_ORIGIN' | 'SESSION_COOKIE_SECURE' | 'PRE_AUTH_TTL_MINUTES' | 'SESSION_TTL_HOURS'
> & Partial<Pick<LoadedAppConfig,
  'SERVE_WEB_ASSETS' | 'TRUST_PROXY' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_MAX' | 'SELF_REGISTRATION_ENABLED' | 'REGISTRATION_RATE_LIMIT_MAX' | 'REGISTRATION_TOKEN_TTL_HOURS' | 'REGISTRATION_EMAIL_MODE' | 'REGISTRATION_EMAIL_FROM' | 'REGISTRATION_EMAIL_CAPTURE_PATH' | 'RESEND_API_KEY' | 'REGISTRATION_AUDIT_PEPPER' | 'REGISTRATION_TOKEN_SECRET' | 'OUTBOX_POLL_INTERVAL_MS' | 'OUTBOX_LEASE_MS' | 'OUTBOX_BATCH_SIZE' | 'OUTBOX_MAX_ATTEMPTS' | 'OUTBOX_BASE_BACKOFF_MS' | 'OUTBOX_HANDLER_TIMEOUT_MS' | 'OUTBOX_RETENTION_DAYS' | 'READINESS_TIMEOUT_MS' | 'SHUTDOWN_TIMEOUT_MS' | 'LOG_REQUESTS'
>>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): LoadedAppConfig {
  return configSchema.parse(environment);
}
