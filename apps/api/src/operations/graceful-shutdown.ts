import type { Server } from 'node:http';

export async function closeGracefully(server: Server, disconnect: () => Promise<void>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          server.closeAllConnections?.();
          reject(new Error('SHUTDOWN_TIMEOUT'));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await disconnect();
  }
}
