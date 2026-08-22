import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler, Response } from 'express';
import { logEvent } from './logger.js';
import { operationalMetrics, type OperationalMetricsSink } from './metrics.js';

export type RequestClass = 'READ' | 'WRITE' | 'REGISTRATION_WRITE';

export class RequestDeadlineExceededError extends Error {
  readonly code = 'REQUEST_DEADLINE_EXCEEDED';

  constructor(public readonly operation = 'HTTP_REQUEST', options?: { cause?: unknown }) {
    super(`Request deadline exceeded for ${operation}`, options);
    this.name = 'RequestDeadlineExceededError';
  }
}

export class ClientDisconnectedError extends Error {
  readonly code = 'CLIENT_DISCONNECTED';

  constructor(public readonly operation = 'HTTP_REQUEST') {
    super(`Client disconnected during ${operation}`);
    this.name = 'ClientDisconnectedError';
  }
}

export type RequestExecutionContext = {
  requestId: string;
  requestClass: RequestClass;
  startedAt: number;
  deadlineAt: number;
  signal: AbortSignal;
  deadlineMetricRecorded: boolean;
};

const requestStorage = new AsyncLocalStorage<RequestExecutionContext>();

export function currentRequestContext() {
  return requestStorage.getStore();
}

export function runWithRequestContext<T>(context: RequestExecutionContext, work: () => T): T {
  return requestStorage.run(context, work);
}

export function classifyRequest(method: string, path: string): RequestClass {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && path.startsWith('/api/v1/auth/register')) {
    return 'REGISTRATION_WRITE';
  }
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'READ' : 'WRITE';
}

export function markRequestDeadlineExceeded(metrics: OperationalMetricsSink = operationalMetrics) {
  const context = currentRequestContext();
  if (context?.deadlineMetricRecorded) return;
  if (context) context.deadlineMetricRecorded = true;
  metrics.recordRequestDeadline(context?.requestClass ?? 'WRITE');
}

export function assertRequestActive(operation = 'APPLICATION_WORK') {
  const context = currentRequestContext();
  if (!context) return;
  if (context.signal.aborted) {
    if (context.signal.reason instanceof ClientDisconnectedError) throw context.signal.reason;
    if (context.signal.reason instanceof RequestDeadlineExceededError) throw context.signal.reason;
    throw new ClientDisconnectedError(operation);
  }
  if (Date.now() >= context.deadlineAt) throw new RequestDeadlineExceededError(operation);
}

export async function sleepWithinRequest(milliseconds: number) {
  const context = currentRequestContext();
  if (!context) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  assertRequestActive('APPLICATION_WAIT');
  const remainingMs = context.deadlineAt - Date.now();
  if (remainingMs <= 0 || milliseconds >= remainingMs) throw new RequestDeadlineExceededError('APPLICATION_WAIT');
  await new Promise<void>((resolve, reject) => {
    const completed = () => {
      context.signal.removeEventListener('abort', aborted);
      resolve();
    };
    const timer = setTimeout(completed, milliseconds);
    const aborted = () => {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', aborted);
      reject(context.signal.reason instanceof Error ? context.signal.reason : new ClientDisconnectedError('APPLICATION_WAIT'));
    };
    context.signal.addEventListener('abort', aborted, { once: true });
    timer.unref();
    void Promise.resolve().then(() => {
      if (context.signal.aborted) aborted();
    });
  });
}

export type RequestContextOptions = {
  readDeadlineMs: number;
  writeDeadlineMs: number;
  registrationWriteDeadlineMs: number;
  now?: () => number;
  metrics?: OperationalMetricsSink;
};

function deadlineProblem(requestId: string) {
  return {
    type: 'about:blank',
    title: 'Request deadline exceeded',
    status: 504,
    code: 'REQUEST_DEADLINE_EXCEEDED',
    messageAr: 'تجاوزت العملية المهلة الآمنة. تحقق من حالتها وأعد المحاولة بمفتاح Idempotency نفسه عند توفره.',
    requestId,
  };
}

function isVersionConflictBody(body: unknown) {
  if (typeof body !== 'object' || body === null) return false;
  const value = body as { reason?: unknown; details?: { reason?: unknown } };
  return value.reason === 'VERSION_CONFLICT' || value.details?.reason === 'VERSION_CONFLICT';
}

export function requestContextMiddleware(options: RequestContextOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const metrics = options.metrics ?? operationalMetrics;

  return (request, response, next) => {
    const requestId = typeof response.locals.requestId === 'string' ? response.locals.requestId : 'missing-request-id';
    const requestClass = classifyRequest(request.method, request.path);
    const budgetMs = requestClass === 'READ'
      ? options.readDeadlineMs
      : requestClass === 'REGISTRATION_WRITE'
        ? options.registrationWriteDeadlineMs
        : options.writeDeadlineMs;
    const startedAt = now();
    const controller = new AbortController();
    const context: RequestExecutionContext = {
      requestId,
      requestClass,
      startedAt,
      deadlineAt: startedAt + budgetMs,
      signal: controller.signal,
      deadlineMetricRecorded: false,
    };
    let terminal: 'OPEN' | 'DEADLINE' | 'DISCONNECTED' | 'FINISHED' = 'OPEN';
    let sendingDeadline = false;

    const originalSend = response.send;
    const originalJson = response.json;
    response.send = function guardedSend(this: Response, body?: unknown) {
      if (sendingDeadline) return originalSend.call(this, body);
      if (terminal !== 'OPEN' || response.writableEnded || response.destroyed) return response;
      if (now() >= context.deadlineAt) {
        finishDeadline();
        return response;
      }
      return originalSend.call(this, body);
    } as Response['send'];
    response.json = function observedJson(this: Response, body?: unknown) {
      if (terminal === 'OPEN' && isVersionConflictBody(body)) metrics.recordOptimisticConflict(requestClass);
      if (terminal !== 'OPEN' && !sendingDeadline) return response;
      return originalJson.call(this, body);
    } as Response['json'];

    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('aborted', disconnected);
      response.removeListener('finish', finished);
      response.removeListener('close', closed);
    };
    const finished = () => {
      if (terminal === 'OPEN') terminal = 'FINISHED';
      metrics.recordHttpRequest(requestClass, request.method.toUpperCase(), response.statusCode, Math.max(0, now() - startedAt));
      cleanup();
    };
    const disconnected = () => {
      if (terminal !== 'OPEN') return;
      terminal = 'DISCONNECTED';
      const error = new ClientDisconnectedError();
      controller.abort(error);
      metrics.recordClientDisconnect(requestClass);
      logEvent('info', 'http_client_disconnected', { requestId, requestClass, method: request.method });
      cleanup();
    };
    const closed = () => {
      if (!response.writableEnded) disconnected();
    };
    const finishDeadline = () => {
      if (terminal !== 'OPEN') return;
      terminal = 'DEADLINE';
      const error = new RequestDeadlineExceededError();
      controller.abort(error);
      if (!context.deadlineMetricRecorded) {
        context.deadlineMetricRecorded = true;
        metrics.recordRequestDeadline(context.requestClass);
      }
      logEvent('error', 'http_request_deadline_exceeded', { requestId, requestClass, method: request.method, budgetMs });
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        sendingDeadline = true;
        response.status(504).type('application/problem+json').json(deadlineProblem(requestId));
        sendingDeadline = false;
      } else if (!response.writableEnded && !response.destroyed) {
        response.destroy();
      }
    };

    const timer = setTimeout(finishDeadline, budgetMs);
    timer.unref();
    request.once('aborted', disconnected);
    response.once('finish', finished);
    response.once('close', closed);
    requestStorage.run(context, next);
  };
}
