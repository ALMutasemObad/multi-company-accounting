import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_COOKIE_SECURE: booleanString.default(false),
  PRE_AUTH_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  TRUST_PROXY: booleanString.default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  LOG_REQUESTS: booleanString.default(true),
}).superRefine((config, context) => {
  if (config.NODE_ENV !== 'production') return;
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
});

type LoadedAppConfig = z.infer<typeof configSchema>;

// The newer operational fields remain optional at construction sites so focused
// tests can keep using compact fixtures. loadConfig always returns every field.
export type AppConfig = Pick<LoadedAppConfig,
  'NODE_ENV' | 'PORT' | 'DATABASE_URL' | 'WEB_ORIGIN' | 'SESSION_COOKIE_SECURE' | 'PRE_AUTH_TTL_MINUTES' | 'SESSION_TTL_HOURS'
> & Partial<Pick<LoadedAppConfig,
  'TRUST_PROXY' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_MAX' | 'READINESS_TIMEOUT_MS' | 'SHUTDOWN_TIMEOUT_MS' | 'LOG_REQUESTS'
>>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): LoadedAppConfig {
  return configSchema.parse(environment);
}
