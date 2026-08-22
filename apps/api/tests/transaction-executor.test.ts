import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OperationalMetrics } from "../src/operations/metrics.js";
import {
  ClientDisconnectedError,
  runWithRequestContext,
  type RequestExecutionContext,
} from "../src/operations/request-context.js";
import {
  classifyTransactionError,
  TransactionDeadlineExceededError,
  TransactionExecutor,
  TransactionRetryExhaustedError,
  transactionBackoffMs,
} from "../src/platform/transaction-executor.js";

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("database failure", {
    code,
    clientVersion: "test",
    ...(meta ? { meta } : {}),
  });

describe("transaction error classification", () => {
  it("distinguishes retryable failures from unique business conflicts", () => {
    expect(classifyTransactionError(knownError("P2034"))).toBe(
      "WRITE_CONFLICT",
    );
    expect(classifyTransactionError(knownError("P2002"))).toBe(
      "UNIQUE_CONFLICT",
    );
    expect(classifyTransactionError(knownError("P2010", { code: "1213" }))).toBe(
      "DEADLOCK",
    );
    expect(classifyTransactionError(knownError("P2010", { code: "1205" }))).toBe(
      "LOCK_WAIT_TIMEOUT",
    );
    expect(
      classifyTransactionError(
        knownError("P2010", {
          driverAdapterError: {
            cause: { message: "Deadlock found when trying to get lock (1213)" },
          },
        }),
      ),
    ).toBe("DEADLOCK");
    expect(
      classifyTransactionError(
        knownError("P2010", {
          message: "Raw query failed: Lock wait timeout exceeded; code 1205",
        }),
      ),
    ).toBe("LOCK_WAIT_TIMEOUT");
    expect(classifyTransactionError(new Error("business rule"))).toBe(
      "NON_RETRYABLE",
    );
    expect(classifyTransactionError(new Error("business deadlock rule"))).toBe(
      "NON_RETRYABLE",
    );
  });

  it("uses bounded exponential full jitter", () => {
    expect(transactionBackoffMs(1, 25, () => 0.5)).toBe(12);
    expect(transactionBackoffMs(2, 25, () => 0.5)).toBe(25);
    expect(transactionBackoffMs(3, 25, () => 0.5)).toBe(50);
    expect(transactionBackoffMs(1, 25, () => 0)).toBe(1);
  });
});

describe("TransactionExecutor", () => {
  it("restarts the complete transaction after a classified write conflict", async () => {
    let transactionAttempt = 0;
    let clock = 0;
    const transaction = vi.fn(async (work: (tx: object) => Promise<string>) => {
      transactionAttempt += 1;
      const result = await work({});
      if (transactionAttempt === 1) throw knownError("P2034");
      return result;
    });
    const work = vi.fn(async () => "posted");
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      {
        now: () => clock,
        random: () => 0.5,
        sleep,
        log: vi.fn(),
      },
    );

    await expect(
      executor.execute({ operation: "POST_TEST" }, work),
    ).resolves.toBe("posted");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(12);
  });

  it("never retries P2002 unique conflicts", async () => {
    const transaction = vi.fn().mockRejectedValue(knownError("P2002"));
    const sleep = vi.fn();
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      { sleep, log: vi.fn() },
    );

    await expect(
      executor.execute({ operation: "POST_TEST" }, async () => "unused"),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns an exhausted error after the bounded attempt count", async () => {
    let clock = 0;
    const transaction = vi.fn().mockRejectedValue(knownError("P2034"));
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      {
        now: () => clock,
        random: () => 0.5,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
        log: vi.fn(),
      },
    );

    await expect(
      executor.execute(
        { operation: "POST_TEST", maxAttempts: 3 },
        async () => "unused",
      ),
    ).rejects.toBeInstanceOf(TransactionRetryExhaustedError);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("does not start another attempt when backoff exceeds the shared deadline", async () => {
    const transaction = vi.fn().mockRejectedValue(knownError("P2034"));
    const sleep = vi.fn();
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      {
        now: () => 0,
        random: () => 0.9,
        sleep,
        log: vi.fn(),
      },
    );

    await expect(
      executor.execute(
        { operation: "POST_TEST", deadlineMs: 10 },
        async () => "unused",
      ),
    ).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps a confirmed Prisma transaction timeout to the shared deadline error", async () => {
    const transaction = vi.fn().mockRejectedValue(
      knownError("P2028", {
        error:
          "Transaction already closed: A query cannot run on an expired transaction after a 8000 ms timeout",
      }),
    );
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      { log: vi.fn() },
    );

    await expect(
      executor.execute({ operation: "POST_TEST" }, async () => "unused"),
    ).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("inherits the absolute HTTP deadline and never resets its budget", async () => {
    let clock = 100;
    let transactionOptions: { maxWait: number; timeout: number } | undefined;
    const transaction = vi.fn(async (work: (tx: object) => Promise<string>, options: { maxWait: number; timeout: number }) => {
      transactionOptions = options;
      clock = 101;
      return work({});
    });
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      { now: () => clock, log: vi.fn(), metrics: new OperationalMetrics() },
    );
    const controller = new AbortController();
    const context: RequestExecutionContext = {
      requestId: "request-context-123",
      requestClass: "WRITE",
      startedAt: 100,
      deadlineAt: 105,
      signal: controller.signal,
      deadlineMetricRecorded: false,
    };

    await expect(runWithRequestContext(context, () => executor.execute(
      { operation: "POST_TEST", deadlineMs: 15_000, maxWaitMs: 2_000, timeoutMs: 8_000 },
      async () => "posted",
    ))).resolves.toBe("posted");
    expect(transactionOptions).toMatchObject({ maxWait: 5, timeout: 5 });
  });

  it("does not return a late success when the absolute deadline passes during commit", async () => {
    let clock = 100;
    const transaction = vi.fn(async (work: (tx: object) => Promise<string>) => {
      const result = await work({});
      clock = 106;
      return result;
    });
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      { now: () => clock, log: vi.fn(), metrics: new OperationalMetrics() },
    );

    await expect(executor.execute(
      { operation: "POST_TEST", deadlineAt: 105 },
      async () => "committed-result",
    )).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("does not start a transaction or retry after the client disconnects", async () => {
    const transaction = vi.fn().mockRejectedValue(knownError("P2034"));
    const controller = new AbortController();
    const sleep = vi.fn(async () => {
      controller.abort(new ClientDisconnectedError("POST_TEST"));
    });
    const executor = new TransactionExecutor(
      { $transaction: transaction } as unknown as PrismaClient,
      { sleep, log: vi.fn(), metrics: new OperationalMetrics() },
    );

    await expect(executor.execute(
      { operation: "POST_TEST", signal: controller.signal },
      async () => "unused",
    )).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledOnce();

    const alreadyDisconnected = new AbortController();
    alreadyDisconnected.abort(new ClientDisconnectedError("POST_TEST"));
    await expect(executor.execute(
      { operation: "POST_TEST", signal: alreadyDisconnected.signal },
      async () => "unused",
    )).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
