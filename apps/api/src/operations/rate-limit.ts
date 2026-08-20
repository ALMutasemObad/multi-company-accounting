import type { RequestHandler } from 'express';

type RateLimitOptions = {
  max: number;
  windowMs: number;
  scope: string;
};

type Counter = { count: number; resetAt: number };

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const counters = new Map<string, Counter>();
  let requestsSinceCleanup = 0;

  return (request, response, next) => {
    const now = Date.now();
    const identity = request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${options.scope}:${identity}`;
    const existing = counters.get(key);
    const counter = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : existing;
    counter.count += 1;
    counters.set(key, counter);

    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 1_000) {
      requestsSinceCleanup = 0;
      for (const [candidate, value] of counters) {
        if (value.resetAt <= now) counters.delete(candidate);
      }
    }

    const remaining = Math.max(0, options.max - counter.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - now) / 1_000));
    response.setHeader('RateLimit-Limit', options.max.toString());
    response.setHeader('RateLimit-Remaining', remaining.toString());
    response.setHeader('RateLimit-Reset', Math.ceil(counter.resetAt / 1_000).toString());

    if (counter.count > options.max) {
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
