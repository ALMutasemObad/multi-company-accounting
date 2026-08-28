import { createHash, createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { logEvent } from './logger.js';
import { operationalMetrics, type OperationalMetricsSink } from './metrics.js';

type RateLimitOptions = {
  max: number;
  windowMs: number;
  scope: string;
  store?: RateLimitStore;
  metrics?: OperationalMetricsSink;
  identity?: (request: Request) => string;
};

type Counter = { count: number; resetAt: number };

export type RateLimitIncrement = {
  scope: string;
  identity: string;
  windowMs: number;
  now: number;
};

export interface RateLimitStore {
  increment(input: RateLimitIncrement): Promise<Counter> | Counter;
}

function identityDigest(identity: string) {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

export function networkRateLimitIdentity(request: Request) {
  return `network:${request.ip || request.socket.remoteAddress || 'unknown'}`;
}

export function sessionOrNetworkRateLimitIdentity(request: Request) {
  const rawSid = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('=', 2))
    .find(([name, value]) => name === 'sid' && value)?.[1];
  return rawSid ? `session:${rawSid.slice(0, 512)}` : networkRateLimitIdentity(request);
}

export function credentialOrNetworkRateLimitIdentity(request: Request) {
  const body = typeof request.body === 'object' && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  if (typeof body.email === 'string' && body.email.trim()) {
    return `email:${body.email.trim().toLocaleLowerCase('en-US').slice(0, 320)}`;
  }
  if (typeof body.token === 'string' && body.token.trim()) {
    return `token:${body.token.trim().slice(0, 512)}`;
  }
  return networkRateLimitIdentity(request);
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();
  private requestsSinceCleanup = 0;

  increment(input: RateLimitIncrement) {
    const key = `${input.scope}:${identityDigest(input.identity)}`;
    const existing = this.counters.get(key);
    const counter = !existing || existing.resetAt <= input.now
      ? { count: 0, resetAt: input.now + input.windowMs }
      : existing;
    counter.count += 1;
    this.counters.set(key, counter);

    this.requestsSinceCleanup += 1;
    if (this.requestsSinceCleanup >= 1_000) {
      this.requestsSinceCleanup = 0;
      for (const [candidate, value] of this.counters) {
        if (value.resetAt <= input.now) this.counters.delete(candidate);
      }
    }
    return counter;
  }
}

/**
 * Shared fixed-window limiter for security-sensitive public endpoints.
 * Only a keyed HMAC-SHA-256 identity digest is persisted, never the raw address,
 * email, or token.
 */
export class PrismaRateLimitStore implements RateLimitStore {
  private incrementsSinceCleanup = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly identitySecret: string,
  ) {
    if (identitySecret.length < 32 || identitySecret.length > 500) {
      throw new Error('Rate-limit identity secret must contain 32 to 500 characters');
    }
  }

  async increment(input: RateLimitIncrement) {
    const windowStartedAtMs = Math.floor(input.now / input.windowMs) * input.windowMs;
    const windowStartedAt = new Date(windowStartedAtMs);
    const resetAt = windowStartedAtMs + input.windowMs;
    const identityHash = new Uint8Array(
      createHmac('sha256', this.identitySecret).update(input.identity, 'utf8').digest(),
    );
    const counter = await this.prisma.rateLimitCounter.upsert({
      where: {
        scope_identityHash_windowStartedAt: {
          scope: input.scope,
          identityHash,
          windowStartedAt,
        },
      },
      create: {
        scope: input.scope,
        identityHash,
        windowStartedAt,
        requestCount: 1,
        expiresAt: new Date(resetAt + input.windowMs),
      },
      update: { requestCount: { increment: 1 } },
      select: { requestCount: true },
    });

    this.incrementsSinceCleanup += 1;
    if (this.incrementsSinceCleanup >= 1_000) {
      this.incrementsSinceCleanup = 0;
      try {
        await this.prisma.$executeRaw`
          DELETE FROM rate_limit_counters
          WHERE expires_at <= ${new Date(input.now)}
          LIMIT 1000
        `;
      } catch (error) {
        // The security decision has already been persisted. Cleanup is bounded,
        // opportunistic maintenance and must not turn a valid request into 503.
        logEvent('error', 'rate_limit_cleanup_failed', {
          errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
      }
    }
    return { count: counter.requestCount, resetAt };
  }
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const store = options.store ?? new InMemoryRateLimitStore();
  const metrics = options.metrics ?? operationalMetrics;

  return async (request, response, next) => {
    const now = Date.now();
    let counter: Counter;
    try {
      const identity = options.identity?.(request) ?? networkRateLimitIdentity(request);
      counter = await store.increment({ scope: options.scope, identity, windowMs: options.windowMs, now });
    } catch (error) {
      metrics.recordRateLimitStoreFailure(options.scope);
      logEvent('error', 'rate_limit_store_failed', {
        scope: options.scope,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      });
      response.status(503).json({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        code: 'RATE_LIMIT_UNAVAILABLE',
        requestId: response.locals.requestId,
      });
      return;
    }

    const remaining = Math.max(0, options.max - counter.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - now) / 1_000));
    response.setHeader('RateLimit-Limit', options.max.toString());
    response.setHeader('RateLimit-Remaining', remaining.toString());
    response.setHeader('RateLimit-Reset', Math.ceil(counter.resetAt / 1_000).toString());

    if (counter.count > options.max) {
      metrics.recordRateLimitRejected(options.scope);
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      response.status(429).json({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        code: 'RATE_LIMITED',
        requestId: response.locals.requestId,
      });
      return;
    }
    next();
  };
}
