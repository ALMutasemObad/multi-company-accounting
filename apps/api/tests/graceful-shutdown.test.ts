import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { closeGracefully } from '../src/operations/graceful-shutdown.js';

describe('graceful shutdown', () => {
  it('stops accepting connections and disconnects the database', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let disconnected = false;
    await closeGracefully(server, async () => { disconnected = true; }, 1_000);
    expect(server.listening).toBe(false);
    expect(disconnected).toBe(true);
  });
});
