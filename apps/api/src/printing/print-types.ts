export type PrintSnapshot = {
  formatVersion: 1;
  archivedAt: string;
  company: { id: string; name: string; timezone: string; baseCurrencyCode: string; baseCurrencyNameAr: string };
  document: { id: string; type: "RECEIPT" | "PAYMENT" | "MANUAL_JOURNAL" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE" | "SALES_INVOICE" | "SALES_CREDIT_NOTE"; number: string; date: string; description: string; statusAtArchive: "POSTED"; createdAt: string; postedAt: string; creatorName: string; posterName: string };
  settlement: null | { counterpartyName: string; counterpartyTaxMasked: string | null; counterpartyAddress: string | null; cashBankAccount: string; paymentMethod: string; currencyCode: string; exchangeRate: string; amount: string; baseAmount: string; referenceNumber: string | null; notes: string | null };
  invoice?: null | {
    partyKind?: "SUPPLIER" | "CUSTOMER"; partyName?: string; partyTaxMasked?: string | null; partyAddress?: string | null;
    supplierName?: string; supplierTaxMasked?: string | null; supplierAddress?: string | null;
    externalInvoiceNumber?: string | null; supplierInvoiceNumber?: string | null; sourceInvoiceNumber: string | null; dueDate: string;
    warehouseCode?: string | null; warehouseName?: string | null;
    currencyCode: string; exchangeRate: string; subtotal: string; discountTotal: string;
    taxTotal: string; total: string; baseTotal: string; notes: string | null;
    lines: Array<{ number: number; itemCode?: string | null; itemName?: string | null; unitOfMeasureCode?: string | null; description: string; accountCode: string; accountName: string; quantity: string; unitPrice: string; discount: string; taxRate: string; tax: string; total: string }>;
  };
  entries: Array<{ number: number; date: string; description: string; lines: Array<{ number: number; accountCode: string; accountName: string; costCenter: string | null; description: string | null; currencyCode: string; exchangeRate: string; debit: string; credit: string; baseDebit: string; baseCredit: string }> }>;
};
