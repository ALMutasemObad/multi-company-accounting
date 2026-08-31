import { posCheckoutRejectionResponseComponentSchema, type PosCheckoutRejectionResponseComponent } from "../generated/openapi-request-guards.js";
import { ReceiptError } from "../receipts/receipt-service.js";
import { SalesInvoiceError } from "../sales/sales-invoice-ports.js";

export type PosCheckoutRejection = PosCheckoutRejectionResponseComponent;
const KIND = "POS_CHECKOUT_REJECTION";

/** Versioned Infrastructure payload; never expose it, the scope, or raw domain errors. */
export function readPosCheckoutRejection(body: unknown): PosCheckoutRejection | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "kind,rejection,version"
    || value.kind !== KIND || value.version !== 1) return null;
  const parsed = posCheckoutRejectionResponseComponentSchema.safeParse(value.rejection);
  return parsed.success ? parsed.data : null;
}

export function classifyPosCheckoutRejection(error: unknown) {
  if (!(error instanceof SalesInvoiceError) && !(error instanceof ReceiptError)) return null;
  const parsed = posCheckoutRejectionResponseComponentSchema.safeParse({ code: "POS_CHECKOUT_REJECTED", reason: error.reason });
  if (!parsed.success) return null;
  return { responseStatus: 422 as const, responseBody: { kind: KIND, version: 1, rejection: parsed.data } };
}
