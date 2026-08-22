import type { Server } from 'node:http';

export type HttpServerTimeouts = {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
};

export function configureHttpServerTimeouts(server: Server, timeouts: HttpServerTimeouts) {
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  return server;
}
