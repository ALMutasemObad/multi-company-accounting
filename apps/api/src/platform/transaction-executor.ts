import { Prisma, type PrismaClient } from "@prisma/client";
import { logEvent } from "../operations/logger.js";
import { operationalMetrics, type OperationalMetricsSink } from "../operations/metrics.js";
import {
  ClientDisconnectedError,
  currentRequestContext,
  markRequestDeadlineExceeded,
  RequestDeadlineExceededError,
} from "../operations/request-context.js";

export type TransactionFailureClassification =
  | "DEADLOCK"
  | "LOCK_WAIT_TIMEOUT"
  | "WRITE_CONFLICT"
  | "UNIQUE_CONFLICT"
  | "NON_RETRYABLE";

export class TransactionRetryExhaustedError extends Error {
  readonly code = "CONCURRENCY_RETRY_EXHAUSTED";

  constructor(
    public readonly operation: string,
    public readonly classification: Exclude<
      TransactionFailureClassification,
      "UNIQUE_CONFLICT" | "NON_RETRYABLE"
    >,
    options: { cause: unknown },
  ) {
    super(`Transaction retries exhausted for ${operation}`, options);
  }
}

export class TransactionDeadlineExceededError extends RequestDeadlineExceededError {
  constructor(
    operation: string,
    options?: { cause?: unknown },
  ) {
    super(operation, options);
    this.name = "TransactionDeadlineExceededError";
  }
}

type ErrorWithDatabaseCode = {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  sqlMessage?: unknown;
  meta?: unknown;
  cause?: unknown;
};

function databaseErrorSignal(error: unknown) {
  const parts: string[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const candidate = value as ErrorWithDatabaseCode & Record<string, unknown>;
    for (const key of [
      "code",
      "errno",
      "message",
      "sqlMessage",
      "originalCode",
      "originalMessage",
      "error",
      "meta",
      "cause",
      "driverAdapterError",
    ]) {
      visit(candidate[key], depth + 1);
    }
  };
  visit(error, 0);
  return parts.join(" ");
}

const isDeadlockSignal = (signal: string) =>
  /(^|\D)1213(\D|$)|ER_LOCK_DEADLOCK/i.test(signal);
const isLockWaitTimeoutSignal = (signal: string) =>
  /(^|\D)1205(\D|$)|ER_LOCK_WAIT_TIMEOUT/i.test(signal);

function isTransactionTimeoutError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2028" &&
    /timeout|timed out|expired transaction/i.test(databaseErrorSignal(error))
  );
}

export function classifyTransactionError(
  error: unknown,
): TransactionFailureClassification {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return "WRITE_CONFLICT";
    if (error.code === "P2002") return "UNIQUE_CONFLICT";
    if (error.code === "P2010") {
      const signal = databaseErrorSignal(error);
      if (isDeadlockSignal(signal)) return "DEADLOCK";
      if (isLockWaitTimeoutSignal(signal)) return "LOCK_WAIT_TIMEOUT";
    }
  }

  const signal = databaseErrorSignal(error);
  if (isDeadlockSignal(signal)) return "DEADLOCK";
  if (isLockWaitTimeoutSignal(signal)) return "LOCK_WAIT_TIMEOUT";
  return "NON_RETRYABLE";
}

export function transactionBackoffMs(
  failedAttempt: number,
  baseDelayMs: number,
  random: () => number,
) {
  const ceiling = baseDelayMs * 2 ** Math.max(0, failedAttempt - 1);
  return Math.max(1, Math.floor(random() * ceiling));
}

export type TransactionExecutionOptions = {
  operation: string;
  companyId?: bigint;
  requestId?: string;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxAttempts?: number;
  baseDelayMs?: number;
  deadlineMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
  maxWaitMs?: number;
  timeoutMs?: number;
};

type TransactionExecutorDependencies = {
  now: () => number;
  random: () => number;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  log: (
    level: "info" | "error",
    event: string,
    details: Record<string, unknown>,
  ) => void;
  metrics: OperationalMetricsSink;
};

const defaults: TransactionExecutorDependencies = {
  now: () => Date.now(),
  random: Math.random,
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const completed = () => {
        signal?.removeEventListener("abort", aborted);
        resolve();
      };
      const timer = setTimeout(completed, milliseconds);
      const aborted = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        reject(signal?.reason instanceof Error ? signal.reason : new ClientDisconnectedError("TRANSACTION_BACKOFF"));
      };
      timer.unref();
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) aborted();
    }),
  log: logEvent,
  metrics: operationalMetrics,
};

export class TransactionExecutor {
  private readonly dependencies: TransactionExecutorDependencies;

  constructor(
    private readonly prisma: PrismaClient,
    dependencies: Partial<TransactionExecutorDependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async execute<T>(
    options: TransactionExecutionOptions,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 25;
    const deadlineMs = options.deadlineMs ?? 15_000;
    const maxWaitMs = options.maxWaitMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? 8_000;
    const isolationLevel =
      options.isolationLevel ?? Prisma.TransactionIsolationLevel.Serializable;
    const startedAt = this.dependencies.now();
    const requestContext = currentRequestContext();
    const signal = options.signal ?? requestContext?.signal;
    const requestId = options.requestId ?? requestContext?.requestId;
    const deadlineAt = Math.min(
      startedAt + deadlineMs,
      options.deadlineAt ?? Number.POSITIVE_INFINITY,
      requestContext?.deadlineAt ?? Number.POSITIVE_INFINITY,
    );
    const resolvedOptions = { ...options, ...(requestId ? { requestId } : {}) };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.throwIfCancelled(signal, options.operation, attempt, resolvedOptions, startedAt);
      const remainingMs = deadlineAt - this.dependencies.now();
      if (remainingMs <= 0) {
        this.logDeadline(resolvedOptions, attempt, startedAt);
        throw new TransactionDeadlineExceededError(options.operation);
      }

      const attemptStartedAt = this.dependencies.now();
      this.dependencies.metrics.recordTransactionAttempt(options.operation);
      let result: T;
      try {
        result = await this.prisma.$transaction(work, {
          isolationLevel,
          maxWait: Math.max(1, Math.min(maxWaitMs, remainingMs)),
          timeout: Math.max(1, Math.min(timeoutMs, remainingMs)),
        });
      } catch (error) {
        const attemptDurationMs = this.dependencies.now() - attemptStartedAt;
        if (error instanceof ClientDisconnectedError || signal?.reason instanceof ClientDisconnectedError) {
          this.dependencies.metrics.recordTransactionDuration(options.operation, "CLIENT_DISCONNECTED", attemptDurationMs);
          throw signal?.reason instanceof ClientDisconnectedError ? signal.reason : error;
        }
        if (
          error instanceof RequestDeadlineExceededError ||
          signal?.reason instanceof RequestDeadlineExceededError ||
          isTransactionTimeoutError(error) ||
          this.dependencies.now() >= deadlineAt
        ) {
          this.dependencies.metrics.recordTransactionDuration(options.operation, "DEADLINE", attemptDurationMs);
          this.logDeadline(resolvedOptions, attempt, startedAt);
          throw new TransactionDeadlineExceededError(options.operation, {
            cause: error,
          });
        }
        const classification = classifyTransactionError(error);
        this.dependencies.metrics.recordTransactionDuration(options.operation, classification, attemptDurationMs);
        if (
          classification === "NON_RETRYABLE" ||
          classification === "UNIQUE_CONFLICT"
        ) {
          throw error;
        }

        const commonDetails = {
          operation: options.operation,
          classification,
          ...(options.companyId !== undefined
            ? { companyId: options.companyId.toString() }
            : {}),
          ...(requestId !== undefined
            ? { requestId }
            : {}),
          attempt,
          durationMs: this.dependencies.now() - startedAt,
        };
        this.dependencies.metrics.recordTransactionFailure(options.operation, classification);
        this.dependencies.log("info", "db_transaction_retryable_failure", {
          ...commonDetails,
          metric:
            classification === "DEADLOCK"
              ? "db_deadlock_total"
              : classification === "LOCK_WAIT_TIMEOUT"
                ? "db_lock_wait_timeout_total"
                : "transaction_write_conflict_total",
        });

        if (attempt >= maxAttempts) {
          this.dependencies.metrics.recordTransactionRetryExhausted(options.operation, classification);
          this.dependencies.log("error", "db_transaction_retry_exhausted", {
            ...commonDetails,
            metric: "transaction_retry_exhausted_total",
          });
          throw new TransactionRetryExhaustedError(
            options.operation,
            classification,
            { cause: error },
          );
        }

        const delayMs = transactionBackoffMs(
          attempt,
          baseDelayMs,
          this.dependencies.random,
        );
        if (this.dependencies.now() + delayMs >= deadlineAt) {
          this.logDeadline(resolvedOptions, attempt, startedAt);
          throw new TransactionDeadlineExceededError(options.operation, {
            cause: error,
          });
        }
        this.dependencies.metrics.recordTransactionRetry(options.operation, classification);
        this.dependencies.log("info", "db_transaction_retry_scheduled", {
          ...commonDetails,
          metric: "transaction_retry_total",
          delayMs,
        });
        if (signal) await this.dependencies.sleep(delayMs, signal);
        else await this.dependencies.sleep(delayMs);
        this.throwIfCancelled(signal, options.operation, attempt, resolvedOptions, startedAt);
        continue;
      }

      const attemptDurationMs = this.dependencies.now() - attemptStartedAt;
      if (signal?.aborted || this.dependencies.now() >= deadlineAt) {
        this.dependencies.metrics.recordTransactionDuration(options.operation, signal?.reason instanceof ClientDisconnectedError ? "CLIENT_DISCONNECTED" : "DEADLINE", attemptDurationMs);
        if (signal?.reason instanceof ClientDisconnectedError) throw signal.reason;
        this.logDeadline(resolvedOptions, attempt, startedAt);
        throw new TransactionDeadlineExceededError(options.operation, { cause: signal?.reason });
      }
      this.dependencies.metrics.recordTransactionDuration(options.operation, "COMPLETED", attemptDurationMs);
      this.dependencies.log("info", "db_transaction_completed", {
        operation: options.operation,
        ...(options.companyId !== undefined
          ? { companyId: options.companyId.toString() }
          : {}),
        ...(requestId !== undefined
          ? { requestId }
          : {}),
        attempt,
        durationMs: this.dependencies.now() - startedAt,
      });
      return result;
    }

    throw new TransactionRetryExhaustedError(
      options.operation,
      "WRITE_CONFLICT",
      { cause: new Error("Unreachable transaction retry state") },
    );
  }

  private logDeadline(
    options: TransactionExecutionOptions,
    attempt: number,
    startedAt: number,
  ) {
    markRequestDeadlineExceeded(this.dependencies.metrics);
    this.dependencies.log("error", "db_transaction_deadline_exceeded", {
      operation: options.operation,
      ...(options.companyId !== undefined
        ? { companyId: options.companyId.toString() }
        : {}),
      ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
      attempt,
      durationMs: this.dependencies.now() - startedAt,
      metric: "request_deadline_exceeded_total",
    });
  }

  private throwIfCancelled(
    signal: AbortSignal | undefined,
    operation: string,
    attempt: number,
    options: TransactionExecutionOptions,
    startedAt: number,
  ) {
    if (!signal?.aborted) return;
    if (signal.reason instanceof ClientDisconnectedError) throw signal.reason;
    this.logDeadline(options, attempt, startedAt);
    throw new TransactionDeadlineExceededError(operation, {
      cause: signal.reason,
    });
  }
}
