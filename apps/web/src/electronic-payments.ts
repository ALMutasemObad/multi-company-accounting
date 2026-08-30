export type ElectronicPaymentState = "CHECKOUT" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";

export type ElectronicPayment = {
  id: string;
  companyId?: string;
  companyName?: string;
  invoiceId: string;
  invoiceNumber: string;
  state: ElectronicPaymentState;
  provider: string;
  environment: string;
  currencyCode: string;
  amount: string;
  amountMinor: string;
  checkoutUrl: string | null;
  version: number;
  lastFailureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionBillingInvoice = {
  id: string;
  invoiceNumber: string;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID";
  issueDate: string;
  dueDate: string;
  currencyCode: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  balance: string;
  version: number;
  latestPaymentState: ElectronicPaymentState | null;
};

export type BillingPageMeta = { page: number; pageSize: number; total: number; totalPages: number };
export type PaymentProviderCapability = {
  available: boolean;
  provider: string;
  environment: string;
  developmentOnly: boolean;
};
export type BillingPage<T> = { provider: PaymentProviderCapability; items: T[]; meta: BillingPageMeta };

export const electronicPaymentStates = [
  "CHECKOUT", "PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED",
] as const satisfies readonly ElectronicPaymentState[];

export type OwnerPaymentAction = "OPEN_CHECKOUT" | "CANCEL" | "RETRY";

export function ownerPaymentActions(payment: Pick<ElectronicPayment, "state" | "checkoutUrl">): OwnerPaymentAction[] {
  if (payment.state === "CHECKOUT") {
    return [...(payment.checkoutUrl ? ["OPEN_CHECKOUT" as const] : []), "CANCEL"];
  }
  if (payment.state === "PENDING") return ["CANCEL"];
  if (payment.state === "FAILED" || payment.state === "CANCELLED") return ["RETRY"];
  return [];
}

export function canRefundElectronicPayment(state: ElectronicPaymentState) {
  return state === "PAID";
}

export function paymentFromCommandResult(result: ElectronicPayment | { payment: ElectronicPayment }) {
  return "payment" in result ? result.payment : result;
}

export function isNavigableCheckoutUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value, globalThis.location?.origin ?? "http://localhost");
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
