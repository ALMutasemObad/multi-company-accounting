import { Prisma } from '@prisma/client';

export const REGISTRATION_VERIFICATION_REQUESTED = 'RegistrationVerificationRequested';
export const REGISTRATION_REQUEST_AGGREGATE = 'RegistrationRequest';
export const PASSWORD_RESET_REQUESTED = 'PasswordResetRequested';
export const PASSWORD_RESET_REQUEST_AGGREGATE = 'PasswordResetRequest';

export type OutboxAppendInput = {
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  companyId?: bigint;
  payload: Prisma.InputJsonValue;
  occurredAt?: Date;
};

export interface OutboxAppender {
  append(tx: Prisma.TransactionClient, input: OutboxAppendInput): Promise<{ eventId: string }>;
}

export class PrismaOutboxAppender implements OutboxAppender {
  constructor(private readonly maxAttempts: number) {}

  append(tx: Prisma.TransactionClient, input: OutboxAppendInput) {
    return tx.outboxEvent.create({
      data: {
        eventType: input.eventType,
        schemaVersion: input.schemaVersion,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
        payload: input.payload,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        maxAttempts: this.maxAttempts,
      },
      select: { eventId: true },
    });
  }
}

export type OutboxEnvelope = {
  id: bigint;
  eventId: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  companyId: bigint | null;
  payload: Prisma.JsonValue;
  occurredAt: Date;
  attemptCount: number;
  maxAttempts: number;
};

export type OutboxHandler = (event: OutboxEnvelope, signal: AbortSignal) => Promise<void>;

export class PermanentOutboxError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'PermanentOutboxError';
  }
}
