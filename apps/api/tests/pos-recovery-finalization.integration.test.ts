import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import type { ActorContext } from "../src/platform/actor-context.js";
import {
  IdempotentCommandExecutor,
  IdempotentCommandRejection,
  type IdempotentCommandOptions,
} from "../src/platform/idempotent-command-executor.js";
import { TransactionDeadlineExceededError, TransactionExecutor, type TransactionExecutionOptions } from "../src/platform/transaction-executor.js";

/** Prepared DB gate, never enabled merely by inheriting DATABASE_URL.
 * Requires a migrated/seeded isolated local database and explicit coordinator ownership:
 * RUN_DB_TESTS=true, RUN_POS_RECOVERY_FINALIZATION_DB_TESTS=true and
 * POS_RECOVERY_TEST_DATABASE=<the exact local database name>.
 *
 * This verifies real IdempotencyRecord uniqueness, rollback and commit behavior. The
 * effect sentinel is another test-owned Infrastructure row, NOT a financial document;
 * passing it cannot replace POS invoice/receipt/stock/ledger integration acceptance.
 */
const enabled = process.env.RUN_DB_TESTS === "true"
  && process.env.RUN_POS_RECOVERY_FINALIZATION_DB_TESTS === "true";
const OPERATION = "W1_POS_RECOVERY_FINALIZE_TEST";
const EFFECT_OPERATION = "W1_POS_RECOVERY_EFFECT_TEST";
const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
const rejectionBody = {
  kind: "POS_CHECKOUT_REJECTION", version: 1,
  rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INVALID_CASH_BANK_ACCOUNT" },
};
const successBody = { id: "301", invoice: { id: "101" }, receipt: { id: "201" } };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function validRejection(body: unknown) {
  const value = object(body);
  const rejection = object(value?.rejection);
  return Boolean(value && Object.keys(value).length === 3 && value.kind === rejectionBody.kind && value.version === 1
    && rejection && Object.keys(rejection).length === 2
    && rejection.code === rejectionBody.rejection.code && rejection.reason === rejectionBody.rejection.reason);
}
function validSuccess(body: unknown) {
  const value = object(body);
  return Boolean(value && value.id === successBody.id
    && object(value.invoice)?.id === successBody.invoice.id && object(value.receipt)?.id === successBody.receipt.id);
}
class DomainRejection extends Error {}

function barrier() {
  let release!: () => void;
  const reached = new Promise<void>(resolve => { release = resolve; });
  return { reached, release };
}

type TransactionHooks = {
  now?: () => number;
  entered?: (number: number) => void | Promise<void>;
  beforeCommit?: (number: number) => void | Promise<void>;
  afterCommit?: (number: number) => void | Promise<void>;
  afterFailure?: (number: number, error: unknown) => void | Promise<void>;
};

/** Barriers wrap real transactions; they do not fake Prisma reads, inserts or commits. */
class ObservedTransactions extends TransactionExecutor {
  private executions = 0;
  constructor(prisma: PrismaClient, private readonly hooks: TransactionHooks) {
    super(prisma, hooks.now ? { now: hooks.now } : {});
  }
  override async execute<T>(options: TransactionExecutionOptions, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const number = ++this.executions;
    try {
      const result = await super.execute(options, async tx => {
        await this.hooks.entered?.(number);
        const value = await work(tx);
        await this.hooks.beforeCommit?.(number);
        return value;
      });
      await this.hooks.afterCommit?.(number);
      return result;
    } catch (error) {
      await this.hooks.afterFailure?.(number, error);
      throw error;
    }
  }
}

describe.runIf(enabled)("POS rejection finalization on an isolated real database", () => {
  let prisma: PrismaClient | null = null;
  let context: ActorContext | null = null;
  const ownedKeyHashes: Uint8Array<ArrayBuffer>[] = [];

  function database() {
    if (!prisma) throw new Error("POS recovery DB gate is not initialized");
    return prisma;
  }
  function actor() {
    if (!context) throw new Error("POS recovery DB actor is not initialized");
    return context;
  }
  function key() {
    const value = randomUUID();
    ownedKeyHashes.push(digest(value));
    return value;
  }
  function command(attemptKey: string, fingerprint = "same-body"): IdempotentCommandOptions {
    return {
      context: actor(), operation: OPERATION, key: attemptKey, fingerprint, responseStatus: 201,
      errors: { mismatch: () => new Error("IDEMPOTENCY_MISMATCH"), inProgress: () => new Error("IDEMPOTENCY_IN_PROGRESS") },
      terminalRejection: {
        classify: error => error instanceof DomainRejection ? { responseStatus: 422, responseBody: rejectionBody } : null,
        decode: validRejection,
        validateSuccess: validSuccess,
      },
      transaction: { maxWaitMs: 2_000, timeoutMs: 12_000, deadlineMs: 15_000 },
    };
  }
  function executor(hooks: TransactionHooks = {}) {
    return new IdempotentCommandExecutor(database(), new ObservedTransactions(database(), hooks));
  }
  function row(attemptKey: string, operation = OPERATION) {
    return database().idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: {
      ...actor(), operation, keyHash: digest(attemptKey),
    } } });
  }
  async function effect(tx: Prisma.TransactionClient, effectKey: string) {
    await tx.idempotencyRecord.create({ data: {
      ...actor(), operation: EFFECT_OPERATION, keyHash: digest(effectKey),
      requestFingerprint: digest("transactional-effect-sentinel"), status: "COMPLETED",
      responseStatus: 200, responseBody: { effect: true }, completedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    } });
  }

  beforeAll(async () => {
    const rawUrl = process.env.DATABASE_URL;
    const acknowledgedName = process.env.POS_RECOVERY_TEST_DATABASE;
    if (!rawUrl || !acknowledgedName) throw new Error("POS recovery DB gate requires its explicit local database acknowledgement");
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { throw new Error("POS recovery DB gate requires a valid local database URL"); }
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      || !["mysql:", "mariadb:"].includes(parsed.protocol)
      || name !== acknowledgedName || !/^w1pos[_a-z0-9]*$/i.test(name)) {
      throw new Error("POS recovery DB gate refuses non-local or unacknowledged non-test databases");
    }
    prisma = createDatabase(rawUrl, {
      connectionLimit: 4, minimumIdle: 0, acquireTimeoutMs: 2_000,
      connectTimeoutMs: 1_000, idleTimeoutSeconds: 30,
    });
    const membership = await prisma.userCompany.findFirst({
      where: { isActive: true }, select: { companyId: true, userId: true },
    });
    if (!membership) throw new Error("POS recovery DB gate requires an existing seeded local user/company membership");
    context = membership;
  }, 15_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (context && ownedKeyHashes.length) await prisma.idempotencyRecord.deleteMany({ where: {
        companyId: context.companyId, userId: context.userId,
        operation: { in: [OPERATION, EFFECT_OPERATION] }, keyHash: { in: ownedKeyHashes },
      } });
    } finally { await prisma.$disconnect(); }
  }, 15_000);

  it("rolls back the real effect row, seals the refusal and prevents replay work", async () => {
    const attemptKey = key();
    const effectKey = key();
    const service = executor();
    await expect(service.execute(command(attemptKey), async tx => {
      await effect(tx, effectKey);
      throw new DomainRejection("receipt refused after earlier owner work");
    })).rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
    expect(await row(attemptKey)).toMatchObject({
      status: "COMPLETED", responseStatus: 422, responseBody: rejectionBody,
      companyId: actor().companyId, userId: actor().userId,
      keyHash: digest(attemptKey), requestFingerprint: digest("same-body"),
    });
    const work = vi.fn(async () => successBody);
    await expect(service.execute(command(attemptKey), work)).rejects.toBeInstanceOf(IdempotentCommandRejection);
    await expect(service.execute(command(attemptKey, "different-body"), work)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(work).not.toHaveBeenCalled();
  }, 30_000);

  it.each([false, true])("honors a committed rival between rollback and sealing; differentBody=%s", async differentBody => {
    const attemptKey = key();
    const failedEffectKey = key();
    const winningEffectKey = key();
    const rolledBack = barrier();
    const allowFinalization = barrier();
    const refusing = executor({ afterFailure: async (number, error) => {
      if (number === 1 && error instanceof DomainRejection) {
        rolledBack.release();
        await allowFinalization.reached;
      }
    } });
    const pending = refusing.execute(command(attemptKey), async tx => {
      await effect(tx, failedEffectKey);
      throw new DomainRejection("refused");
    }).catch((error: unknown) => error);
    await rolledBack.reached;
    try {
      await expect(executor().execute(command(attemptKey, differentBody ? "different-body" : "same-body"), async tx => {
        await effect(tx, winningEffectKey);
        return successBody;
      })).resolves.toEqual(successBody);
      allowFinalization.release();
      const result = await pending;
      if (differentBody) expect(result).toMatchObject({ message: "IDEMPOTENCY_MISMATCH" });
      else expect(result).toEqual(successBody);
      expect(result).not.toBeInstanceOf(IdempotentCommandRejection);
      expect(await row(failedEffectKey, EFFECT_OPERATION)).toBeNull();
      expect(await row(winningEffectKey, EFFECT_OPERATION)).not.toBeNull();
      expect(await row(attemptKey)).toMatchObject({ responseStatus: 201, responseBody: successBody });
    } finally { allowFinalization.release(); await pending; }
  }, 30_000);

  it("makes two competing sales wait for a terminal insert and replays its rejection to both", async () => {
    const attemptKey = key();
    const terminalInsertHeld = barrier();
    const releaseCommit = barrier();
    const refusing = executor({ beforeCommit: async number => {
      if (number === 2) { terminalInsertHeld.release(); await releaseCommit.reached; }
    } });
    const refusal = refusing.execute(command(attemptKey), async () => { throw new DomainRejection("refused"); })
      .catch((error: unknown) => error);
    await terminalInsertHeld.reached;
    const entered = [barrier(), barrier()];
    const financialWork = vi.fn(async () => successBody);
    const rivals = entered.map(gate => executor({ entered: () => gate.release() })
      .execute(command(attemptKey), financialWork).catch((error: unknown) => error));
    try {
      await Promise.all(entered.map(gate => gate.reached));
      releaseCommit.release();
      for (const result of await Promise.all([refusal, ...rivals])) expect(result).toBeInstanceOf(IdempotentCommandRejection);
      expect(financialWork).not.toHaveBeenCalled();
      expect(await database().idempotencyRecord.count({ where: {
        ...actor(), operation: OPERATION, keyHash: digest(attemptKey),
      } })).toBe(1);
    } finally { releaseCommit.release(); await Promise.all([refusal, ...rivals]); }
  }, 30_000);

  it("converges three simultaneous refusing commands on one durable terminal row", async () => {
    const attemptKey = key();
    const effectKeys = [key(), key(), key()];
    const results = await Promise.all(effectKeys.map(effectKey => executor().execute(command(attemptKey), async tx => {
      await effect(tx, effectKey);
      throw new DomainRejection("refused");
    }).catch((error: unknown) => error)));
    for (const result of results) expect(result).toBeInstanceOf(IdempotentCommandRejection);
    for (const effectKey of effectKeys) expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
    expect(await database().idempotencyRecord.count({ where: {
      ...actor(), operation: OPERATION, keyHash: digest(attemptKey),
    } })).toBe(1);
  }, 30_000);

  it("does not seal an unclassified error and rolls back the real effect", async () => {
    const attemptKey = key();
    const effectKey = key();
    const error = new Error("unclassified owner failure");
    await expect(executor().execute(command(attemptKey), async tx => {
      await effect(tx, effectKey);
      throw error;
    })).rejects.toBe(error);
    expect(await row(attemptKey)).toBeNull();
    expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
  }, 30_000);

  it("does not begin owner work or reserve a row when the deadline already passed", async () => {
    const attemptKey = key();
    const effectKey = key();
    const entered = vi.fn();
    const work = vi.fn(async (tx: Prisma.TransactionClient) => {
      await effect(tx, effectKey);
      return successBody;
    });
    const input = command(attemptKey);
    await expect(executor({ entered }).execute({
      ...input, transaction: { ...input.transaction, deadlineAt: Date.now() - 1 },
    }, work)).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(entered).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(await row(attemptKey)).toBeNull();
    expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
  }, 30_000);

  it("withholds rejection proof when the deadline is observed after the real terminal commit", async () => {
    const attemptKey = key();
    const effectKey = key();
    const deadlineAt = Date.now() + 15_000;
    let observedAfterCommit: number | undefined;
    const beforeCommit = vi.fn((number: number) => {
      if (number === 2) observedAfterCommit = deadlineAt + 1;
    });
    const input = command(attemptKey);
    const service = executor({
      // Only TransactionExecutor's clock is controlled. The callback returns to Prisma,
      // which really commits; its next clock observation models expiry during commit.
      // No sleep, fake database response or fabricated timeout exception is used.
      now: () => observedAfterCommit ?? Date.now(),
      beforeCommit,
    });
    await expect(service.execute({
      ...input, transaction: { ...input.transaction, deadlineAt },
    }, async tx => {
      await effect(tx, effectKey);
      throw new DomainRejection("owner refused before terminal finalization");
    })).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(beforeCommit).toHaveBeenCalledWith(2);
    expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
    expect(await row(attemptKey)).toMatchObject({
      status: "COMPLETED", responseStatus: 422, responseBody: rejectionBody,
    });
    const replayWork = vi.fn(async () => successBody);
    await expect(executor().execute(command(attemptKey), replayWork))
      .rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(replayWork).not.toHaveBeenCalled();
  }, 30_000);

  it("rolls back the terminal insert and withholds proof on a failure before its commit", async () => {
    const attemptKey = key();
    const effectKey = key();
    const failure = new Error("injected failure before terminal transaction commit");
    const terminalCommitAttempts = vi.fn((number: number) => {
      if (number === 2) throw failure;
    });
    await expect(executor({ beforeCommit: terminalCommitAttempts }).execute(command(attemptKey), async tx => {
      await effect(tx, effectKey);
      throw new DomainRejection("owner refused");
    })).rejects.toBe(failure);
    expect(terminalCommitAttempts).toHaveBeenCalledWith(2);
    expect(await row(attemptKey)).toBeNull();
    expect(await row(effectKey, EFFECT_OPERATION)).toBeNull();
  }, 30_000);

  it("never terminalizes a successful real commit whose acknowledgement is lost", async () => {
    const attemptKey = key();
    const effectKey = key();
    const deliveryFailure = new Error("simulated acknowledgement loss after real success commit");
    const entered = vi.fn();
    const service = executor({
      entered,
      afterCommit: number => { if (number === 1) throw deliveryFailure; },
    });
    await expect(service.execute(command(attemptKey), async tx => {
      await effect(tx, effectKey);
      return successBody;
    })).rejects.toBe(deliveryFailure);
    expect(entered).toHaveBeenCalledWith(1);
    expect(entered).not.toHaveBeenCalledWith(2);
    expect(await row(effectKey, EFFECT_OPERATION)).toMatchObject({ status: "COMPLETED", responseBody: { effect: true } });
    expect(await row(attemptKey)).toMatchObject({ status: "COMPLETED", responseStatus: 201, responseBody: successBody });
    const replayWork = vi.fn(async () => successBody);
    await expect(executor().execute(command(attemptKey), replayWork)).resolves.toEqual(successBody);
    expect(replayWork).not.toHaveBeenCalled();
    expect(await database().idempotencyRecord.count({ where: {
      ...actor(), operation: OPERATION, keyHash: digest(attemptKey), responseStatus: 422,
    } })).toBe(0);
  }, 30_000);

  it("keeps the durable rejection recoverable when its response is lost after real commit", async () => {
    const attemptKey = key();
    const deliveryFailure = new Error("simulated delivery loss after real terminal commit");
    const service = executor({ afterCommit: number => { if (number === 2) throw deliveryFailure; } });
    await expect(service.execute(command(attemptKey), async () => { throw new DomainRejection("refused"); }))
      .rejects.toBe(deliveryFailure);
    expect(await row(attemptKey)).toMatchObject({ status: "COMPLETED", responseStatus: 422, responseBody: rejectionBody });
    const work = vi.fn(async () => successBody);
    await expect(executor().execute(command(attemptKey), work)).rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(work).not.toHaveBeenCalled();
  }, 30_000);
});
