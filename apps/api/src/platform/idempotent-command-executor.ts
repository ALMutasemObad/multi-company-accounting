import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "./actor-context.js";
import { assertRequestActive, ClientDisconnectedError } from "../operations/request-context.js";
import {
  classifyTransactionError,
  TransactionExecutor,
  TransactionDeadlineExceededError,
  type TransactionExecutionOptions,
} from "./transaction-executor.js";

const DAY_MS = 86_400_000;

const digest = (value: string) =>
  new Uint8Array(createHash("sha256").update(value).digest());

type IdempotencyErrors = {
  mismatch: () => Error;
  inProgress: () => Error;
};

type TerminalRejectionPolicy = {
  classify(error: unknown): { responseStatus: 422; responseBody: Prisma.InputJsonObject } | null;
  decode(body: unknown): boolean;
  validateSuccess(body: unknown): boolean;
};

/** An internal result envelope. The owning context must validate and project its body. */
export class IdempotentCommandRejection extends Error {
  constructor(public readonly responseStatus: number, public readonly responseBody: Prisma.JsonValue) {
    super("IDEMPOTENT_COMMAND_REJECTED");
  }
}

export type IdempotentCommandOptions = {
  context: ActorContext;
  operation: string;
  key: string;
  fingerprint: string;
  errors: IdempotencyErrors;
  responseStatus?: number;
  retentionMs?: number;
  // Opt-in only: a domain-error candidate is not proof until an insert-only fence commits.
  terminalRejection?: TerminalRejectionPolicy;
  transaction?: Omit<
    TransactionExecutionOptions,
    "operation" | "companyId"
  >;
};

export class IdempotentCommandExecutor {
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    transactions?: TransactionExecutor,
  ) {
    this.transactions = transactions ?? new TransactionExecutor(prisma);
  }

  async execute<T>(
    options: IdempotentCommandOptions,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const keyHash = digest(options.key);
    const requestFingerprint = digest(options.fingerprint);
    const startedAt = Date.now();
    const expiresAt = new Date(startedAt + (options.retentionMs ?? DAY_MS));
    const transaction = {
      operation: options.operation,
      companyId: options.context.companyId,
      ...options.transaction,
      ...(options.terminalRejection ? { deadlineAt: Math.min(
        options.transaction?.deadlineAt ?? Number.POSITIVE_INFINITY,
        startedAt + (options.transaction?.deadlineMs ?? 15_000),
      ) } : {}),
    };
    const assertBudget = () => {
      assertRequestActive(`${options.operation}_IDEMPOTENCY_RESOLUTION`);
      if (transaction.signal?.aborted) {
        if (transaction.signal.reason instanceof ClientDisconnectedError) throw transaction.signal.reason;
        throw new TransactionDeadlineExceededError(options.operation, { cause: transaction.signal.reason });
      }
      if (transaction.deadlineAt !== undefined && Date.now() >= transaction.deadlineAt) throw new TransactionDeadlineExceededError(options.operation);
    };
    let candidate: { error: unknown; rejection: NonNullable<ReturnType<TerminalRejectionPolicy["classify"]>> } | null = null;

    try {
      return await this.transactions.execute(
        transaction,
        async (tx) => {
          candidate = null;
          const existing = await tx.idempotencyRecord.findUnique({
            where: {
              companyId_userId_operation_keyHash: {
                companyId: options.context.companyId,
                userId: options.context.userId,
                operation: options.operation,
                keyHash,
              },
            },
          });
          if (existing) {
            return this.resolveExisting<T>(
              existing,
              requestFingerprint,
              options.errors,
              options.terminalRejection,
              options.responseStatus,
            );
          }

          const record = await tx.idempotencyRecord.create({
            data: {
              companyId: options.context.companyId,
              userId: options.context.userId,
              operation: options.operation,
              keyHash,
              requestFingerprint,
              status: "IN_PROGRESS",
              expiresAt,
            },
          });
          let response: T;
          try {
            response = await work(tx);
          } catch (error) {
            const rejection = options.terminalRejection?.classify(error);
            if (rejection) candidate = { error, rejection };
            throw error;
          }
          await tx.idempotencyRecord.update({
            where: { id: record.id },
            data: {
              status: "COMPLETED",
              responseStatus: options.responseStatus ?? 200,
              responseBody: response as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
          return response;
        },
      );
    } catch (error) {
      // Prisma can return the domain error even when its rollback transport failed.
      // Therefore this is only a candidate; unique INSERT/committed winner is the proof.
      const failedWork = candidate as { error: unknown; rejection: NonNullable<ReturnType<TerminalRejectionPolicy["classify"]>> } | null;
      if (failedWork && error === failedWork.error && classifyTransactionError(error) === "NON_RETRYABLE") {
        assertBudget();
        return this.finalizeRejection<T>(options, transaction, keyHash, requestFingerprint, expiresAt, failedWork.rejection, assertBudget);
      }
      if (classifyTransactionError(error) !== "UNIQUE_CONFLICT") throw error;
      assertRequestActive(`${options.operation}_IDEMPOTENCY_RESOLUTION`);
      if (options.terminalRejection) assertBudget();
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          companyId_userId_operation_keyHash: {
            companyId: options.context.companyId,
            userId: options.context.userId,
            operation: options.operation,
            keyHash,
          },
        },
      });
      if (options.terminalRejection) assertBudget();
      if (!existing) throw error;
      return this.resolveExisting<T>(
        existing,
        requestFingerprint,
        options.errors,
        options.terminalRejection,
        options.responseStatus,
      );
    }
  }

  private async finalizeRejection<T>(
    options: IdempotentCommandOptions,
    transaction: TransactionExecutionOptions,
    keyHash: Uint8Array<ArrayBuffer>,
    requestFingerprint: Uint8Array<ArrayBuffer>,
    expiresAt: Date,
    rejection: NonNullable<ReturnType<TerminalRejectionPolicy["classify"]>>,
    assertBudget: () => void,
  ): Promise<T> {
    const where = { companyId_userId_operation_keyHash: {
      companyId: options.context.companyId, userId: options.context.userId,
      operation: options.operation, keyHash,
    } };
    try {
      const winner = await this.transactions.execute(transaction, async tx => {
        const existing = await tx.idempotencyRecord.findUnique({ where });
        if (existing) return existing;
        // No update/upsert and no financial work. INSERT waits for the original transaction
        // or a concurrent checkout, and cannot replace either one's committed outcome.
        return tx.idempotencyRecord.create({ data: {
          ...where.companyId_userId_operation_keyHash, requestFingerprint,
          status: "COMPLETED", responseStatus: rejection.responseStatus,
          responseBody: rejection.responseBody, completedAt: new Date(), expiresAt,
        } });
      });
      return this.resolveExisting<T>(winner, requestFingerprint, options.errors, options.terminalRejection, options.responseStatus);
    } catch (error) {
      if (classifyTransactionError(error) !== "UNIQUE_CONFLICT") throw error;
      assertBudget();
      // Fresh read outside the failed transaction/snapshot, as in normal idempotency races.
      const winner = await this.prisma.idempotencyRecord.findUnique({ where });
      assertBudget();
      if (!winner) throw error;
      return this.resolveExisting<T>(winner, requestFingerprint, options.errors, options.terminalRejection, options.responseStatus);
    }
  }

  private resolveExisting<T>(
    existing: {
      requestFingerprint: Uint8Array;
      status: string;
      responseStatus?: number | null;
      responseBody: Prisma.JsonValue | null;
    },
    requestFingerprint: Uint8Array,
    errors: IdempotencyErrors,
    terminalRejection?: TerminalRejectionPolicy,
    successStatus?: number,
  ): T {
    if (
      !Buffer.from(existing.requestFingerprint).equals(
        Buffer.from(requestFingerprint),
      )
    ) {
      throw errors.mismatch();
    }
    if (existing.status !== "COMPLETED" || existing.responseBody === null) {
      throw errors.inProgress();
    }
    if (terminalRejection) {
      if (existing.responseStatus === 422 && terminalRejection.decode(existing.responseBody)) {
        throw new IdempotentCommandRejection(422, existing.responseBody);
      }
      if (existing.responseStatus !== (successStatus ?? 200)
        || !terminalRejection.validateSuccess(existing.responseBody)) throw errors.inProgress();
    } else if (existing.responseStatus !== undefined && existing.responseStatus !== null && existing.responseStatus >= 400) {
      // Never cast a persisted failure into another caller's success type.
      throw errors.inProgress();
    }
    return existing.responseBody as T;
  }
}
