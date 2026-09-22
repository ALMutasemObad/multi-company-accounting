import type { PrismaClient } from '@prisma/client';

export type AccountUsageGuardReadiness = {
  complete: boolean;
  enforcementEnabled: boolean;
};

export type ReadinessResult = {
  database: 'ok';
  latencyMs: number;
  accountUsageGuard?: AccountUsageGuardReadiness;
};

export interface ReadinessCheck {
  check(): Promise<ReadinessResult>;
}

export class DatabaseReadinessService implements ReadinessCheck {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly timeoutMs: number,
    private readonly accountUsageGuard?: AccountUsageGuardReadiness,
  ) {}

  async check(): Promise<ReadinessResult> {
    if (this.accountUsageGuard && (!this.accountUsageGuard.complete || !this.accountUsageGuard.enforcementEnabled)) {
      throw new Error('ACCOUNT_USAGE_GUARD_NOT_READY');
    }
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
      return {
        database: 'ok',
        latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
        ...(this.accountUsageGuard ? { accountUsageGuard: this.accountUsageGuard } : {}),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
