import type { PrismaClient } from '@prisma/client';

export type ReadinessResult = { database: 'ok'; latencyMs: number };

export interface ReadinessCheck {
  check(): Promise<ReadinessResult>;
}

export class DatabaseReadinessService implements ReadinessCheck {
  constructor(private readonly prisma: PrismaClient, private readonly timeoutMs: number) {}

  async check(): Promise<ReadinessResult> {
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), this.timeoutMs);
          timer.unref();
        }),
      ]);
      return { database: 'ok', latencyMs: Math.round((performance.now() - startedAt) * 100) / 100 };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
