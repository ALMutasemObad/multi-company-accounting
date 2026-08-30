import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditAppendAdapter } from "../src/audit/prisma-audit-append-adapter.js";
import { createDatabase } from "../src/database.js";
import { DevelopmentPaymentProviderAdapter } from "../src/platform-operations/payments/adapters/development-payment-provider-adapter.js";
import { PlatformSubscriptionPaymentEvidenceAdapter } from "../src/platform-operations/payments/platform-subscription-payment-evidence-adapter.js";
import {
  PlatformPaymentError,
  PlatformPaymentService,
} from "../src/platform-operations/payments/platform-payment-service.js";
import type { PlatformPaymentProviderEventType } from "../src/platform-operations/payments/platform-payment-provider-port.js";
import { PrismaCompanySubscriptionProvisioningAdapter } from "../src/platform-subscriptions/prisma-company-subscription-provisioning-adapter.js";
import {
  PlatformSubscriptionError,
  PlatformSubscriptionLifecycleService,
} from "../src/platform-subscriptions/platform-subscription-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;
const NOW = new Date("2051-06-01T12:00:00.000Z");
const WEBHOOK_SECRET = "platform-payment-integration-webhook-secret";

describe.runIf(enabled)("platform electronic payments on a supported database", () => {
  const companyIds: bigint[] = [];
  const organizationIds: bigint[] = [];
  const targetPlanIds: bigint[] = [];
  let operatorUserId: bigint;
  let sarCurrencyId: bigint;
  let invoiceSequence = 0;

  const provider = new DevelopmentPaymentProviderAdapter(
    WEBHOOK_SECRET,
    "https://payments.integration.test",
    300,
    () => NOW,
  );
  const audit = new PrismaAuditAppendAdapter();
  const operators = {
    requireOperator: async (candidate: bigint) => {
      if (candidate !== operatorUserId) throw new Error("Unexpected platform operator");
    },
  };
  const subscriptionOperators = {
    isOperator: async (candidate: bigint) => candidate === operatorUserId,
  };
  const analytics = {
    companyReferences: async (ids: bigint[]) => (await prisma!.company.findMany({
      where: { id: { in: ids } },
      include: { baseCurrency: { select: { code: true } } },
    })).map((company) => ({
      id: company.id.toString(),
      name: company.name,
      isActive: company.isActive,
      baseCurrencyCode: company.baseCurrency.code,
    })),
  };

  const payments = () => new PlatformPaymentService(
    prisma!,
    provider,
    operators,
    analytics,
    audit,
    provider,
    () => NOW,
  );

  async function expectPaymentFailure(work: Promise<unknown>, reason: string) {
    try {
      await work;
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformPaymentError);
      expect((error as PlatformPaymentError).reason).toBe(reason);
      return;
    }
    throw new Error(`Expected platform payment failure ${reason}`);
  }

  async function expectSubscriptionFailure(work: Promise<unknown>, reason: string) {
    try {
      await work;
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformSubscriptionError);
      expect((error as PlatformSubscriptionError).reason).toBe(reason);
      return;
    }
    throw new Error(`Expected platform subscription failure ${reason}`);
  }

  async function createCompany() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
    const organization = await prisma!.organization.create({
      data: { code: `PAY4-${suffix}`, name: `Payment integration ${suffix}` },
    });
    organizationIds.push(organization.id);
    const company = await prisma!.company.create({
      data: {
        organizationId: organization.id,
        baseCurrencyId: sarCurrencyId,
        code: `PAY4-${suffix}`,
        name: `Payment company ${suffix}`,
        timezone: "Asia/Riyadh",
      },
    });
    companyIds.push(company.id);
    await prisma!.$transaction((tx) => new PrismaCompanySubscriptionProvisioningAdapter()
      .provisionGrandfatheredAccess(tx, {
        companyId: company.id,
        baseCurrencyCode: "SAR",
        effectiveFrom: new Date("2050-01-01T00:00:00.000Z"),
      }));
    return company;
  }

  async function createInvoice(
    companyId: bigint,
    relations: {
      subscriptionId?: bigint | undefined;
      planVersionId?: bigint | undefined;
      subscriptionChangeId?: bigint | undefined;
      totalAmount?: string | undefined;
    } = {},
  ) {
    const account = await prisma!.platformBillingAccount.upsert({
      where: { companyId },
      update: {},
      create: {
        companyId,
        status: "ACTIVE",
        planName: "Payment integration plan",
        billingCycle: "MONTHLY",
        currencyCode: "SAR",
        recurringFee: "100.0000",
        includedUsers: 0,
        pricePerAdditionalUser: "0",
        includedEmployees: 0,
        pricePerAdditionalEmployee: "0",
        includedPostedDocuments: 0,
        pricePerAdditionalPostedDocument: "0",
        taxRate: "0",
        paymentTermsDays: 30,
        createdById: operatorUserId,
        updatedById: operatorUserId,
      },
    });
    invoiceSequence += 1;
    const period = new Date(Date.UTC(2051, 0, invoiceSequence));
    const totalAmount = relations.totalAmount ?? "100.0000";
    return prisma!.platformBillingInvoice.create({
      data: {
        companyId,
        billingAccountId: account.id,
        ...(relations.subscriptionId ? { subscriptionId: relations.subscriptionId } : {}),
        ...(relations.planVersionId ? { planVersionId: relations.planVersionId } : {}),
        ...(relations.subscriptionChangeId ? { subscriptionChangeId: relations.subscriptionChangeId } : {}),
        ...(relations.planVersionId ? { planDisplayNameSnapshot: "Paid integration plan" } : {}),
        invoiceNumber: `PAY4-${randomUUID()}`,
        periodStart: period,
        periodEnd: period,
        issueDate: new Date("2051-05-01T00:00:00.000Z"),
        dueDate: new Date("2051-12-31T00:00:00.000Z"),
        currencyCode: "SAR",
        usageUsers: 0,
        usageEmployees: 0,
        usagePostedDocuments: 0,
        usageOperations: 0,
        subtotal: totalAmount,
        taxRateSnapshot: "0",
        taxAmount: "0",
        totalAmount,
        issuedById: operatorUserId,
      },
    });
  }

  async function createCheckout(companyId: bigint, invoice: { publicId: string; version: number }) {
    return payments().createCheckout({ userId: operatorUserId, companyId }, invoice.publicId, {
      invoiceVersion: invoice.version,
      idempotencyKey: `checkout-${randomUUID()}`,
    });
  }

  async function signedEvent(
    attemptPublicId: string,
    eventType: PlatformPaymentProviderEventType,
    providerEventId = `dev_event_${randomUUID()}`,
    overrides: {
      amountMinor?: bigint | undefined;
      currencyCode?: string | undefined;
      occurredAt?: Date | undefined;
    } = {},
  ) {
    const attempt = await prisma!.platformPaymentAttempt.findUniqueOrThrow({
      where: { publicId: attemptPublicId },
      include: { checkoutSession: true },
    });
    if (!attempt.checkoutSession) throw new Error("Expected a persisted development checkout session");
    const providerPaymentId = eventType === "PAYMENT_PAID" || eventType === "PAYMENT_REFUNDED"
      ? `dev_payment_${attempt.publicId}`
      : null;
    const providerRefundId = eventType === "PAYMENT_REFUNDED"
      ? `dev_refund_${attempt.publicId}`
      : null;
    return provider.createSignedWebhook({
      providerEventId,
      eventType,
      providerCheckoutId: attempt.checkoutSession.providerCheckoutId,
      providerPaymentId,
      providerRefundId,
      amountMinor: overrides.amountMinor ?? attempt.amountMinor,
      currencyCode: overrides.currencyCode ?? attempt.currencyCode,
      occurredAt: overrides.occurredAt ?? NOW,
      signatureTimestamp: NOW,
    });
  }

  async function handleSigned(signed: { rawBody: Uint8Array; signature: string }) {
    return payments().handleWebhook({
      providerCode: provider.providerCode.toLowerCase(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      receivedAt: NOW,
    });
  }

  beforeAll(async () => {
    const [operator, currency] = await Promise.all([
      prisma!.user.findUniqueOrThrow({
        where: { emailNormalized: "admin@mcap.local" },
        select: { id: true },
      }),
      prisma!.currency.findFirstOrThrow({
        where: { code: "SAR", scopeKey: "GLOBAL" },
        select: { id: true },
      }),
    ]);
    operatorUserId = operator.id;
    sarCurrencyId = currency.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (companyIds.length) {
      const companyId = { in: companyIds };
      const subscriptions = await prisma.platformSubscription.findMany({
        where: { companyId },
        select: { id: true, planVersion: { select: { id: true, planId: true } } },
      });
      const subscriptionIds = subscriptions.map((item) => item.id);
      const legacyVersionIds = subscriptions.map((item) => item.planVersion.id);
      const legacyPlanIds = subscriptions.map((item) => item.planVersion.planId);
      const changes = await prisma.platformSubscriptionChange.findMany({
        where: { companyId },
        select: { id: true },
      });

      await prisma.platformWebhookReceipt.deleteMany({ where: { companyId } });
      await prisma.platformPaymentTransition.deleteMany({ where: { companyId } });
      await prisma.platformBillingRefund.deleteMany({ where: { companyId } });
      await prisma.platformBillingPayment.deleteMany({ where: { companyId } });
      await prisma.platformCheckoutSession.deleteMany({ where: { companyId } });
      await prisma.platformPaymentAttempt.deleteMany({ where: { companyId } });
      await prisma.platformBillingInvoiceLine.deleteMany({ where: { companyId } });
      await prisma.platformBillingInvoice.deleteMany({ where: { companyId } });
      await prisma.platformBillingAccount.deleteMany({ where: { companyId } });
      await prisma.idempotencyRecord.deleteMany({ where: { companyId } });
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.platformSubscriptionChangeModule.deleteMany({
        where: { changeId: { in: changes.map((item) => item.id) } },
      });
      await prisma.platformSubscriptionChange.deleteMany({ where: { companyId } });
      await prisma.platformSubscriptionEntitlement.deleteMany({ where: { companyId } });
      await prisma.platformSubscription.deleteMany({ where: { id: { in: subscriptionIds } } });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: legacyVersionIds } } });
      await prisma.platformPlanVersion.deleteMany({ where: { id: { in: legacyVersionIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: legacyPlanIds } } });
    }
    if (targetPlanIds.length) {
      const versions = await prisma.platformPlanVersion.findMany({
        where: { planId: { in: targetPlanIds } },
        select: { id: true },
      });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: versions.map((item) => item.id) } } });
      await prisma.platformPlanVersion.deleteMany({ where: { planId: { in: targetPlanIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: targetPlanIds } } });
    }
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  it("records one paid accounting fact under concurrent duplicate webhook delivery", async () => {
    const company = await createCompany();
    const invoice = await createInvoice(company.id);
    const checkout = await createCheckout(company.id, invoice);
    const signed = await signedEvent(checkout.payment.id, "PAYMENT_PAID");

    const outcomes = await Promise.all([handleSigned(signed), handleSigned(signed)]);
    expect(outcomes.map((outcome) => outcome.duplicate).sort()).toEqual([false, true]);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(["PAYMENT_PAID", "PAYMENT_PAID"]);

    const [attempt, paymentCount, receiptCount, paidTransitions, savedInvoice] = await Promise.all([
      prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: checkout.payment.id } }),
      prisma!.platformBillingPayment.count({ where: { companyId: company.id, invoiceId: invoice.id } }),
      prisma!.platformWebhookReceipt.count({ where: { companyId: company.id } }),
      prisma!.platformPaymentTransition.count({ where: { companyId: company.id, toState: "PAID" } }),
      prisma!.platformBillingInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ]);
    expect(attempt.state).toBe("PAID");
    expect(paymentCount).toBe(1);
    expect(receiptCount).toBe(1);
    expect(paidTransitions).toBe(1);
    expect(savedInvoice.version).toBe(invoice.version + 1);

    const ownerInvoices = await payments().listOwnerInvoices(company.id, { page: 1, pageSize: 10, status: "PAID" });
    expect(ownerInvoices.items).toEqual([expect.objectContaining({
      id: invoice.publicId,
      status: "PAID",
      paidAmount: "100.0000",
      refundedAmount: "0.0000",
      balance: "0.0000",
    })]);
  });

  it("rejects replay of the same provider event id with a different signed payload", async () => {
    const company = await createCompany();
    const invoice = await createInvoice(company.id);
    const checkout = await createCheckout(company.id, invoice);
    const eventId = `dev_event_replay_${randomUUID()}`;
    const pending = await signedEvent(checkout.payment.id, "PAYMENT_PENDING", eventId);
    expect(await handleSigned(pending)).toMatchObject({ duplicate: false, result: "PAYMENT_PENDING" });

    const changedPayload = await signedEvent(checkout.payment.id, "PAYMENT_FAILED", eventId);
    await expectPaymentFailure(handleSigned(changedPayload), "WEBHOOK_REPLAY_MISMATCH");

    expect(await prisma!.platformWebhookReceipt.count({ where: { providerEventId: eventId } })).toBe(1);
    expect((await prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: checkout.payment.id } })).state)
      .toBe("PENDING");
  });

  it("handles refund-before-paid once and reopens the complete invoice balance", async () => {
    const company = await createCompany();
    const invoice = await createInvoice(company.id);
    const checkout = await createCheckout(company.id, invoice);
    const refunded = await signedEvent(checkout.payment.id, "PAYMENT_REFUNDED");

    expect(await handleSigned(refunded)).toMatchObject({ duplicate: false, result: "PAYMENT_REFUNDED" });
    const [attempt, paymentsCount, refundsCount] = await Promise.all([
      prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: checkout.payment.id } }),
      prisma!.platformBillingPayment.count({ where: { companyId: company.id, invoiceId: invoice.id } }),
      prisma!.platformBillingRefund.count({ where: { companyId: company.id, state: "SUCCEEDED" } }),
    ]);
    expect(attempt.state).toBe("REFUNDED");
    expect(paymentsCount).toBe(1);
    expect(refundsCount).toBe(1);

    const ownerInvoices = await payments().listOwnerInvoices(company.id, { page: 1, pageSize: 10, status: "ISSUED" });
    expect(ownerInvoices.items).toEqual([expect.objectContaining({
      id: invoice.publicId,
      status: "ISSUED",
      paidAmount: "100.0000",
      refundedAmount: "100.0000",
      balance: "100.0000",
      latestPaymentState: "REFUNDED",
    })]);
  });

  it("lets authoritative late paid events win after cancel or failure while preserving invalid transitions", async () => {
    const company = await createCompany();
    const cancelledInvoice = await createInvoice(company.id);
    const failedInvoice = await createInvoice(company.id);
    const cancelledCheckout = await createCheckout(company.id, cancelledInvoice);
    await payments().cancelCheckout({ userId: operatorUserId, companyId: company.id }, cancelledCheckout.payment.id, {
      version: cancelledCheckout.payment.version,
      idempotencyKey: `cancel-${randomUUID()}`,
    });
    const invalidPending = await signedEvent(cancelledCheckout.payment.id, "PAYMENT_PENDING");
    expect(await handleSigned(invalidPending)).toMatchObject({ result: "OUT_OF_ORDER_EVENT_IGNORED" });
    expect((await prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: cancelledCheckout.payment.id } })).state)
      .toBe("CANCELLED");

    const lateCancelledPaid = await signedEvent(cancelledCheckout.payment.id, "PAYMENT_PAID");
    expect(await handleSigned(lateCancelledPaid)).toMatchObject({ result: "PAYMENT_PAID" });

    const failedCheckout = await createCheckout(company.id, failedInvoice);
    const failed = await signedEvent(failedCheckout.payment.id, "PAYMENT_FAILED");
    expect(await handleSigned(failed)).toMatchObject({ result: "PAYMENT_FAILED" });
    const invalidCancelled = await signedEvent(failedCheckout.payment.id, "PAYMENT_CANCELLED");
    expect(await handleSigned(invalidCancelled)).toMatchObject({ result: "TERMINAL_FAILURE_PRESERVED" });
    expect((await prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: failedCheckout.payment.id } })).state)
      .toBe("FAILED");

    const lateFailedPaid = await signedEvent(failedCheckout.payment.id, "PAYMENT_PAID");
    expect(await handleSigned(lateFailedPaid)).toMatchObject({ result: "PAYMENT_PAID" });
    const invalidAfterPaid = await signedEvent(failedCheckout.payment.id, "PAYMENT_FAILED");
    expect(await handleSigned(invalidAfterPaid)).toMatchObject({ result: "TERMINAL_STATE_PRESERVED" });

    const finalAttempts = await prisma!.platformPaymentAttempt.findMany({
      where: { publicId: { in: [cancelledCheckout.payment.id, failedCheckout.payment.id] } },
    });
    expect(finalAttempts.map((attempt) => attempt.state).sort()).toEqual(["PAID", "PAID"]);
    expect(await prisma!.platformBillingPayment.count({ where: { companyId: company.id } })).toBe(2);
  });

  it("preserves optimistic versions and company-owner isolation", async () => {
    const [companyA, companyB] = await Promise.all([createCompany(), createCompany()]);
    const invoice = await createInvoice(companyA.id);
    const checkout = await createCheckout(companyA.id, invoice);

    await expectPaymentFailure(payments().cancelCheckout(
      { userId: operatorUserId, companyId: companyA.id },
      checkout.payment.id,
      { version: checkout.payment.version - 1, idempotencyKey: `stale-cancel-${randomUUID()}` },
    ), "VERSION_CONFLICT");
    await expectPaymentFailure(payments().cancelCheckout(
      { userId: operatorUserId, companyId: companyB.id },
      checkout.payment.id,
      { version: checkout.payment.version, idempotencyKey: `foreign-cancel-${randomUUID()}` },
    ), "NOT_FOUND");
    await expectPaymentFailure(payments().createCheckout(
      { userId: operatorUserId, companyId: companyB.id },
      invoice.publicId,
      { invoiceVersion: invoice.version, idempotencyKey: `foreign-checkout-${randomUUID()}` },
    ), "NOT_FOUND");

    const [current, companyBPayments] = await Promise.all([
      prisma!.platformPaymentAttempt.findUniqueOrThrow({ where: { publicId: checkout.payment.id } }),
      payments().listOwnerPayments(companyB.id, { page: 1, pageSize: 10, state: "ALL" }),
    ]);
    expect(current.state).toBe("CHECKOUT");
    expect(current.version).toBe(checkout.payment.version);
    expect(companyBPayments.items).toEqual([]);
  });

  it("paginates and filters invoices and attempts in the database", async () => {
    const company = await createCompany();
    const invoices = [
      await createInvoice(company.id),
      await createInvoice(company.id),
      await createInvoice(company.id),
      await createInvoice(company.id),
    ];
    const checkouts = [];
    for (const invoice of invoices) checkouts.push(await createCheckout(company.id, invoice));
    await handleSigned(await signedEvent(checkouts[0]!.payment.id, "PAYMENT_PAID"));
    await handleSigned(await signedEvent(checkouts[1]!.payment.id, "PAYMENT_FAILED"));
    await handleSigned(await signedEvent(checkouts[2]!.payment.id, "PAYMENT_CANCELLED"));

    const [failedOnly, operatorPage, invoicePage, paidInvoices] = await Promise.all([
      payments().listOwnerPayments(company.id, { page: 1, pageSize: 1, state: "FAILED" }),
      payments().listOperatorPayments(operatorUserId, { companyId: company.id, page: 1, pageSize: 2, state: "ALL" }),
      payments().listOwnerInvoices(company.id, { page: 2, pageSize: 2, status: "ALL" }),
      payments().listOwnerInvoices(company.id, { page: 1, pageSize: 1, status: "PAID" }),
    ]);
    expect(failedOnly.meta).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect(failedOnly.items).toEqual([expect.objectContaining({ state: "FAILED", companyId: company.id.toString() })]);
    expect(operatorPage.items).toHaveLength(2);
    expect(operatorPage.meta).toMatchObject({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(operatorPage.items.every((item) => item.companyName === company.name)).toBe(true);
    expect(invoicePage.items).toHaveLength(2);
    expect(invoicePage.meta).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect(paidInvoices.items).toEqual([expect.objectContaining({ id: invoices[0]!.publicId, status: "PAID" })]);
  });

  it("filters partial, unpaid, paid and overdue balances without crossing companies", async () => {
    const company = await createCompany();
    const foreignCompany = await createCompany();
    const unpaid = await createInvoice(company.id);
    const partial = await createInvoice(company.id);
    const paid = await createInvoice(company.id);
    const overdue = await createInvoice(company.id);
    const foreignPartial = await createInvoice(foreignCompany.id);
    await prisma!.platformBillingInvoice.update({
      where: { id: overdue.id },
      data: { dueDate: new Date("2051-05-31T00:00:00.000Z") },
    });
    await prisma!.platformBillingPayment.createMany({
      data: [partial, paid, overdue, foreignPartial].map((invoice) => ({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        paymentDate: NOW,
        amount: invoice.id === paid.id ? "100.0000" : "25.0000",
        method: "BANK_TRANSFER" as const,
        source: "MANUAL" as const,
        receivedById: operatorUserId,
      })),
    });
    for (const [status, invoice] of [
      ["ISSUED", unpaid], ["PARTIALLY_PAID", partial], ["PAID", paid], ["OVERDUE", overdue],
    ] as const) {
      const page = await payments().listOwnerInvoices(company.id, { page: 1, pageSize: 1, status });
      expect(page.meta).toMatchObject({ total: 1, totalPages: 1 });
      expect(page.items).toEqual([expect.objectContaining({ id: invoice.publicId, status })]);
      if (status === "PARTIALLY_PAID") expect(page.items[0]).toMatchObject({ paidAmount: "25.0000", balance: "75.0000" });
    }
  });

  it("accepts a paid subscription approval only after settled invoice evidence exists", async () => {
    const company = await createCompany();
    const subscription = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: company.id } });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
    const plan = await prisma!.platformPlan.create({ data: { code: `PAY4-PLAN-${suffix}` } });
    targetPlanIds.push(plan.id);
    const targetVersion = await prisma!.platformPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        displayName: "Paid integration plan",
        billingCycle: "MONTHLY",
        currencyCode: "SAR",
        recurringFee: "100.0000",
        includedUsers: 1,
        pricePerAdditionalUser: "0",
        includedEmployees: 1,
        pricePerAdditionalEmployee: "0",
        includedPostedDocuments: 1,
        pricePerAdditionalPostedDocument: "0",
        taxRate: "0",
        paymentTermsDays: 0,
        trialDays: 0,
        effectiveFrom: new Date("2050-01-01T00:00:00.000Z"),
        selfServicePolicy: "REQUEST_ONLY",
        publishedAt: NOW,
        createdById: operatorUserId,
        updatedById: operatorUserId,
        publishedById: operatorUserId,
      },
    });
    const change = await prisma!.platformSubscriptionChange.create({
      data: {
        companyId: company.id,
        subscriptionId: subscription.id,
        fromPlanVersionId: subscription.planVersionId,
        targetPlanVersionId: targetVersion.id,
        state: "PENDING_APPROVAL",
        source: "COMPANY_OWNER",
        requestedById: operatorUserId,
        requestedSubscriptionVersion: subscription.version,
        currencyCode: "SAR",
        baseRecurringFee: "100.0000",
        optionalRecurringFee: "0",
        totalRecurringFee: "100.0000",
      },
    });
    const invoice = await createInvoice(company.id, {
      subscriptionId: subscription.id,
      planVersionId: targetVersion.id,
      subscriptionChangeId: change.id,
      totalAmount: "100.0000",
    });
    const lifecycle = () => new PlatformSubscriptionLifecycleService(
      prisma!,
      subscriptionOperators,
      audit,
      () => NOW,
      new PlatformSubscriptionPaymentEvidenceAdapter(),
    );
    const decision = {
      decision: "APPROVE" as const,
      effectiveAt: NOW.toISOString(),
      reason: "Payment evidence verified",
      subscriptionVersion: subscription.version,
    };
    await expectSubscriptionFailure(lifecycle().decideOwnerRequest(
      { userId: operatorUserId },
      change.publicId,
      { ...decision, idempotencyKey: `unpaid-decision-${randomUUID()}` },
    ), "PAYMENT_REQUIRED");

    const checkout = await createCheckout(company.id, invoice);
    await handleSigned(await signedEvent(checkout.payment.id, "PAYMENT_PAID"));
    const approved = await lifecycle().decideOwnerRequest(
      { userId: operatorUserId },
      change.publicId,
      { ...decision, idempotencyKey: `paid-decision-${randomUUID()}` },
    );
    expect(approved).toMatchObject({
      change: { id: change.publicId, state: "APPROVED" },
      paymentCollected: true,
      subscriptionVersion: subscription.version + 1,
    });
    const savedSubscription = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(savedSubscription).toMatchObject({ planVersionId: targetVersion.id, version: subscription.version + 1 });
  });
});
