import { Prisma, type SecuritySeverity } from '@prisma/client';
import { createHmac } from 'node:crypto';

export type RegistrationMetadata = { ipAddress?: string; userAgent?: string };

export type RegistrationEventInput = {
  registrationRequestId?: bigint;
  emailNormalized: string;
  eventType: string;
  severity?: SecuritySeverity;
  metadata?: RegistrationMetadata;
  details?: Prisma.InputJsonValue;
};

export class RegistrationEventRecorder {
  constructor(private readonly auditPepper: string) {}

  record(tx: Prisma.TransactionClient, input: RegistrationEventInput) {
    const data: Prisma.RegistrationEventUncheckedCreateInput = {
      ...(input.registrationRequestId ? { registrationRequestId: input.registrationRequestId } : {}),
      emailHash: new Uint8Array(createHmac('sha256', this.auditPepper).update(input.emailNormalized, 'utf8').digest()),
      eventType: input.eventType,
      severity: input.severity ?? 'INFO',
      ...(input.metadata?.ipAddress ? { ipAddress: input.metadata.ipAddress } : {}),
      ...(input.metadata?.userAgent ? { userAgent: input.metadata.userAgent } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
    };
    return tx.registrationEvent.create({ data });
  }
}
