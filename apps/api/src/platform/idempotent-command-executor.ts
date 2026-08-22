import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { assertRequestActive } from "../operations/request-context.js";
import {
  classifyTransactionError,
  TransactionExecutor,
  type TransactionExecutionOptions,
} from "./transaction-executor.js";

const DAY_MS = 86_400_000;

const digest = (value: string) =>
  new Uint8Array(createHash("sha256").update(value).digest());

type IdempotencyErrors = {
  mismatch: () => Error;
  inProgress: () => Error;
};

export type IdempotentCommandOptions = {
  context: ActorContext;
  operation: string;
  key: string;
  fingerprint: string;
  errors: IdempotencyErrors;
  responseStatus?: number;
  retentionMs?: number;
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

    try {
      return await this.transactions.execute(
        {
          operation: options.operation,
          companyId: options.context.companyId,
          ...options.transaction,
        },
        async (tx) => {
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
              expiresAt: new Date(
                Date.now() + (options.retentionMs ?? DAY_MS),
              ),
            },
          });
          const response = await work(tx);
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
      if (classifyTransactionError(error) !== "UNIQUE_CONFLICT") throw error;
      assertRequestActive(`${options.operation}_IDEMPOTENCY_RESOLUTION`);
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
      if (!existing) throw error;
      return this.resolveExisting<T>(
        existing,
        requestFingerprint,
        options.errors,
      );
    }
  }

  private resolveExisting<T>(
    existing: {
      requestFingerprint: Uint8Array;
      status: string;
      responseBody: Prisma.JsonValue | null;
    },
    requestFingerprint: Uint8Array,
    errors: IdempotencyErrors,
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
    return existing.responseBody as T;
  }
}
