import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/database.js';
import { OperationalMetrics } from '../src/operations/metrics.js';
import { TransactionExecutor } from '../src/platform/transaction-executor.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)('bounded operational load on the configured database engine', () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('completes sixteen concurrent measured transactions within bounded attempt and deadline settings', async () => {
    const metrics = new OperationalMetrics({ minimumTransactionSamples: 10_000 });
    const executor = new TransactionExecutor(prisma!, { metrics, log: vi.fn() });
    const results = await Promise.all(Array.from({ length: 16 }, (_value, index) => executor.execute({
      operation: 'OPERATIONAL_LOAD_PROBE',
      maxAttempts: 2,
      maxWaitMs: 5_000,
      timeoutMs: 3_000,
      deadlineMs: 10_000,
    }, async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      return index;
    })));

    expect(results).toEqual(Array.from({ length: 16 }, (_value, index) => index));
    const output = metrics.renderPrometheus();
    expect(output).toContain('mcap_db_transaction_attempt_total{operation="OPERATIONAL_LOAD_PROBE"} 16');
    expect(output).toContain('mcap_db_transaction_duration_seconds_count{operation="OPERATIONAL_LOAD_PROBE",outcome="COMPLETED"} 16');
    expect(output).not.toContain('mcap_transaction_retry_exhausted_total{operation="OPERATIONAL_LOAD_PROBE"');
  }, 30_000);
});
