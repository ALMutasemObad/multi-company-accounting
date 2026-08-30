import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type PlatformElectronicPaymentState,
  type PlatformPaymentAttempt,
  type PrismaClient,
} from "@prisma/client";
import type { AuditAppendPort } from "../../platform/audit-append-port.js";
import { IdempotentCommandExecutor } from "../../platform/idempotent-command-executor.js";
import { currentRequestContext } from "../../operations/request-context.js";
import { TransactionExecutor } from "../../platform/transaction-executor.js";
import type { PlatformAnalyticsQueryPort } from "../platform-operations-ports.js";
import type { PlatformOperationsService } from "../platform-operations-service.js";
import {
  PlatformPaymentMoneyError,
  toPlatformPaymentMinorUnits,
} from "./platform-payment-money.js";
import type {
  PlatformPaymentDevelopmentSimulatorPort,
  PlatformPaymentProviderEventType,
  PlatformPaymentProviderPort,
  VerifiedPlatformPaymentWebhook,
} from "./platform-payment-provider-port.js";
import { PlatformPaymentWebhookVerificationError } from "./platform-payment-provider-port.js";

export const PLATFORM_PAYMENT_DEFAULT_PAGE_SIZE = 10;
export const PLATFORM_PAYMENT_MAX_PAGE_SIZE = 25;

export type PlatformPaymentFailureReason =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_CURRENCY"
  | "AMOUNT_NOT_REPRESENTABLE_IN_MINOR_UNITS"
  | "INVALID_AMOUNT"
  | "INVOICE_NOT_OPEN"
  | "INVOICE_ALREADY_PAID"
  | "PAYMENT_ALREADY_IN_PROGRESS"
  | "INVALID_PAYMENT_STATE"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "WEBHOOK_REPLAY_MISMATCH"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "DEVELOPMENT_SIMULATION_DISABLED";

export class PlatformPaymentError extends Error {
  constructor(
    public readonly reason: PlatformPaymentFailureReason,
    public readonly verificationReason?: string,
  ) {
    super(reason);
  }
}

type Pagination = { page: number; pageSize: number };
type CompanyActor = { userId: bigint; companyId: bigint };
type AttemptGraph = Prisma.PlatformPaymentAttemptGetPayload<{
  include: {
    invoice: true;
    checkoutSession: true;
    billingPayment: true;
    refund: true;
  };
}>;

type InvoiceListRow = {
  public_id: string;
  invoice_number: string;
  state: "ISSUED" | "VOID";
  issue_date: Date;
  due_date: Date;
  currency_code: string;
  total_amount: Prisma.Decimal;
  version: number;
  paid_amount: Prisma.Decimal;
  refunded_amount: Prisma.Decimal;
  net_paid_amount: Prisma.Decimal;
  latest_payment_state: PlatformElectronicPaymentState | null;
};

type CountRow = { total: bigint | number | Prisma.Decimal };

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
const digestBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(createHash("sha256").update(value).digest());
const digestMatches = (left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(Buffer.from(right));
const paginationMeta = (input: Pagination, total: number) => ({
  page: input.page,
  pageSize: input.pageSize,
  total,
  totalPages: Math.ceil(total / input.pageSize),
});
const exactCount = (value: CountRow["total"]) => {
  const text = value.toString();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid database count: ${text}`);
  const count = BigInt(text);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Database count exceeds Number.MAX_SAFE_INTEGER");
  return Number(count);
};
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const requestFingerprint = (value: Record<string, unknown>) => digest(JSON.stringify(value));

function mapMoneyError(error: unknown): never {
  if (error instanceof PlatformPaymentMoneyError) throw new PlatformPaymentError(error.reason);
  throw error;
}

function paymentAttemptJson(attempt: AttemptGraph, companyName?: string) {
  return {
    id: attempt.publicId,
    companyId: attempt.companyId.toString(),
    ...(companyName !== undefined ? { companyName } : {}),
    invoiceId: attempt.invoice.publicId,
    invoiceNumber: attempt.invoice.invoiceNumber,
    state: attempt.state,
    provider: attempt.providerCode,
    environment: attempt.providerEnvironment,
    currencyCode: attempt.currencyCode,
    amount: attempt.amount.toFixed(4),
    amountMinor: attempt.amountMinor.toString(),
    checkoutUrl: attempt.checkoutSession?.hostedCheckoutUrl ?? null,
    version: attempt.version,
    lastFailureCode: attempt.failureCode,
    createdAt: attempt.requestedAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

async function lockInvoice(tx: Prisma.TransactionClient, companyId: bigint, invoicePublicId: string) {
  await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM platform_billing_invoices
    WHERE company_id = ${companyId} AND public_id = ${invoicePublicId}
    FOR UPDATE
  `;
}

async function lockAttempt(tx: Prisma.TransactionClient, attemptId: bigint) {
  await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM platform_payment_attempts WHERE id = ${attemptId} FOR UPDATE
  `;
}

async function invoiceNetPaid(tx: Prisma.TransactionClient, companyId: bigint, invoiceId: bigint) {
  const [payments, refunds] = await Promise.all([
    tx.platformBillingPayment.aggregate({
      where: { companyId, invoiceId },
      _sum: { amount: true },
    }),
    tx.platformBillingRefund.aggregate({
      where: { companyId, state: "SUCCEEDED", payment: { invoiceId } },
      _sum: { amount: true },
    }),
  ]);
  return rounded(money(payments._sum.amount ?? 0).minus(money(refunds._sum.amount ?? 0)));
}

export class PlatformPaymentService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PlatformPaymentProviderPort,
    private readonly operators: Pick<PlatformOperationsService, "requireOperator">,
    private readonly analytics: Pick<PlatformAnalyticsQueryPort, "companyReferences">,
    private readonly audit: AuditAppendPort,
    private readonly simulator?: PlatformPaymentDevelopmentSimulatorPort,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  providerCapabilities() {
    return {
      available: this.provider.enabled,
      provider: this.provider.providerCode,
      environment: this.provider.environment,
      developmentOnly: this.provider.enabled && this.provider.environment === "DEVELOPMENT",
    };
  }

  async listOwnerInvoices(
    companyId: bigint,
    input: Pagination & { status?: "ALL" | "ISSUED" | "PAID" | "OVERDUE" | "VOID" | undefined },
  ) {
    const today = new Date(`${dateString(this.now())}T00:00:00.000Z`);
    const status = input.status ?? "ALL";
    const statusSql = status === "VOID" ? Prisma.sql`invoice.state = 'VOID'`
      : status === "ISSUED" ? Prisma.sql`invoice.state = 'ISSUED' AND COALESCE(net.net_paid_amount, 0) < invoice.total_amount AND invoice.due_date >= ${today}`
        : status === "PAID" ? Prisma.sql`invoice.state = 'ISSUED' AND COALESCE(net.net_paid_amount, 0) >= invoice.total_amount`
          : status === "OVERDUE" ? Prisma.sql`invoice.state = 'ISSUED' AND COALESCE(net.net_paid_amount, 0) < invoice.total_amount AND invoice.due_date < ${today}`
            : Prisma.sql`TRUE`;
    const netSql = Prisma.sql`
      SELECT
        invoice_id,
        GREATEST(COALESCE(SUM(payment_amount), 0) - COALESCE(SUM(refund_amount), 0), 0) AS net_paid_amount,
        COALESCE(SUM(payment_amount), 0) AS paid_amount,
        COALESCE(SUM(refund_amount), 0) AS refunded_amount
      FROM (
        SELECT payment.invoice_id, payment.amount AS payment_amount, 0 AS refund_amount
        FROM platform_billing_payments payment WHERE payment.company_id = ${companyId}
        UNION ALL
        SELECT payment.invoice_id, 0 AS payment_amount, refund.amount AS refund_amount
        FROM platform_billing_refunds refund
        JOIN platform_billing_payments payment
          ON payment.id = refund.payment_id AND payment.company_id = refund.company_id
        WHERE refund.company_id = ${companyId} AND refund.state = 'SUCCEEDED'
      ) money_event
      GROUP BY invoice_id
    `;
    const base = Prisma.sql`
      FROM platform_billing_invoices invoice
      LEFT JOIN (${netSql}) net ON net.invoice_id = invoice.id
      WHERE invoice.company_id = ${companyId} AND ${statusSql}
    `;
    const offset = (input.page - 1) * input.pageSize;
    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`SELECT COUNT(*) AS total ${base}`),
      this.prisma.$queryRaw<InvoiceListRow[]>(Prisma.sql`
        SELECT
          invoice.public_id,
          invoice.invoice_number,
          invoice.state,
          invoice.issue_date,
          invoice.due_date,
          invoice.currency_code,
          invoice.total_amount,
          invoice.version,
          COALESCE(net.paid_amount, 0) AS paid_amount,
          COALESCE(net.refunded_amount, 0) AS refunded_amount,
          COALESCE(net.net_paid_amount, 0) AS net_paid_amount,
          (
            SELECT attempt.state FROM platform_payment_attempts attempt
            WHERE attempt.company_id = invoice.company_id AND attempt.invoice_id = invoice.id
            ORDER BY attempt.requested_at DESC, attempt.id DESC LIMIT 1
          ) AS latest_payment_state
        ${base}
        ORDER BY invoice.issue_date DESC, invoice.id DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `),
    ]);
    const total = exactCount(countRows[0]?.total ?? 0);
    return {
      provider: this.providerCapabilities(),
      items: rows.map((row) => {
        const paid = rounded(money(row.net_paid_amount));
        const balance = Prisma.Decimal.max(money(0), row.total_amount.minus(paid));
        const derivedStatus = row.state === "VOID" ? "VOID"
          : paid.gte(row.total_amount) ? "PAID"
            : row.due_date < today ? "OVERDUE"
              : paid.gt(0) ? "PARTIALLY_PAID" : "ISSUED";
        return {
          id: row.public_id,
          invoiceNumber: row.invoice_number,
          status: derivedStatus,
          issueDate: dateString(row.issue_date),
          dueDate: dateString(row.due_date),
          currencyCode: row.currency_code,
          totalAmount: row.total_amount.toFixed(4),
          paidAmount: row.paid_amount.toFixed(4),
          refundedAmount: row.refunded_amount.toFixed(4),
          balance: rounded(balance).toFixed(4),
          version: row.version,
          latestPaymentState: row.latest_payment_state,
        };
      }),
      meta: paginationMeta(input, total),
    };
  }

  async listOwnerPayments(
    companyId: bigint,
    input: Pagination & { state?: PlatformElectronicPaymentState | "ALL" | undefined },
  ) {
    return this.listAttempts({ companyId }, input);
  }

  async listOperatorPayments(
    userId: bigint,
    input: Pagination & { companyId?: bigint | undefined; state?: PlatformElectronicPaymentState | "ALL" | undefined },
  ) {
    await this.operators.requireOperator(userId);
    return this.listAttempts(input.companyId ? { companyId: input.companyId } : {}, input, true);
  }

  async createCheckout(
    actor: CompanyActor,
    invoicePublicId: string,
    input: { invoiceVersion: number; idempotencyKey: string },
  ) {
    if (!this.provider.enabled) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    const keyHash = digest(`checkout:${input.idempotencyKey}`);
    const fingerprint = requestFingerprint({ invoicePublicId, invoiceVersion: input.invoiceVersion });
    const reserved = await this.transactions.execute({
      operation: "CREATE_PLATFORM_PAYMENT_CHECKOUT",
      companyId: actor.companyId,
    }, async (tx) => {
      await lockInvoice(tx, actor.companyId, invoicePublicId);
      const invoice = await tx.platformBillingInvoice.findFirst({
        where: { publicId: invoicePublicId, companyId: actor.companyId },
      });
      if (!invoice) throw new PlatformPaymentError("NOT_FOUND");
      const existing = await tx.platformPaymentAttempt.findUnique({
        where: { companyId_requestKeyHash: { companyId: actor.companyId, requestKeyHash: keyHash } },
        include: { invoice: true, checkoutSession: true, billingPayment: true, refund: true },
      });
      if (existing) {
        if (!digestMatches(existing.requestFingerprint, fingerprint)) throw new PlatformPaymentError("IDEMPOTENCY_MISMATCH");
        return existing;
      }
      if (invoice.state !== "ISSUED") throw new PlatformPaymentError("INVOICE_NOT_OPEN");
      if (invoice.version !== input.invoiceVersion) throw new PlatformPaymentError("VERSION_CONFLICT");
      const active = await tx.platformPaymentAttempt.findFirst({
        where: { companyId: actor.companyId, invoiceId: invoice.id, state: { in: ["CHECKOUT", "PENDING"] } },
        select: { id: true },
      });
      if (active) throw new PlatformPaymentError("PAYMENT_ALREADY_IN_PROGRESS");
      const netPaid = await invoiceNetPaid(tx, actor.companyId, invoice.id);
      const balance = rounded(invoice.totalAmount.minus(netPaid));
      if (balance.lte(0)) throw new PlatformPaymentError("INVOICE_ALREADY_PAID");
      let minor;
      try {
        minor = toPlatformPaymentMinorUnits(balance, invoice.currencyCode);
      } catch (error) {
        mapMoneyError(error);
      }
      const attempt = await tx.platformPaymentAttempt.create({
        data: {
          companyId: actor.companyId,
          invoiceId: invoice.id,
          providerCode: this.provider.providerCode,
          providerEnvironment: this.provider.environment,
          amount: minor!.amount,
          amountMinor: minor!.amountMinor,
          currencyCode: minor!.currencyCode,
          requestKeyHash: keyHash,
          requestFingerprint: fingerprint,
          requestedById: actor.userId,
        },
        include: { invoice: true, checkoutSession: true, billingPayment: true, refund: true },
      });
      await tx.platformPaymentTransition.create({ data: {
        companyId: actor.companyId,
        paymentAttemptId: attempt.id,
        fromState: null,
        toState: "CHECKOUT",
        source: "COMPANY_OWNER",
        actorId: actor.userId,
        occurredAt: this.now(),
      } });
      await this.audit.append(tx, {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action: "PLATFORM_PAYMENT_CHECKOUT_REQUESTED",
        entityType: "PLATFORM_PAYMENT_ATTEMPT",
        entityId: attempt.publicId,
        details: {
          invoiceId: invoice.publicId,
          invoiceNumber: invoice.invoiceNumber,
          amount: attempt.amount.toFixed(4),
          currencyCode: attempt.currencyCode,
          provider: attempt.providerCode,
          environment: attempt.providerEnvironment,
        },
      });
      return attempt;
    });
    return this.resumeCheckout(reserved);
  }

  async retryCheckout(
    actor: CompanyActor,
    attemptPublicId: string,
    input: { version: number; idempotencyKey: string },
  ) {
    if (!this.provider.enabled) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    const attempt = await this.prisma.platformPaymentAttempt.findFirst({
      where: { publicId: attemptPublicId, companyId: actor.companyId },
      include: { invoice: true },
    });
    if (!attempt) throw new PlatformPaymentError("NOT_FOUND");
    if (attempt.version !== input.version) throw new PlatformPaymentError("VERSION_CONFLICT");
    if (attempt.state !== "FAILED" && attempt.state !== "CANCELLED") {
      throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
    }
    return this.createCheckout(actor, attempt.invoice.publicId, {
      invoiceVersion: attempt.invoice.version,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async cancelCheckout(
    actor: CompanyActor,
    attemptPublicId: string,
    input: { version: number; idempotencyKey: string },
  ) {
    if (!this.provider.enabled) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    const operation = "CANCEL_PLATFORM_PAYMENT_CHECKOUT";
    const fingerprint = JSON.stringify({ attemptPublicId, version: input.version });
    const replay = await this.replayCommand<{ payment: ReturnType<typeof paymentAttemptJson> }>(
      actor,
      operation,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;
    const attempt = await this.prisma.platformPaymentAttempt.findFirst({
      where: { publicId: attemptPublicId, companyId: actor.companyId },
      include: { checkoutSession: true },
    });
    if (!attempt) throw new PlatformPaymentError("NOT_FOUND");
    if (attempt.version !== input.version) throw new PlatformPaymentError("VERSION_CONFLICT");
    if (attempt.state !== "CHECKOUT" && attempt.state !== "PENDING") {
      throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
    }
    if (attempt.checkoutSession) {
      const cancelled = await this.provider.cancelCheckout({
        providerCheckoutId: attempt.checkoutSession.providerCheckoutId,
        merchantReference: attempt.publicId,
        signal: currentRequestContext()?.signal,
      });
      if (!cancelled.accepted) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    }
    return this.commands.execute({
      context: actor,
      operation,
      key: input.idempotencyKey,
      fingerprint,
      errors: {
        mismatch: () => new PlatformPaymentError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new PlatformPaymentError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, async (tx) => {
      await lockAttempt(tx, attempt.id);
      const current = await tx.platformPaymentAttempt.findUnique({ where: { id: attempt.id } });
      if (!current || current.companyId !== actor.companyId) throw new PlatformPaymentError("NOT_FOUND");
      if (current.version !== input.version) throw new PlatformPaymentError("VERSION_CONFLICT");
      if (current.state !== "CHECKOUT" && current.state !== "PENDING") throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
      await tx.platformPaymentAttempt.update({
        where: { id: current.id },
        data: { state: "CANCELLED", completedAt: this.now(), version: { increment: 1 } },
      });
      await tx.platformPaymentTransition.create({ data: {
        companyId: current.companyId,
        paymentAttemptId: current.id,
        fromState: current.state,
        toState: "CANCELLED",
        source: "COMPANY_OWNER",
        actorId: actor.userId,
        occurredAt: this.now(),
      } });
      await this.audit.append(tx, {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action: "PLATFORM_PAYMENT_CHECKOUT_CANCELLED",
        entityType: "PLATFORM_PAYMENT_ATTEMPT",
        entityId: current.publicId,
      });
      const saved = await this.attemptById(tx, current.id);
      return { payment: paymentAttemptJson(saved) };
    });
  }

  async requestFullRefund(
    userId: bigint,
    attemptPublicId: string,
    input: { version: number; reason: string; idempotencyKey: string },
  ) {
    if (!this.provider.enabled) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    await this.operators.requireOperator(userId);
    const keyHash = digest(`refund:${input.idempotencyKey}`);
    const fingerprint = requestFingerprint({ attemptPublicId, version: input.version, reason: input.reason });
    const reserved = await this.transactions.execute({ operation: "REQUEST_PLATFORM_PAYMENT_REFUND" }, async (tx) => {
      const located = await tx.platformPaymentAttempt.findUnique({ where: { publicId: attemptPublicId } });
      if (!located) throw new PlatformPaymentError("NOT_FOUND");
      await lockAttempt(tx, located.id);
      const attempt = await tx.platformPaymentAttempt.findUnique({
        where: { id: located.id }, include: { billingPayment: true, refund: true },
      });
      if (!attempt) throw new PlatformPaymentError("NOT_FOUND");
      const existingByKey = await tx.platformBillingRefund.findUnique({
        where: { companyId_requestKeyHash: { companyId: attempt.companyId, requestKeyHash: keyHash } },
      });
      if (existingByKey) {
        if (!existingByKey.requestFingerprint || !digestMatches(existingByKey.requestFingerprint, fingerprint)) {
          throw new PlatformPaymentError("IDEMPOTENCY_MISMATCH");
        }
        return { attempt, refund: existingByKey };
      }
      if (!attempt.billingPayment) throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
      if (attempt.version !== input.version) throw new PlatformPaymentError("VERSION_CONFLICT");
      if (attempt.state !== "PAID") throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
      if (attempt.refund) throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
      const refund = await tx.platformBillingRefund.create({ data: {
        companyId: attempt.companyId,
        paymentId: attempt.billingPayment.id,
        paymentAttemptId: attempt.id,
        amount: attempt.billingPayment.amount,
        amountMinor: attempt.amountMinor,
        currencyCode: attempt.currencyCode,
        requestKeyHash: keyHash,
        requestFingerprint: fingerprint,
        requestedById: userId,
      } });
      await this.audit.append(tx, {
        companyId: attempt.companyId,
        actorUserId: userId,
        action: "PLATFORM_PAYMENT_REFUND_REQUESTED",
        entityType: "PLATFORM_BILLING_REFUND",
        entityId: refund.publicId,
        details: { paymentAttemptId: attempt.publicId, reason: input.reason },
      });
      return { attempt, refund };
    });
    if (reserved.refund.state !== "PENDING" || reserved.refund.providerRefundId) {
      return { refundId: reserved.refund.publicId, state: reserved.refund.state };
    }
    try {
      const result = await this.provider.requestFullRefund({
        providerPaymentId: reserved.attempt.providerPaymentId!,
        merchantReference: reserved.refund.publicId,
        amountMinor: reserved.attempt.amountMinor,
        currencyCode: reserved.attempt.currencyCode,
        signal: currentRequestContext()?.signal,
      });
      await this.prisma.platformBillingRefund.updateMany({
        where: { id: reserved.refund.id, state: "PENDING", providerRefundId: null },
        data: { providerRefundId: result.providerRefundId, version: { increment: 1 } },
      });
      const current = await this.prisma.platformBillingRefund.findUniqueOrThrow({ where: { id: reserved.refund.id } });
      return { refundId: current.publicId, state: current.state };
    } catch {
      await this.prisma.platformBillingRefund.updateMany({
        where: { id: reserved.refund.id, state: "PENDING" },
        data: { state: "FAILED", failureCode: "PROVIDER_REFUND_REQUEST_FAILED", completedAt: this.now(), version: { increment: 1 } },
      });
      const current = await this.prisma.platformBillingRefund.findUniqueOrThrow({ where: { id: reserved.refund.id } });
      if (current.state === "SUCCEEDED") return { refundId: current.publicId, state: current.state };
      throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    }
  }

  async handleWebhook(input: {
    providerCode: string;
    rawBody: Uint8Array;
    signature: string | undefined;
    receivedAt?: Date | undefined;
  }) {
    if (!this.provider.enabled) throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    if (input.providerCode !== this.provider.providerCode.toLowerCase()) {
      throw new PlatformPaymentError("NOT_FOUND");
    }
    let event: VerifiedPlatformPaymentWebhook;
    try {
      event = this.provider.verifyWebhook({
        rawBody: input.rawBody,
        signature: input.signature,
        receivedAt: input.receivedAt ?? this.now(),
      });
    } catch (error) {
      if (error instanceof PlatformPaymentWebhookVerificationError) {
        throw new PlatformPaymentError("WEBHOOK_VERIFICATION_FAILED", error.reason);
      }
      throw error;
    }
    const payloadHash = digestBytes(input.rawBody);
    try {
      return await this.transactions.execute({ operation: "PROCESS_PLATFORM_PAYMENT_WEBHOOK" }, async (tx) => {
      const existing = await tx.platformWebhookReceipt.findUnique({
        where: { providerCode_providerEnvironment_providerEventId: {
          providerCode: this.provider.providerCode,
          providerEnvironment: this.provider.environment,
          providerEventId: event.providerEventId,
        } },
      });
      if (existing) {
        if (!digestMatches(existing.payloadHash, payloadHash)) throw new PlatformPaymentError("WEBHOOK_REPLAY_MISMATCH");
        return { accepted: true, duplicate: true, result: existing.resultCode };
      }
      const session = await tx.platformCheckoutSession.findFirst({
        where: {
          providerCode: this.provider.providerCode,
          providerEnvironment: this.provider.environment,
          providerCheckoutId: event.providerCheckoutId,
        },
        include: { paymentAttempt: true },
      });
      if (!session) {
        await this.createReceipt(tx, event, payloadHash, null, "REJECTED", "CHECKOUT_NOT_FOUND");
        return { accepted: true, duplicate: false, result: "CHECKOUT_NOT_FOUND" };
      }
      await lockAttempt(tx, session.paymentAttempt.id);
      const attempt = await tx.platformPaymentAttempt.findUniqueOrThrow({ where: { id: session.paymentAttempt.id } });
      if (attempt.amountMinor !== event.amountMinor || attempt.currencyCode !== event.currencyCode) {
        await this.createReceipt(tx, event, payloadHash, attempt, "REJECTED", "AMOUNT_OR_CURRENCY_MISMATCH");
        return { accepted: true, duplicate: false, result: "AMOUNT_OR_CURRENCY_MISMATCH" };
      }
      const result = await this.applyProviderEvent(tx, attempt, event);
      await this.createReceipt(tx, event, payloadHash, attempt, result.applied ? "APPLIED" : "IGNORED", result.code);
        return { accepted: true, duplicate: false, result: result.code };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await this.prisma.platformWebhookReceipt.findUnique({
        where: { providerCode_providerEnvironment_providerEventId: {
          providerCode: this.provider.providerCode,
          providerEnvironment: this.provider.environment,
          providerEventId: event.providerEventId,
        } },
      });
      if (!existing) throw error;
      if (!digestMatches(existing.payloadHash, payloadHash)) {
        throw new PlatformPaymentError("WEBHOOK_REPLAY_MISMATCH");
      }
      return { accepted: true, duplicate: true, result: existing.resultCode };
    }
  }

  async simulateDevelopmentEvent(
    actor: CompanyActor,
    attemptPublicId: string,
    eventType: PlatformPaymentProviderEventType,
  ) {
    if (!this.provider.enabled || !this.simulator || this.provider.environment !== "DEVELOPMENT") {
      throw new PlatformPaymentError("DEVELOPMENT_SIMULATION_DISABLED");
    }
    const attempt = await this.prisma.platformPaymentAttempt.findFirst({
      where: { publicId: attemptPublicId, companyId: actor.companyId },
      include: { checkoutSession: true, refund: true },
    });
    if (!attempt?.checkoutSession) throw new PlatformPaymentError("NOT_FOUND");
    const signed = this.simulator.createSignedWebhook({
      providerEventId: `dev_event_${randomUUID()}`,
      eventType,
      providerCheckoutId: attempt.checkoutSession.providerCheckoutId,
      providerPaymentId: `dev_payment_${attempt.publicId}`,
      providerRefundId: eventType === "PAYMENT_REFUNDED"
        ? attempt.refund?.providerRefundId ?? `dev_refund_${attempt.publicId}`
        : null,
      amountMinor: attempt.amountMinor,
      currencyCode: attempt.currencyCode,
      occurredAt: this.now(),
      signatureTimestamp: this.now(),
    });
    return this.handleWebhook({
      providerCode: this.provider.providerCode.toLowerCase(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      receivedAt: this.now(),
    });
  }

  private async resumeCheckout(attempt: AttemptGraph) {
    if (attempt.checkoutSession) return { payment: paymentAttemptJson(attempt) };
    if (attempt.state !== "CHECKOUT") throw new PlatformPaymentError("INVALID_PAYMENT_STATE");
    let createdCheckout: Awaited<ReturnType<PlatformPaymentProviderPort["createCheckout"]>> | null = null;
    try {
      const checkout = await this.provider.createCheckout({
        merchantReference: attempt.publicId,
        amountMinor: attempt.amountMinor,
        currencyCode: attempt.currencyCode,
        description: `Platform invoice ${attempt.invoice.invoiceNumber}`,
        returnUrl: "/#subscription",
        signal: currentRequestContext()?.signal,
      });
      createdCheckout = checkout;
      const finalized = await this.transactions.execute({
        operation: "FINALIZE_PLATFORM_PAYMENT_CHECKOUT",
        companyId: attempt.companyId,
      }, async (tx) => {
        await lockAttempt(tx, attempt.id);
        const current = await tx.platformPaymentAttempt.findUnique({ where: { id: attempt.id } });
        if (!current) throw new PlatformPaymentError("NOT_FOUND");
        const existingSession = await tx.platformCheckoutSession.findUnique({ where: { paymentAttemptId: attempt.id } });
        if (!existingSession && current.state !== "CHECKOUT") {
          const saved = await this.attemptById(tx, attempt.id);
          return { payment: paymentAttemptJson(saved), compensate: true };
        }
        if (!existingSession) {
          await tx.platformCheckoutSession.create({ data: {
            companyId: attempt.companyId,
            paymentAttemptId: attempt.id,
            providerCode: attempt.providerCode,
            providerEnvironment: attempt.providerEnvironment,
            providerCheckoutId: checkout.providerCheckoutId,
            hostedCheckoutUrl: checkout.checkoutUrl,
            expiresAt: checkout.expiresAt,
          } });
          await tx.platformPaymentAttempt.update({ where: { id: attempt.id }, data: { version: { increment: 1 } } });
        }
        const saved = await this.attemptById(tx, attempt.id);
        return { payment: paymentAttemptJson(saved), compensate: false };
      });
      if (finalized.compensate) {
        await this.provider.cancelCheckout({
          providerCheckoutId: checkout.providerCheckoutId,
          merchantReference: attempt.publicId,
        }).catch(() => ({ accepted: false }));
      }
      return { payment: finalized.payment };
    } catch (error) {
      if (error instanceof PlatformPaymentError) throw error;
      const safeToCloseLocally = createdCheckout !== null && (await this.provider.cancelCheckout({
        providerCheckoutId: createdCheckout.providerCheckoutId,
        merchantReference: attempt.publicId,
        signal: currentRequestContext()?.signal,
      }).catch(() => ({ accepted: false }))).accepted;
      if (safeToCloseLocally) {
        await this.transactions.execute({ operation: "FAIL_PLATFORM_PAYMENT_CHECKOUT", companyId: attempt.companyId }, async (tx) => {
          await lockAttempt(tx, attempt.id);
          const current = await tx.platformPaymentAttempt.findUnique({ where: { id: attempt.id } });
          if (!current || current.state !== "CHECKOUT") return;
          await tx.platformPaymentAttempt.update({
            where: { id: current.id },
            data: { state: "FAILED", failureCode: "PROVIDER_CHECKOUT_FAILED", completedAt: this.now(), version: { increment: 1 } },
          });
          await tx.platformPaymentTransition.create({ data: {
            companyId: current.companyId,
            paymentAttemptId: current.id,
            fromState: current.state,
            toState: "FAILED",
            source: "SYSTEM",
            occurredAt: this.now(),
          } });
        });
      }
      throw new PlatformPaymentError("PROVIDER_UNAVAILABLE");
    }
  }

  private async listAttempts(
    scope: { companyId?: bigint | undefined },
    input: Pagination & { state?: PlatformElectronicPaymentState | "ALL" | undefined },
    includeCompanyName = false,
  ) {
    const where: Prisma.PlatformPaymentAttemptWhereInput = {
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      ...(input.state && input.state !== "ALL" ? { state: input.state } : {}),
    };
    const [total, attempts] = await Promise.all([
      this.prisma.platformPaymentAttempt.count({ where }),
      this.prisma.platformPaymentAttempt.findMany({
        where,
        include: { invoice: true, checkoutSession: true, billingPayment: true, refund: true },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    const names = includeCompanyName && attempts.length
      ? new Map((await this.analytics.companyReferences(attempts.map((item) => item.companyId))).map((item) => [item.id, item.name]))
      : new Map<string, string>();
    return {
      provider: this.providerCapabilities(),
      items: attempts.map((attempt) => paymentAttemptJson(attempt, includeCompanyName ? names.get(attempt.companyId.toString()) ?? "—" : undefined)),
      meta: paginationMeta(input, total),
    };
  }

  private async attemptById(tx: Prisma.TransactionClient, attemptId: bigint) {
    return tx.platformPaymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { invoice: true, checkoutSession: true, billingPayment: true, refund: true },
    });
  }

  private async replayCommand<T>(
    actor: CompanyActor,
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<T | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { companyId_userId_operation_keyHash: {
        companyId: actor.companyId,
        userId: actor.userId,
        operation,
        keyHash: digest(key),
      } },
    });
    if (!existing) return null;
    if (!digestMatches(existing.requestFingerprint, digest(fingerprint))) {
      throw new PlatformPaymentError("IDEMPOTENCY_MISMATCH");
    }
    if (existing.status !== "COMPLETED" || existing.responseBody === null) {
      throw new PlatformPaymentError("IDEMPOTENCY_IN_PROGRESS");
    }
    return existing.responseBody as T;
  }

  private async createReceipt(
    tx: Prisma.TransactionClient,
    event: VerifiedPlatformPaymentWebhook,
    payloadHash: Uint8Array<ArrayBuffer>,
    attempt: PlatformPaymentAttempt | null,
    processingState: "APPLIED" | "IGNORED" | "REJECTED",
    resultCode: string,
  ) {
    await tx.platformWebhookReceipt.create({ data: {
      providerCode: this.provider.providerCode,
      providerEnvironment: this.provider.environment,
      providerEventId: event.providerEventId,
      providerPaymentId: event.providerPaymentId,
      providerRefundId: event.providerRefundId,
      amountMinor: event.amountMinor,
      currencyCode: event.currencyCode,
      payloadHash,
      processingState,
      resultCode,
      companyId: attempt?.companyId ?? null,
      paymentAttemptId: attempt?.id ?? null,
      providerOccurredAt: event.occurredAt,
      receivedAt: this.now(),
      processedAt: this.now(),
    } });
  }

  private async applyProviderEvent(
    tx: Prisma.TransactionClient,
    attempt: PlatformPaymentAttempt,
    event: VerifiedPlatformPaymentWebhook,
  ): Promise<{ applied: boolean; code: string }> {
    if (event.eventType === "PAYMENT_PAID") return this.applyPaid(tx, attempt, event, event.providerEventId);
    if (event.eventType === "PAYMENT_REFUNDED") return this.applyRefunded(tx, attempt, event);
    if (attempt.state === "PAID" || attempt.state === "REFUNDED") return { applied: false, code: "TERMINAL_STATE_PRESERVED" };
    const target = event.eventType === "PAYMENT_PENDING" ? "PENDING"
      : event.eventType === "PAYMENT_FAILED" ? "FAILED" : "CANCELLED";
    if (attempt.state === target) return { applied: false, code: "STATE_ALREADY_APPLIED" };
    if (target === "PENDING" && attempt.state !== "CHECKOUT") return { applied: false, code: "OUT_OF_ORDER_EVENT_IGNORED" };
    if ((attempt.state === "FAILED" || attempt.state === "CANCELLED") && target !== "PENDING") {
      return { applied: false, code: "TERMINAL_FAILURE_PRESERVED" };
    }
    await tx.platformPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        state: target,
        ...(target === "FAILED" ? { failureCode: "PROVIDER_REPORTED_FAILURE" } : {}),
        ...(target === "FAILED" || target === "CANCELLED" ? { completedAt: event.occurredAt } : {}),
        version: { increment: 1 },
      },
    });
    await this.transition(tx, attempt, target, event.providerEventId, event.occurredAt);
    return { applied: true, code: `PAYMENT_${target}` };
  }

  private async applyPaid(
    tx: Prisma.TransactionClient,
    attempt: PlatformPaymentAttempt,
    event: VerifiedPlatformPaymentWebhook,
    transitionEventId: string,
  ): Promise<{ applied: boolean; code: string }> {
    if (!event.providerPaymentId) return { applied: false, code: "PROVIDER_PAYMENT_ID_REQUIRED" };
    if (attempt.state === "REFUNDED") return { applied: false, code: "REFUNDED_STATE_PRESERVED" };
    const existingPayment = await tx.platformBillingPayment.findUnique({ where: { paymentAttemptId: attempt.id } });
    if (!existingPayment) {
      await lockInvoice(tx, attempt.companyId, (await tx.platformBillingInvoice.findUniqueOrThrow({ where: { id: attempt.invoiceId } })).publicId);
      const netPaid = await invoiceNetPaid(tx, attempt.companyId, attempt.invoiceId);
      const invoice = await tx.platformBillingInvoice.findUniqueOrThrow({ where: { id: attempt.invoiceId } });
      if (invoice.state !== "ISSUED" || netPaid.plus(attempt.amount).gt(invoice.totalAmount)) {
        return { applied: false, code: "INVOICE_BALANCE_CONFLICT" };
      }
      await tx.platformBillingPayment.create({ data: {
        companyId: attempt.companyId,
        invoiceId: attempt.invoiceId,
        paymentAttemptId: attempt.id,
        paymentDate: event.occurredAt,
        amount: attempt.amount,
        method: "OTHER",
        source: "ELECTRONIC_PROVIDER",
        reference: event.providerPaymentId,
        receivedById: null,
      } });
      await tx.platformBillingInvoice.update({ where: { id: attempt.invoiceId }, data: { version: { increment: 1 } } });
    }
    if (attempt.state !== "PAID") {
      await tx.platformPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          state: "PAID",
          providerPaymentId: event.providerPaymentId,
          completedAt: event.occurredAt,
          failureCode: null,
          failureReason: null,
          version: { increment: 1 },
        },
      });
      await this.transition(tx, attempt, "PAID", transitionEventId, event.occurredAt);
      return { applied: true, code: "PAYMENT_PAID" };
    }
    return { applied: false, code: "PAYMENT_ALREADY_PAID" };
  }

  private async applyRefunded(
    tx: Prisma.TransactionClient,
    attempt: PlatformPaymentAttempt,
    event: VerifiedPlatformPaymentWebhook,
  ): Promise<{ applied: boolean; code: string }> {
    if (!event.providerPaymentId || !event.providerRefundId) {
      return { applied: false, code: "PROVIDER_REFUND_REFERENCES_REQUIRED" };
    }
    if (attempt.state === "REFUNDED") return { applied: false, code: "PAYMENT_ALREADY_REFUNDED" };
    const paid = await this.applyPaid(tx, attempt, event, `${event.providerEventId}:capture`);
    if (!paid.applied && paid.code !== "PAYMENT_ALREADY_PAID") return paid;
    const payment = await tx.platformBillingPayment.findUniqueOrThrow({ where: { paymentAttemptId: attempt.id } });
    const existingRefund = await tx.platformBillingRefund.findUnique({ where: { paymentId: payment.id } });
    if (existingRefund) {
      await tx.platformBillingRefund.update({
        where: { id: existingRefund.id },
        data: {
          state: "SUCCEEDED",
          providerRefundId: event.providerRefundId,
          completedAt: event.occurredAt,
          failureCode: null,
          failureReason: null,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.platformBillingRefund.create({ data: {
        companyId: attempt.companyId,
        paymentId: payment.id,
        paymentAttemptId: attempt.id,
        state: "SUCCEEDED",
        amount: payment.amount,
        amountMinor: attempt.amountMinor,
        currencyCode: attempt.currencyCode,
        providerRefundId: event.providerRefundId,
        requestedById: null,
        requestedAt: event.occurredAt,
        completedAt: event.occurredAt,
      } });
    }
    const current = await tx.platformPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    await tx.platformPaymentAttempt.update({
      where: { id: attempt.id },
      data: { state: "REFUNDED", completedAt: event.occurredAt, version: { increment: 1 } },
    });
    await tx.platformBillingInvoice.update({ where: { id: attempt.invoiceId }, data: { version: { increment: 1 } } });
    await this.transition(tx, current, "REFUNDED", event.providerEventId, event.occurredAt);
    return { applied: true, code: "PAYMENT_REFUNDED" };
  }

  private async transition(
    tx: Prisma.TransactionClient,
    attempt: PlatformPaymentAttempt,
    toState: PlatformElectronicPaymentState,
    providerEventId: string,
    occurredAt: Date,
  ) {
    await tx.platformPaymentTransition.create({ data: {
      companyId: attempt.companyId,
      paymentAttemptId: attempt.id,
      fromState: attempt.state,
      toState,
      source: "WEBHOOK",
      providerEventId,
      occurredAt,
    } });
  }
}
