import { Prisma, type PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { hashToken } from '../auth/session-tokens.js';
import {
  PermanentOutboxError,
  REGISTRATION_REQUEST_AGGREGATE,
  REGISTRATION_VERIFICATION_REQUESTED,
  type OutboxEnvelope,
} from '../outbox/outbox.js';
import { logEvent } from '../operations/logger.js';
import { RegistrationEventRecorder } from './registration-event-recorder.js';
import type { RegistrationMailer } from './registration-mailer.js';

const payloadSchema = z.object({ deliveryGeneration: z.number().int().min(1).max(65_535) }).strict();

type DeliveryClaim = {
  requestId: bigint;
  emailNormalized: string;
  locale: 'ar' | 'en';
  deliveryGeneration: number;
  verificationTokenHash: Uint8Array<ArrayBuffer>;
  verificationUrl: string;
  expiresAt: Date;
};

type RegistrationVerificationHandlerOptions = {
  tokenTtlHours: number;
  publicAppUrl: string;
  tokenSecret: string;
  auditPepper: string;
  now?: () => Date;
};

export function deriveRegistrationVerificationToken(eventId: string, tokenSecret: string) {
  return createHmac('sha256', tokenSecret)
    .update('mcap.registration.verification.v1\0', 'utf8')
    .update(eventId, 'utf8')
    .digest('base64url');
}

function deliveryErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)) return error.message;
  return 'EMAIL_DELIVERY_FAILED';
}

export class RegistrationVerificationHandler {
  private readonly now: () => Date;
  private readonly events: RegistrationEventRecorder;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: RegistrationMailer,
    private readonly options: RegistrationVerificationHandlerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.events = new RegistrationEventRecorder(options.auditPepper);
  }

  readonly handle = async (event: OutboxEnvelope, signal: AbortSignal) => {
    if (event.eventType !== REGISTRATION_VERIFICATION_REQUESTED
      || event.aggregateType !== REGISTRATION_REQUEST_AGGREGATE
      || event.schemaVersion !== 1) {
      throw new PermanentOutboxError('REGISTRATION_VERIFICATION_CONTRACT_UNSUPPORTED');
    }
    const parsed = payloadSchema.safeParse(event.payload);
    if (!parsed.success) throw new PermanentOutboxError('REGISTRATION_VERIFICATION_PAYLOAD_INVALID');

    const delivery = await this.claimDelivery(event, parsed.data.deliveryGeneration);
    if (!delivery) return;

    try {
      if (signal.aborted) throw signal.reason;
      await this.mailer.sendVerification({
        to: delivery.emailNormalized,
        locale: delivery.locale,
        verificationUrl: delivery.verificationUrl,
        expiresAt: delivery.expiresAt,
      }, signal);
      if (signal.aborted) throw signal.reason;
      await this.recordDelivered(delivery);
    } catch (error) {
      await this.recordFailed(delivery, deliveryErrorCode(error)).catch((trackingError: unknown) => {
        logEvent('error', 'registration_delivery_tracking_failed', {
          errorCode: deliveryErrorCode(trackingError),
          outboxEventId: event.eventId,
        });
      });
      throw error;
    }
  };

  private async claimDelivery(event: OutboxEnvelope, deliveryGeneration: number): Promise<DeliveryClaim | null> {
    const request = await this.prisma.registrationRequest.findUnique({
      where: { publicId: event.aggregateId },
      select: {
        id: true,
        emailNormalized: true,
        locale: true,
        status: true,
        deliveryStatus: true,
        deliveryGeneration: true,
        verificationTokenHash: true,
      },
    });
    if (!request
      || request.deliveryGeneration !== deliveryGeneration
      || !['PENDING_EMAIL', 'EMAIL_VERIFIED'].includes(request.status)) return null;

    const token = deriveRegistrationVerificationToken(event.eventId, this.options.tokenSecret);
    const verificationTokenHash = hashToken(token);
    if (request.deliveryStatus === 'SENT'
      && Buffer.from(request.verificationTokenHash).equals(Buffer.from(verificationTokenHash))) return null;
    const expiresAt = new Date(this.now().getTime() + this.options.tokenTtlHours * 3_600_000);
    const claimed = await this.prisma.registrationRequest.updateMany({
      where: {
        id: request.id,
        deliveryGeneration,
        status: { in: ['PENDING_EMAIL', 'EMAIL_VERIFIED'] },
      },
      data: {
        verificationTokenHash,
        verificationExpiresAt: expiresAt,
        deliveryStatus: 'PENDING',
        deliveryAttempts: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return null;

    const url = new URL(this.options.publicAppUrl);
    url.hash = `register?token=${encodeURIComponent(token)}`;
    return {
      requestId: request.id,
      emailNormalized: request.emailNormalized,
      locale: request.locale === 'en' ? 'en' : 'ar',
      deliveryGeneration,
      verificationTokenHash,
      verificationUrl: url.toString(),
      expiresAt,
    };
  }

  private recordDelivered(delivery: DeliveryClaim) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.registrationRequest.updateMany({
        where: {
          id: delivery.requestId,
          deliveryGeneration: delivery.deliveryGeneration,
          verificationTokenHash: delivery.verificationTokenHash,
          deliveryStatus: { in: ['PENDING', 'FAILED'] },
        },
        data: { deliveryStatus: 'SENT', lastErrorCode: null },
      });
      if (updated.count === 1) {
        await this.events.record(tx, {
          registrationRequestId: delivery.requestId,
          emailNormalized: delivery.emailNormalized,
          eventType: 'REGISTRATION_EMAIL_SENT',
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2_000, timeout: 8_000 });
  }

  private recordFailed(delivery: DeliveryClaim, errorCode: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.registrationRequest.updateMany({
        where: {
          id: delivery.requestId,
          deliveryGeneration: delivery.deliveryGeneration,
          verificationTokenHash: delivery.verificationTokenHash,
          deliveryStatus: 'PENDING',
        },
        data: { deliveryStatus: 'FAILED', lastErrorCode: errorCode },
      });
      if (updated.count === 1) {
        await this.events.record(tx, {
          registrationRequestId: delivery.requestId,
          emailNormalized: delivery.emailNormalized,
          eventType: 'REGISTRATION_EMAIL_FAILED',
          severity: 'WARNING',
          details: { reason: errorCode },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2_000, timeout: 8_000 });
  }
}
