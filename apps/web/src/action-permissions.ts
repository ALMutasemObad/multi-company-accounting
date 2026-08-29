import type { PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const actionPermissionPolicies = {
  salesInvoices: {
    create: permission("sales_invoices.create"),
    update: permission("sales_invoices.update"),
    post: permission("sales_invoices.post"),
    cancel: permission("sales_invoices.cancel"),
    reverse: permission("sales_invoices.reverse"),
    print: permission("sales_invoices.print"),
  },
  purchaseInvoices: {
    create: permission("purchase_invoices.create"),
    update: permission("purchase_invoices.update"),
    post: permission("purchase_invoices.post"),
    cancel: permission("purchase_invoices.cancel"),
    reverse: permission("purchase_invoices.reverse"),
    print: permission("purchase_invoices.print"),
  },
  receipts: {
    create: permission("receipts.create"),
    update: permission("receipts.update"),
    post: permission("receipts.post"),
    cancel: permission("receipts.cancel"),
    reverse: permission("receipts.reverse"),
    print: permission("receipts.print"),
  },
  payments: {
    create: permission("payments.create"),
    update: permission("payments.update"),
    post: permission("payments.post"),
    cancel: permission("payments.cancel"),
    reverse: permission("payments.reverse"),
    print: permission("payments.print"),
  },
  pos: {
    checkout: permission("pos.checkout"),
  },
  customers: {
    manage: permission("customers.manage"),
  },
  suppliers: {
    manage: permission("suppliers.manage"),
  },
  salesTaxRates: {
    manage: permission("tax_rates.manage"),
  },
  purchaseTaxRates: {
    manage: permission("input_tax_rates.manage"),
  },
} as const;
