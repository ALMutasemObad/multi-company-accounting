import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const safeRequestId = /^[A-Za-z0-9._-]{8,128}$/;

export function logEvent(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...details };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else console.log(output);
}

export function requestLogger(enabled: boolean): RequestHandler {
  return (request, response, next) => {
    const supplied = request.header('X-Request-ID');
    const requestId = supplied && safeRequestId.test(supplied) ? supplied : randomUUID();
    const startedAt = performance.now();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => {
      if (!enabled) return;
      logEvent('info', 'http_request', {
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
    });
    next();
  };
}
