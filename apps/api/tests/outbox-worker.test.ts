import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { OutboxWorker, outboxBackoffMs } from '../src/outbox/outbox-worker.js';
import { OperationalMetrics } from '../src/operations/metrics.js';

describe('outbox retry policy', () => {
  it('uses bounded exponential full jitter', () => {
    expect(outboxBackoffMs(1, 1_000, () => 0.5)).toBe(500);
    expect(outboxBackoffMs(2, 1_000, () => 0.5)).toBe(1_000);
    expect(outboxBackoffMs(3, 1_000, () => 0.5)).toBe(2_000);
    expect(outboxBackoffMs(99, 60_000, () => 1)).toBe(3_600_000);
    expect(outboxBackoffMs(1, 1_000, () => 0)).toBe(1);
  });

  it('wakes a sleeping worker and stops it cleanly', async () => {
    const metrics = new OperationalMetrics();
    const outboxEvent = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    const worker = new OutboxWorker({ outboxEvent } as unknown as PrismaClient, new Map(), {
      pollIntervalMs: 60_000,
      leaseMs: 30_000,
      batchSize: 10,
      baseBackoffMs: 1_000,
      handlerTimeoutMs: 8_000,
      retentionDays: 30,
      metrics,
    });
    worker.start();
    await vi.waitFor(() => expect(outboxEvent.groupBy).toHaveBeenCalledOnce());
    expect(metrics.renderPrometheus()).toContain('mcap_outbox_events{status="PENDING"} 0');
    expect(metrics.renderPrometheus()).toContain('mcap_outbox_oldest_lag_seconds 0');
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it('releases a claim when a handler ignores cancellation and exceeds its deadline', async () => {
    const event = {
      id: 1n,
      eventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'NeverCompletes',
      schemaVersion: 1,
      aggregateType: 'TEST',
      aggregateId: '1',
      companyId: 1n,
      payload: {},
      occurredAt: new Date(),
      attemptCount: 0,
      maxAttempts: 3,
    };
    const outboxEvent = {
      findFirst: vi.fn().mockResolvedValue(event),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const worker = new OutboxWorker(
      { outboxEvent } as unknown as PrismaClient,
      new Map([['NeverCompletes', async () => new Promise<void>(() => undefined)]]),
      {
        pollIntervalMs: 60_000,
        leaseMs: 1_000,
        batchSize: 1,
        baseBackoffMs: 10,
        handlerTimeoutMs: 10,
        retentionDays: 30,
        random: () => 0.5,
      },
    );

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(outboxEvent.updateMany).toHaveBeenCalledTimes(2);
    expect(outboxEvent.updateMany.mock.calls[1]?.[0]).toMatchObject({
      data: { status: 'PENDING', lastErrorCode: 'OUTBOX_HANDLER_TIMEOUT', lockedAt: null, lockToken: null },
    });
  });
});
