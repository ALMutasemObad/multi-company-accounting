import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { logEvent } from '../operations/logger.js';
import { operationalMetrics, type OperationalMetricsSink } from '../operations/metrics.js';
import { PermanentOutboxError, type OutboxEnvelope, type OutboxHandler } from './outbox.js';

export type OutboxWorkerOptions = {
  pollIntervalMs: number;
  leaseMs: number;
  batchSize: number;
  baseBackoffMs: number;
  handlerTimeoutMs: number;
  retentionDays: number;
  now?: () => Date;
  random?: () => number;
  metrics?: OperationalMetricsSink;
};

type ClaimedEvent = OutboxEnvelope & { lockToken: string };

const MAX_BACKOFF_MS = 60 * 60_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;
const CLEANUP_BATCH_SIZE = 1_000;
const HEALTH_INTERVAL_MS = 60_000;

export function outboxBackoffMs(attempt: number, baseBackoffMs: number, random: () => number = Math.random) {
  const ceiling = Math.min(MAX_BACKOFF_MS, baseBackoffMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.floor(random() * ceiling));
}

function safeErrorCode(error: unknown) {
  if (error instanceof PermanentOutboxError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)) return error.message;
  if (error instanceof Error) return error.name.replaceAll(/[^A-Za-z0-9_]/gu, '_').toUpperCase().slice(0, 80) || 'ERROR';
  return 'UNKNOWN_ERROR';
}

export class OutboxWorker {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly metrics: OperationalMetricsSink;
  private running = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | undefined;
  private sleepController: AbortController | undefined;
  private handlerController: AbortController | undefined;
  private nextCleanupAt = 0;
  private nextHealthAt = 0;
  private lastCycleErrorLogAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly handlers: ReadonlyMap<string, OutboxHandler>,
    private readonly options: OutboxWorkerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.metrics = options.metrics ?? operationalMetrics;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.nextCleanupAt = 0;
    this.nextHealthAt = 0;
    this.lastCycleErrorLogAt = 0;
    logEvent('info', 'outbox_worker_started', {
      pollIntervalMs: this.options.pollIntervalMs,
      batchSize: this.options.batchSize,
      leaseMs: this.options.leaseMs,
    });
    this.loopPromise = this.loop();
  }

  async stop() {
    if (!this.running) return;
    this.stopRequested = true;
    this.sleepController?.abort();
    this.handlerController?.abort(new Error('OUTBOX_WORKER_STOPPED'));
    await this.loopPromise;
    logEvent('info', 'outbox_worker_stopped');
  }

  async runOnce() {
    let processed = 0;
    const attemptedIds: bigint[] = [];
    for (let index = 0; index < this.options.batchSize; index += 1) {
      const event = await this.claimOne(attemptedIds);
      if (!event) break;
      attemptedIds.push(event.id);
      await this.handleClaim(event);
      processed += 1;
    }
    return processed;
  }

  async cleanupProcessed() {
    const cutoff = new Date(this.now().getTime() - this.options.retentionDays * 86_400_000);
    const expired = await this.prisma.outboxEvent.findMany({
      where: { status: 'PROCESSED', processedAt: { lt: cutoff } },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    if (!expired.length) return 0;
    const removed = await this.prisma.outboxEvent.deleteMany({ where: { id: { in: expired.map(({ id }) => id) }, status: 'PROCESSED' } });
    return removed.count;
  }

  private async loop() {
    try {
      while (!this.stopRequested) {
        try {
          const processed = await this.runOnce();
          const timestamp = this.now().getTime();
          if (timestamp >= this.nextCleanupAt) {
            const removed = await this.cleanupProcessed();
            if (removed) logEvent('info', 'outbox_cleanup_completed', { removed });
            this.nextCleanupAt = timestamp + (removed === CLEANUP_BATCH_SIZE ? this.options.pollIntervalMs : CLEANUP_INTERVAL_MS);
          }
          if (timestamp >= this.nextHealthAt) {
            await this.reportHealth();
            this.nextHealthAt = timestamp + HEALTH_INTERVAL_MS;
          }
          if (processed === 0) await this.waitForPoll();
        } catch (error) {
          const failedAt = this.now().getTime();
          if (failedAt - this.lastCycleErrorLogAt >= 60_000) {
            logEvent('error', 'outbox_worker_cycle_failed', { errorCode: safeErrorCode(error) });
            this.lastCycleErrorLogAt = failedAt;
          }
          await this.waitForPoll();
        }
      }
    } finally {
      this.running = false;
      this.loopPromise = undefined;
      this.sleepController = undefined;
      this.handlerController = undefined;
    }
  }

  private async waitForPoll() {
    if (this.stopRequested) return;
    const controller = new AbortController();
    this.sleepController = controller;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.options.pollIntervalMs);
      timer.unref();
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    if (this.sleepController === controller) this.sleepController = undefined;
  }

  private async reportHealth() {
    const [groups, oldest] = await Promise.all([
      this.prisma.outboxEvent.groupBy({
        by: ['status'],
        where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);
    const count = (status: 'PENDING' | 'PROCESSING' | 'FAILED') => groups.find((group) => group.status === status)?._count._all ?? 0;
    const snapshot = {
      pending: count('PENDING'),
      processing: count('PROCESSING'),
      failed: count('FAILED'),
      oldestLagMs: oldest ? Math.max(0, this.now().getTime() - oldest.occurredAt.getTime()) : 0,
    };
    this.metrics.recordOutboxSnapshot(snapshot);
    logEvent('info', 'outbox_health_snapshot', snapshot);
  }

  private async claimOne(excludedIds: readonly bigint[]): Promise<ClaimedEvent | null> {
    for (let collision = 0; collision < 3; collision += 1) {
      const claimedAt = this.now();
      const leaseExpiredBefore = new Date(claimedAt.getTime() - this.options.leaseMs);
      const claimable: Prisma.OutboxEventWhereInput = {
        ...(excludedIds.length ? { id: { notIn: [...excludedIds] } } : {}),
        availableAt: { lte: claimedAt },
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', lockedAt: { lte: leaseExpiredBefore } },
        ],
      };
      const candidate = await this.prisma.outboxEvent.findFirst({
        where: claimable,
        orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      });
      if (!candidate) return null;
      const lockToken = randomUUID();
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: { AND: [{ id: candidate.id }, claimable] },
        data: {
          status: 'PROCESSING',
          lockedAt: claimedAt,
          lockToken,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count === 1) {
        return {
          id: candidate.id,
          eventId: candidate.eventId,
          eventType: candidate.eventType,
          schemaVersion: candidate.schemaVersion,
          aggregateType: candidate.aggregateType,
          aggregateId: candidate.aggregateId,
          companyId: candidate.companyId,
          payload: candidate.payload,
          occurredAt: candidate.occurredAt,
          attemptCount: candidate.attemptCount + 1,
          maxAttempts: candidate.maxAttempts,
          lockToken,
        };
      }
    }
    return null;
  }

  private async handleClaim(event: ClaimedEvent) {
    const handler = this.handlers.get(event.eventType);
    if (!handler) {
      await this.finishFailure(event, new PermanentOutboxError('OUTBOX_HANDLER_NOT_FOUND'));
      return;
    }

    const controller = new AbortController();
    this.handlerController = controller;
    let rejectTimeout: ((reason: Error) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      const error = new Error('OUTBOX_HANDLER_TIMEOUT');
      controller.abort(error);
      rejectTimeout?.(error);
    }, this.options.handlerTimeoutMs);
    timer.unref();
    try {
      await Promise.race([handler(event, controller.signal), timeout]);
      if (controller.signal.aborted) throw controller.signal.reason;
      const completedAt = this.now();
      const completed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'PROCESSING', lockToken: event.lockToken },
        data: {
          status: 'PROCESSED',
          processedAt: completedAt,
          lockedAt: null,
          lockToken: null,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
      if (completed.count !== 1) {
        logEvent('error', 'outbox_event_lease_lost', { eventId: event.eventId, eventType: event.eventType, attempt: event.attemptCount });
        return;
      }
      logEvent('info', 'outbox_event_processed', {
        eventId: event.eventId,
        eventType: event.eventType,
        attempt: event.attemptCount,
        lagMs: Math.max(0, completedAt.getTime() - event.occurredAt.getTime()),
      });
      this.metrics.recordOutboxProcessed(event.eventType, Math.max(0, completedAt.getTime() - event.occurredAt.getTime()));
    } catch (error) {
      await this.finishFailure(event, error);
    } finally {
      clearTimeout(timer);
      if (this.handlerController === controller) this.handlerController = undefined;
    }
  }

  private async finishFailure(event: ClaimedEvent, error: unknown) {
    const errorCode = safeErrorCode(error);
    const failedAt = this.now();
    const terminal = error instanceof PermanentOutboxError || event.attemptCount >= event.maxAttempts;
    const retryAfterMs = terminal ? 0 : outboxBackoffMs(event.attemptCount, this.options.baseBackoffMs, this.random);
    const updated = await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: 'PROCESSING', lockToken: event.lockToken },
      data: terminal ? {
        status: 'FAILED',
        lockedAt: null,
        lockToken: null,
        lastErrorCode: errorCode,
        lastErrorAt: failedAt,
      } : {
        status: 'PENDING',
        availableAt: new Date(failedAt.getTime() + retryAfterMs),
        lockedAt: null,
        lockToken: null,
        lastErrorCode: errorCode,
        lastErrorAt: failedAt,
      },
    });
    if (updated.count !== 1) {
      logEvent('error', 'outbox_event_failure_tracking_lost', { eventId: event.eventId, eventType: event.eventType, attempt: event.attemptCount });
      return;
    }
    if (terminal) {
      this.metrics.recordOutboxDeadLetter(event.eventType);
      logEvent('error', 'outbox_event_dead_lettered', { eventId: event.eventId, eventType: event.eventType, attempt: event.attemptCount, errorCode });
    } else {
      this.metrics.recordOutboxRetry(event.eventType);
      logEvent('info', 'outbox_event_retry_scheduled', { eventId: event.eventId, eventType: event.eventType, attempt: event.attemptCount, errorCode, retryAfterMs });
    }
  }
}
