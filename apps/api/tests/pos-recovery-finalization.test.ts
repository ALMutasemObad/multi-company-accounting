import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalMetrics } from "../src/operations/metrics.js";
import {
  IdempotentCommandExecutor,
  IdempotentCommandRejection,
  type IdempotentCommandOptions,
} from "../src/platform/idempotent-command-executor.js";
import { TransactionDeadlineExceededError, TransactionExecutor } from "../src/platform/transaction-executor.js";

const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
const context = { companyId: 71n, userId: 91n };
const attemptKey = "942b2f0e-9e54-4325-a882-420c16b320ba";
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
const terminalRejection = {
  classify: (error: unknown) => error instanceof DomainRejection
    ? { responseStatus: 422 as const, responseBody: rejectionBody }
    : null,
  decode: validRejection,
  validateSuccess: validSuccess,
};
function options(overrides: Partial<IdempotentCommandOptions> = {}): IdempotentCommandOptions {
  return {
    context, operation: "COMPLETE_POS_CHECKOUT", key: attemptKey,
    fingerprint: "same-checkout-body", responseStatus: 201, terminalRejection,
    errors: { mismatch: () => new Error("IDEMPOTENCY_MISMATCH"), inProgress: () => new Error("IDEMPOTENCY_IN_PROGRESS") },
    ...overrides,
  };
}

type Scope = { companyId: bigint; userId: bigint; operation: string; keyHash: Uint8Array };
type Row = Scope & {
  id: bigint; requestFingerprint: Uint8Array; status: string;
  responseStatus: number | null; responseBody: Prisma.JsonValue | null;
  expiresAt: Date; completedAt: Date | null;
};
type State = { records: Map<string, Row>; financialWrites: string[] };
type TransactionOptions = { isolationLevel: string; maxWait: number; timeout: number };
type Hooks = {
  beforeTransaction?: (number: number) => void | Promise<void>;
  beforeCreate?: (number: number) => void | Promise<void>;
  afterRollback?: (number: number, error: unknown) => void | Promise<void>;
  beforeCommit?: (number: number) => void | Promise<void>;
  afterCommit?: (number: number) => void | Promise<void>;
  afterFreshLookup?: () => void | Promise<void>;
};
const scopeKey = (value: Scope) => `${value.companyId}:${value.userId}:${value.operation}:${Buffer.from(value.keyHash).toString("hex")}`;
const uniqueConflict = () => new Prisma.PrismaClientKnownRequestError("unique test conflict", { code: "P2002", clientVersion: "test" });

/** Serialized transactional fake. Rollback discards all writes; injected commit failures
 * distinguish missing commits from committed rows with a lost acknowledgement. This is
 * a policy test, not evidence of database locking or a financial integration acceptance. */
function harness(hooks: Hooks = {}) {
  let committed: State = { records: new Map(), financialWrites: [] };
  let queue: Promise<void> = Promise.resolve();
  let transactionNumber = 0;
  let clock = 1_800_000_000_000;
  const transactions: Array<{ number: number; options: TransactionOptions }> = [];
  const drafts = new WeakMap<object, State>();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const clone = (): State => ({
    records: new Map([...committed.records].map(([key, row]) => [key, { ...row }])),
    financialWrites: [...committed.financialWrites],
  });
  const prismaLike = {
    $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, transactionOptions: TransactionOptions) {
      const number = ++transactionNumber;
      transactions.push({ number, options: transactionOptions });
      const pending = queue.then(async () => {
        await hooks.beforeTransaction?.(number);
        const draft = clone();
        const txLike = {
          idempotencyRecord: {
            findUnique: async ({ where }: { where: { companyId_userId_operation_keyHash: Scope } }) =>
              draft.records.get(scopeKey(where.companyId_userId_operation_keyHash)) ?? null,
            create: async ({ data }: { data: Scope & {
              requestFingerprint: Uint8Array; status: string; expiresAt: Date;
              responseStatus?: number; responseBody?: Prisma.JsonValue; completedAt?: Date;
            } }) => {
              await hooks.beforeCreate?.(number);
              const key = scopeKey(data);
              if (draft.records.has(key) || committed.records.has(key)) throw uniqueConflict();
              const row: Row = {
                ...data, id: BigInt(draft.records.size + 1),
                responseStatus: data.responseStatus ?? null,
                responseBody: data.responseBody ?? null, completedAt: data.completedAt ?? null,
              };
              draft.records.set(key, row);
              return row;
            },
            update: async ({ where, data }: { where: { id: bigint }; data: Partial<Row> }) => {
              const row = [...draft.records.values()].find(value => value.id === where.id);
              if (!row) throw new Error("missing test reservation");
              Object.assign(row, data);
              return row;
            },
          },
        };
        const tx = txLike as unknown as Prisma.TransactionClient;
        drafts.set(tx, draft);
        let result: T;
        try {
          result = await work(tx);
          await hooks.beforeCommit?.(number);
        } catch (error) {
          await hooks.afterRollback?.(number, error);
          throw error;
        }
        committed = draft;
        await hooks.afterCommit?.(number);
        return result;
      });
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
    idempotencyRecord: {
      findUnique: async ({ where }: { where: { companyId_userId_operation_keyHash: Scope } }) => {
        const row = committed.records.get(scopeKey(where.companyId_userId_operation_keyHash)) ?? null;
        await hooks.afterFreshLookup?.();
        return row;
      },
    },
  };
  const prisma = prismaLike as unknown as PrismaClient;
  const transactionExecutor = new TransactionExecutor(prisma, {
    now: () => clock, log: vi.fn(), metrics: new OperationalMetrics(),
    random: () => 0, sleep: async milliseconds => { clock += milliseconds; },
  });
  return {
    executor: new IdempotentCommandExecutor(prisma, transactionExecutor),
    transactions,
    state: () => committed,
    advance: (milliseconds: number) => { clock += milliseconds; },
    now: () => clock,
    financialWrite(tx: Prisma.TransactionClient, value: string) {
      const draft = drafts.get(tx);
      if (!draft) throw new Error("write outside test transaction");
      draft.financialWrites.push(value);
    },
    seed(body: Prisma.JsonValue, responseStatus: number, command = options(), status = "COMPLETED") {
      const row: Row = {
        ...command.context, operation: command.operation, keyHash: digest(command.key),
        id: BigInt(committed.records.size + 1), requestFingerprint: digest(command.fingerprint),
        status, responseStatus, responseBody: body,
        completedAt: new Date(clock), expiresAt: new Date(clock + 86_400_000),
      };
      committed.records.set(scopeKey(row), row);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("POS terminal rejection finalization policy", () => {
  it("rolls back owner writes before sealing a rejection and never executes financial replay", async () => {
    const db = harness();
    const work = vi.fn(async (tx: Prisma.TransactionClient) => {
      db.financialWrite(tx, "invoice and stock before receipt refusal");
      throw new DomainRejection("receipt refused");
    });
    await expect(db.executor.execute(options(), work)).rejects.toMatchObject({
      responseStatus: 422, responseBody: rejectionBody,
    });
    expect(db.state().financialWrites).toEqual([]);
    expect([...db.state().records.values()]).toMatchObject([{
      status: "COMPLETED", responseStatus: 422, responseBody: rejectionBody,
    }]);
    const replay = vi.fn(async () => successBody);
    await expect(db.executor.execute(options(), replay)).rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(work).toHaveBeenCalledOnce();
    expect(replay).not.toHaveBeenCalled();
    expect(db.state().records.size).toBe(1);
  });

  it("returns the competing success when it commits between rollback and rejection sealing", async () => {
    let competitor: Promise<typeof successBody> | undefined;
    const db = harness({ afterRollback: number => {
      if (number === 1) competitor = db.executor.execute(options(), async tx => {
        db.financialWrite(tx, "winning sale");
        return successBody;
      });
    } });
    const result = await db.executor.execute(options(), async tx => {
      db.financialWrite(tx, "rolled back sale");
      throw new DomainRejection("first refusal");
    });
    expect(result).toEqual(successBody);
    await expect(competitor).resolves.toEqual(successBody);
    expect(db.state().financialWrites).toEqual(["winning sale"]);
    expect([...db.state().records.values()][0]).toMatchObject({ responseStatus: 201, responseBody: successBody });
  });

  it("prevents a competing sale once rejection sealing wins", async () => {
    const competingWork = vi.fn(async () => successBody);
    let competitor: Promise<unknown> | undefined;
    const db = harness({ beforeCommit: number => {
      if (number === 2) competitor = db.executor.execute(options(), competingWork).catch(error => error);
    } });
    await expect(db.executor.execute(options(), async () => { throw new DomainRejection("refused"); }))
      .rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(await competitor).toBeInstanceOf(IdempotentCommandRejection);
    expect(competingWork).not.toHaveBeenCalled();
    expect(db.state().financialWrites).toEqual([]);
    expect(db.state().records.size).toBe(1);
  });

  it("converges two concurrent rejections on one terminal row", async () => {
    const db = harness();
    const work = vi.fn(async (tx: Prisma.TransactionClient) => {
      db.financialWrite(tx, "rolled back");
      throw new DomainRejection("refused");
    });
    const results = await Promise.allSettled([
      db.executor.execute(options(), work), db.executor.execute(options(), work),
    ]);
    expect(results.map(value => value.status)).toEqual(["rejected", "rejected"]);
    for (const result of results) if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(IdempotentCommandRejection);
      expect(result.reason).toMatchObject({ responseBody: rejectionBody });
    }
    expect(db.state().records.size).toBe(1);
    expect(db.state().financialWrites).toEqual([]);
  });

  it("does not label a different-body winning sale as rejected", async () => {
    let competitor: Promise<unknown> | undefined;
    const db = harness({ afterRollback: number => {
      if (number === 1) competitor = db.executor.execute(options({ fingerprint: "changed-body" }), async tx => {
        db.financialWrite(tx, "different request won");
        return successBody;
      });
    } });
    await expect(db.executor.execute(options(), async () => { throw new DomainRejection("refused"); }))
      .rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(competitor).resolves.toEqual(successBody);
    expect(db.state().financialWrites).toEqual(["different request won"]);
  });

  it("lets one success win against two rejected contenders without duplicate financial work", async () => {
    const db = harness();
    const refused = async (tx: Prisma.TransactionClient) => {
      db.financialWrite(tx, "rolled back contender");
      throw new DomainRejection("refused");
    };
    const winningWork = vi.fn(async (tx: Prisma.TransactionClient) => {
      db.financialWrite(tx, "only committed sale");
      return successBody;
    });
    const results = await Promise.all([
      db.executor.execute(options(), refused),
      db.executor.execute(options(), refused),
      db.executor.execute(options(), winningWork),
    ]);
    expect(results).toEqual([successBody, successBody, successBody]);
    expect(winningWork).toHaveBeenCalledOnce();
    expect(db.state().financialWrites).toEqual(["only committed sale"]);
    expect(db.state().records.size).toBe(1);
  });

  it("checks the fingerprint before replaying a sealed rejection", async () => {
    const db = harness();
    db.seed(rejectionBody, 422);
    const work = vi.fn(async () => successBody);
    await expect(db.executor.execute(options({ fingerprint: "changed-body" }), work))
      .rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(work).not.toHaveBeenCalled();
  });

  it.each(["success", "rejection"] as const)("resolves a P2002 race to the committed %s", async kind => {
    const db = harness({ beforeCreate: number => {
      if (number === 1) db.seed(kind === "success" ? successBody : rejectionBody, kind === "success" ? 201 : 422);
    } });
    const work = vi.fn(async () => successBody);
    const result = db.executor.execute(options(), work);
    if (kind === "success") await expect(result).resolves.toEqual(successBody);
    else await expect(result).rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(work).not.toHaveBeenCalled();
  });

  it("preserves full company, user and operation isolation for the same raw key", async () => {
    const db = harness();
    db.seed(rejectionBody, 422);
    const work = vi.fn(async () => successBody);
    for (const command of [
      options({ context: { ...context, companyId: 72n } }),
      options({ context: { ...context, userId: 92n } }),
      options({ operation: "OTHER_TEST_OPERATION" }),
    ]) await expect(db.executor.execute(command, work)).resolves.toEqual(successBody);
    expect(work).toHaveBeenCalledTimes(3);
    expect(db.state().records.size).toBe(4);
  });

  it("does not terminalize an unclassified owner failure", async () => {
    const db = harness();
    const failure = new Error("network or programming failure");
    await expect(db.executor.execute(options(), async tx => {
      db.financialWrite(tx, "partial work");
      throw failure;
    })).rejects.toBe(failure);
    expect(db.transactions).toHaveLength(1);
    expect(db.state().records.size).toBe(0);
    expect(db.state().financialWrites).toEqual([]);
  });

  it("does not terminalize a classified-looking error before reservation", async () => {
    const failure = new DomainRejection("not from reserved owner work");
    const db = harness({ beforeTransaction: () => { throw failure; } });
    const work = vi.fn(async () => successBody);
    await expect(db.executor.execute(options(), work)).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(db.transactions).toHaveLength(1);
    expect(db.state().records.size).toBe(0);
  });

  it("does not issue proof when rollback returns a different failure", async () => {
    const uncertain = new Error("rollback acknowledgement lost");
    const db = harness({ afterRollback: () => { throw uncertain; } });
    await expect(db.executor.execute(options(), async () => { throw new DomainRejection("refused"); }))
      .rejects.toBe(uncertain);
    expect(db.transactions).toHaveLength(1);
    expect(db.state().records.size).toBe(0);
  });

  it("does not infer rollback from the same domain error when the original reservation survives", async () => {
    const failure = new DomainRejection("returned despite rollback transport failure");
    const db = harness({ afterRollback: number => {
      if (number === 1) db.seed(null, 0, options(), "IN_PROGRESS");
    } });
    await expect(db.executor.execute(options(), async () => { throw failure; }))
      .rejects.toThrow("IDEMPOTENCY_IN_PROGRESS");
    expect([...db.state().records.values()]).toMatchObject([{ status: "IN_PROGRESS", responseBody: null }]);
    expect(db.state().records.size).toBe(1);
    expect(db.state().financialWrites).toEqual([]);
  });

  it("does not classify a lost successful commit acknowledgement as rejection", async () => {
    const uncertain = new Error("successful commit acknowledgement lost");
    const db = harness({ afterCommit: number => { if (number === 1) throw uncertain; } });
    await expect(db.executor.execute(options(), async tx => {
      db.financialWrite(tx, "committed sale");
      return successBody;
    })).rejects.toBe(uncertain);
    expect(db.transactions).toHaveLength(1);
    expect(db.state().financialWrites).toEqual(["committed sale"]);
    expect([...db.state().records.values()][0]).toMatchObject({ responseStatus: 201 });
  });

  it.each(["before", "after"] as const)("does not issue proof for a failure %s rejection commit", async phase => {
    const uncertain = new Error("rejection commit acknowledgement unavailable");
    const db = harness({
      beforeCommit: number => { if (number === 2 && phase === "before") throw uncertain; },
      afterCommit: number => { if (number === 2 && phase === "after") throw uncertain; },
    });
    await expect(db.executor.execute(options(), async () => { throw new DomainRejection("refused"); }))
      .rejects.toBe(uncertain);
    expect(db.state().financialWrites).toEqual([]);
    expect(db.state().records.size).toBe(phase === "after" ? 1 : 0);
  });

  it("does not start financial work after the deadline", async () => {
    const db = harness();
    const work = vi.fn(async () => successBody);
    await expect(db.executor.execute(options({ transaction: { deadlineAt: db.now() } }), work))
      .rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(work).not.toHaveBeenCalled();
    expect(db.transactions).toHaveLength(0);
  });

  it("does not start sealing after rollback consumes the shared deadline", async () => {
    const db = harness({ afterRollback: number => { if (number === 1) db.advance(51); } });
    await expect(db.executor.execute(options({ transaction: { deadlineMs: 50 } }), async () => {
      throw new DomainRejection("refused");
    })).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(db.transactions).toHaveLength(1);
    expect(db.state().records.size).toBe(0);
  });

  it("uses only the remaining original budget for rejection sealing", async () => {
    const db = harness({ afterRollback: number => { if (number === 1) db.advance(40); } });
    await expect(db.executor.execute(options({ transaction: { deadlineMs: 50 } }), async () => {
      throw new DomainRejection("refused");
    })).rejects.toBeInstanceOf(IdempotentCommandRejection);
    expect(db.transactions).toHaveLength(2);
    expect(db.transactions[1]!.options.timeout).toBeLessThanOrEqual(10);
    expect(db.transactions[1]!.options.maxWait).toBeLessThanOrEqual(10);
  });

  it("retains a sealed row but withholds proof when its commit finishes after deadline", async () => {
    const db = harness({ afterCommit: number => { if (number === 2) db.advance(51); } });
    await expect(db.executor.execute(options({ transaction: { deadlineMs: 50 } }), async () => {
      throw new DomainRejection("refused");
    })).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(db.state().records.size).toBe(1);
    expect([...db.state().records.values()][0]).toMatchObject({ responseStatus: 422 });
    expect(db.state().financialWrites).toEqual([]);
  });

  it.each(["reservation", "finalization"] as const)("withholds proof if the %s P2002 fresh read crosses the deadline", async phase => {
    const raceNumber = phase === "reservation" ? 1 : 2;
    const db = harness({
      beforeCreate: number => { if (number === raceNumber) db.seed(rejectionBody, 422); },
      afterFreshLookup: () => db.advance(51),
    });
    const work = vi.fn(async () => {
      if (phase === "finalization") throw new DomainRejection("refused");
      return successBody;
    });
    await expect(db.executor.execute(options({ transaction: { deadlineMs: 50 } }), work))
      .rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(db.state().records.size).toBe(1);
    expect(db.state().financialWrites).toEqual([]);
  });

  it.each(["reservation", "finalization"] as const)("honors an explicit abort signal during the %s fresh read without an HTTP context", async phase => {
    const abort = new AbortController();
    const raceNumber = phase === "reservation" ? 1 : 2;
    const db = harness({
      beforeCreate: number => { if (number === raceNumber) db.seed(rejectionBody, 422); },
      afterFreshLookup: () => abort.abort(new Error("explicit caller cancellation")),
    });
    await expect(db.executor.execute(options({ transaction: { signal: abort.signal } }), async () => {
      if (phase === "finalization") throw new DomainRejection("refused");
      return successBody;
    })).rejects.toBeInstanceOf(TransactionDeadlineExceededError);
    expect(db.state().records.size).toBe(1);
    expect(db.state().financialWrites).toEqual([]);
  });

  it.each([
    { status: 422, body: { arbitrary: "HTTP422 is not proof" } },
    { status: 422, body: { ...rejectionBody, version: 2 } },
    { status: 201, body: { malformed: "success" } },
  ])("fails closed on unsupported persisted status/body: $status", async ({ status, body }) => {
    const db = harness();
    db.seed(body, status);
    const work = vi.fn(async () => successBody);
    await expect(db.executor.execute(options(), work)).rejects.toThrow("IDEMPOTENCY_IN_PROGRESS");
    expect(work).not.toHaveBeenCalled();
  });

  it("keeps legacy non-opted-in commands on rollback-only error semantics", async () => {
    const db = harness();
    const { terminalRejection: _terminal, ...legacy } = options();
    const failure = new DomainRejection("refused");
    await expect(db.executor.execute(legacy, async () => { throw failure; })).rejects.toBe(failure);
    expect(db.transactions).toHaveLength(1);
    expect(db.state().records.size).toBe(0);
  });
});
