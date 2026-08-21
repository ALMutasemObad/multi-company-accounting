import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashToken } from './session-tokens.js';
import {
  PASSWORD_RESET_REQUEST_AGGREGATE,
  PASSWORD_RESET_REQUESTED,
  PermanentOutboxError,
  type OutboxEnvelope,
} from '../outbox/outbox.js';
import { logEvent } from '../operations/logger.js';
import type { PasswordResetMailer } from '../registration/registration-mailer.js';

const payloadSchema = z.object({}).strict();

type Delivery = {
  requestId: bigint;
  tokenHash: Uint8Array<ArrayBuffer>;
  email: string;
  locale: 'ar' | 'en';
  resetUrl: string;
  expiresAt: Date;
};

type Options = {
  tokenTtlMinutes: number;
  publicAppUrl: string;
  tokenSecret: string;
  now?: () => Date;
};

export function derivePasswordResetToken(eventId: string, tokenSecret: string) {
  return createHmac('sha256', tokenSecret)
    .update('mcap.password.reset.v1\0', 'utf8')
    .update(eventId, 'utf8')
    .digest('base64url');
}

function deliveryErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)) return error.message;
  return 'PASSWORD_RESET_EMAIL_DELIVERY_FAILED';
}

export class PasswordResetHandler {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: PasswordResetMailer,
    private readonly options: Options,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  readonly handle = async (event: OutboxEnvelope, signal: AbortSignal) => {
    if (event.eventType !== PASSWORD_RESET_REQUESTED
      || event.aggregateType !== PASSWORD_RESET_REQUEST_AGGREGATE
      || event.schemaVersion !== 1) {
      throw new PermanentOutboxError('PASSWORD_RESET_CONTRACT_UNSUPPORTED');
    }
    if (!payloadSchema.safeParse(event.payload).success) {
      throw new PermanentOutboxError('PASSWORD_RESET_PAYLOAD_INVALID');
    }

    const delivery = await this.claim(event);
    if (!delivery) return;
    try {
      if (signal.aborted) throw signal.reason;
      await this.mailer.sendPasswordReset({
        to: delivery.email,
        locale: delivery.locale,
        resetUrl: delivery.resetUrl,
        expiresAt: delivery.expiresAt,
      }, signal);
      if (signal.aborted) throw signal.reason;
      await this.prisma.passwordResetRequest.updateMany({
        where: { id: delivery.requestId, tokenHash: delivery.tokenHash, status: 'PENDING' },
        data: { deliveryStatus: 'SENT', lastErrorCode: null },
      });
    } catch (error) {
      const errorCode = deliveryErrorCode(error);
      await this.prisma.passwordResetRequest.updateMany({
        where: { id: delivery.requestId, tokenHash: delivery.tokenHash, status: 'PENDING' },
        data: { deliveryStatus: 'FAILED', lastErrorCode: errorCode },
      }).catch((trackingError: unknown) => {
        logEvent('error', 'password_reset_delivery_tracking_failed', {
          errorCode: deliveryErrorCode(trackingError),
          outboxEventId: event.eventId,
        });
      });
      throw error;
    }
  };

  private async claim(event: OutboxEnvelope): Promise<Delivery | null> {
    const request = await this.prisma.passwordResetRequest.findUnique({
      where: { publicId: event.aggregateId },
      select: {
        id: true,
        locale: true,
        status: true,
        tokenHash: true,
        deliveryStatus: true,
        user: { select: { emailNormalized: true, isActive: true } },
      },
    });
    if (!request || request.status !== 'PENDING' || !request.user.isActive) return null;

    const token = derivePasswordResetToken(event.eventId, this.options.tokenSecret);
    const tokenHash = hashToken(token);
    if (request.deliveryStatus === 'SENT'
      && request.tokenHash
      && Buffer.from(request.tokenHash).equals(Buffer.from(tokenHash))) return null;

    const expiresAt = new Date(this.now().getTime() + this.options.tokenTtlMinutes * 60_000);
    const claimed = await this.prisma.passwordResetRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: {
        tokenHash,
        expiresAt,
        deliveryStatus: 'PENDING',
        deliveryAttempts: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return null;

    const url = new URL(this.options.publicAppUrl);
    url.hash = `reset-password?token=${encodeURIComponent(token)}`;
    return {
      requestId: request.id,
      tokenHash,
      email: request.user.emailNormalized,
      locale: request.locale === 'en' ? 'en' : 'ar',
      resetUrl: url.toString(),
      expiresAt,
    };
  }
}
