import { api, ApiError } from "./api";
import { electronicPaymentStates, paymentFromCommandResult, type BillingPage, type ElectronicPayment, type SubscriptionBillingInvoice } from "./electronic-payments";
import { assertRequestActive, RequestError, withinRequest } from "./request-scope";
import type { BillingAttempt } from "./billing-recovery-attempt";

export const BILLING_READ_TIMEOUT_MS = 12_000;
export const BILLING_COMMAND_TIMEOUT_MS = 20_000;
export type BillingQuery = { invoicePage: number; invoiceStatus: string; paymentPage: number; paymentState: string };
export const initialBillingQuery: BillingQuery = { invoicePage: 1, invoiceStatus: "ALL", paymentPage: 1, paymentState: "ALL" };

export async function loadBillingRecoveryPages(companyId: string, query: BillingQuery, signal: AbortSignal) {
  return withinRequest(async (signal) => {
    const invoicesQuery = new URLSearchParams({ page: String(query.invoicePage), pageSize: "10", status: query.invoiceStatus });
    const paymentsQuery = new URLSearchParams({ page: String(query.paymentPage), pageSize: "10", state: query.paymentState });
    const [invoices, payments] = await Promise.all([
      api<BillingPage<SubscriptionBillingInvoice>>(`/subscription/billing/invoices?${invoicesQuery}`, { signal, cache: "no-store" }),
      api<BillingPage<ElectronicPayment>>(`/subscription/billing/payments?${paymentsQuery}`, { signal, cache: "no-store" }),
    ]);
    assertRequestActive(signal);
    if (!validPage(invoices) || !validPage(payments)
      || payments.items.some((payment) => payment.companyId !== undefined && payment.companyId !== companyId)) throw new RequestError("response");
    return { invoices, payments };
  }, { signal, timeoutMs: BILLING_READ_TIMEOUT_MS });
}
function validPage(value: BillingPage<unknown>) {
  return value && Array.isArray(value.items) && value.items.length <= 10 && value.meta?.pageSize === 10
    && Number.isSafeInteger(value.meta.page) && value.meta.page >= 1 && typeof value.provider?.available === "boolean";
}

export async function sendBillingAttempt(attempt: BillingAttempt, companyId: string, signal: AbortSignal) {
  const resource = attempt.command === "checkout" ? "invoices" : "payments";
  const result = await api<ElectronicPayment | { payment: ElectronicPayment }>(`/subscription/billing/${resource}/${attempt.resourceId}/${attempt.command}`, {
    method: "POST", body: attempt.body, idempotencyKey: attempt.key, signal, timeoutMs: BILLING_COMMAND_TIMEOUT_MS,
  });
  if (!result || typeof result !== "object") throw new RequestError("response");
  const payment = paymentFromCommandResult(result);
  if (!payment || typeof payment.id !== "string" || payment.invoiceId !== attempt.invoiceId
    || (attempt.command === "cancel" && payment.id !== attempt.resourceId)
    || (payment.companyId !== undefined && payment.companyId !== companyId)
    || !electronicPaymentStates.includes(payment.state) || !Number.isSafeInteger(payment.version)
    || (payment.checkoutUrl !== null && typeof payment.checkoutUrl !== "string")) throw new RequestError("response");
  return payment;
}

export function billingReadError(cause: unknown): "readTimeout" | "readCancelled" | "readThrottled" | "readError" {
  if (cause instanceof RequestError && cause.kind === "timeout") return "readTimeout";
  if (cause instanceof RequestError && cause.kind === "cancelled") return "readCancelled";
  if (cause instanceof ApiError && cause.status === 429) return "readThrottled";
  return "readError";
}
