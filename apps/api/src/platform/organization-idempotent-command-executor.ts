import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertRequestActive } from "../operations/request-context.js";
import { classifyTransactionError, TransactionDeadlineExceededError, TransactionExecutor } from "./transaction-executor.js";

export class OrganizationIdempotencyError extends Error {
  constructor(public readonly reason: "IDEMPOTENCY_MISMATCH" | "IDEMPOTENCY_IN_PROGRESS") { super(reason); }
}

/** Infrastructure owns this store. expiresAt is a retention floor, never a replay reset. */
export class OrganizationIdempotentCommandExecutor {
  private readonly transactions: TransactionExecutor;
  constructor(private readonly prisma: PrismaClient) { this.transactions = new TransactionExecutor(prisma); }

  async execute<T extends Prisma.InputJsonObject>(options: {
    organizationId: bigint; userId: bigint; operation: string; key: string; fingerprint: string;
    authorize: (tx: Prisma.TransactionClient) => Promise<void>;
    decode: (body: Prisma.JsonValue) => T;
  }, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
    const keyHash = digest(options.key);
    const requestFingerprint = digest(options.fingerprint);
    const where = { organizationId_userId_operation_keyHash: {
      organizationId: options.organizationId, userId: options.userId, operation: options.operation, keyHash,
    } };
    const deadlineAt = Date.now() + 45_000;
    const budget = () => {
      assertRequestActive(options.operation);
      if (Date.now() >= deadlineAt) throw new TransactionDeadlineExceededError(options.operation);
    };
    const transaction = {
      operation: options.operation, deadlineAt, deadlineMs: 45_000, maxWaitMs: 5_000, timeoutMs: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    };
    const resolve = (record: { requestFingerprint: Uint8Array; status: string; responseBody: Prisma.JsonValue | null }) => {
      if (!Buffer.from(record.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new OrganizationIdempotencyError("IDEMPOTENCY_MISMATCH");
      if (record.status !== "COMPLETED" || record.responseBody === null) throw new OrganizationIdempotencyError("IDEMPOTENCY_IN_PROGRESS");
      return options.decode(record.responseBody);
    };
    try {
      return await this.transactions.execute(transaction, async (tx) => {
        // Lock and recheck Identity before reading even a previously committed result.
        await options.authorize(tx);
        const existing = await tx.organizationIdempotencyRecord.findUnique({ where });
        if (existing) return resolve(existing);
        const record = await tx.organizationIdempotencyRecord.create({ data: {
          ...where.organizationId_userId_operation_keyHash, requestFingerprint,
          status: "IN_PROGRESS", expiresAt: new Date(Date.now() + 86_400_000),
        } });
        const result = await work(tx);
        budget();
        await tx.organizationIdempotencyRecord.update({ where: { id: record.id }, data: {
          status: "COMPLETED", responseStatus: 201, responseBody: result, completedAt: new Date(),
        } });
        return result;
      });
    } catch (error) {
      if (classifyTransactionError(error) !== "UNIQUE_CONFLICT") throw error;
      budget();
      // A fresh authorized transaction observes a committed winner, never a failed snapshot.
      return this.transactions.execute(transaction, async (tx) => {
        await options.authorize(tx);
        const existing = await tx.organizationIdempotencyRecord.findUnique({ where });
        budget();
        if (!existing) throw error;
        return resolve(existing);
      });
    }
  }
}
