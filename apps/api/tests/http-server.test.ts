import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { configureHttpServerTimeouts } from '../src/operations/http-server.js';

describe('HTTP server timeout hierarchy', () => {
  it('sets request, header and keep-alive timeouts explicitly', () => {
    const server = createServer();
    configureHttpServerTimeouts(server, {
      requestTimeoutMs: 70_000,
      headersTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
    });
    expect(server.requestTimeout).toBe(70_000);
    expect(server.headersTimeout).toBe(10_000);
    expect(server.keepAliveTimeout).toBe(5_000);
  });
});
