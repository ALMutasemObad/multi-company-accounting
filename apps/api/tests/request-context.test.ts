import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { OperationalMetrics } from '../src/operations/metrics.js';
import {
  ClientDisconnectedError,
  currentRequestContext,
  requestContextMiddleware,
} from '../src/operations/request-context.js';

function withRequestContext(deadlineMs: number, metrics = new OperationalMetrics()) {
  const app = express();
  app.use((_request, response, next) => {
    response.locals.requestId = 'request-12345678';
    response.setHeader('X-Request-ID', response.locals.requestId);
    next();
  });
  app.use(requestContextMiddleware({
    readDeadlineMs: deadlineMs,
    writeDeadlineMs: deadlineMs,
    registrationWriteDeadlineMs: deadlineMs,
    metrics,
  }));
  return app;
}

describe('HTTP request execution context', () => {
  it('propagates one absolute deadline and request identifier through async work', async () => {
    const app = withRequestContext(1_000);
    app.get('/context', async (_request, response) => {
      await Promise.resolve();
      const context = currentRequestContext();
      response.json({
        requestId: context?.requestId,
        requestClass: context?.requestClass,
        budgetMs: context ? context.deadlineAt - context.startedAt : null,
      });
    });

    await request(app).get('/context').expect(200, {
      requestId: 'request-12345678',
      requestClass: 'READ',
      budgetMs: 1_000,
    });
  });

  it('returns 504 once and suppresses a late success response', async () => {
    const metrics = new OperationalMetrics({ requestDeadlineCountThreshold: 100 });
    const app = withRequestContext(20, metrics);
    let lateHandlerCompleted = false;
    app.get('/slow', async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      lateHandlerCompleted = true;
      response.json({ status: 'late-success' });
    });

    const response = await request(app).get('/slow').expect(504);
    expect(response.body).toMatchObject({
      code: 'REQUEST_DEADLINE_EXCEEDED',
      requestId: 'request-12345678',
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(lateHandlerCompleted).toBe(true);
    expect(metrics.renderPrometheus()).toContain('mcap_request_deadline_exceeded_total{request_class="READ"} 1');
  });

  it('aborts the shared signal when the client disconnects', async () => {
    const metrics = new OperationalMetrics();
    const app = withRequestContext(1_000, metrics);
    let started!: () => void;
    const routeStarted = new Promise<void>((resolve) => { started = resolve; });
    let aborted!: (reason: unknown) => void;
    const signalAborted = new Promise<unknown>((resolve) => { aborted = resolve; });
    app.get('/disconnect', (_request, response) => {
      const context = currentRequestContext()!;
      context.signal.addEventListener('abort', () => aborted(context.signal.reason), { once: true });
      started();
      setTimeout(() => response.json({ status: 'too-late' }), 100).unref();
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
    const outgoing = httpRequest({ host: '127.0.0.1', port: address.port, path: '/disconnect' });
    outgoing.on('error', () => undefined);
    outgoing.end();
    await routeStarted;
    outgoing.destroy();

    await expect(signalAborted).resolves.toBeInstanceOf(ClientDisconnectedError);
    expect(metrics.renderPrometheus()).toContain('mcap_http_client_disconnected_total{request_class="READ"} 1');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
