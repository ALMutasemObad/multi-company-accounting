import type { PrintSnapshot } from "../../src/printing/print-types.js";

export const printSnapshotFixture: PrintSnapshot = {
  formatVersion: 1,
  archivedAt: "2026-08-11T10:30:00.000Z",
  company: { id: "1", name: "شركة المثال للتطوير العقاري", timezone: "Asia/Riyadh", baseCurrencyCode: "SAR", baseCurrencyNameAr: "ريال سعودي" },
  document: { id: "118", type: "RECEIPT", number: "REC-2026-000118", date: "2026-08-11", description: "تحصيل دفعة حجز الوحدة السكنية رقم 24", statusAtArchive: "POSTED", createdAt: "2026-08-11T10:00:00.000Z", postedAt: "2026-08-11T10:30:00.000Z", creatorName: "مدير النظام", posterName: "مدير النظام" },
  settlement: { counterpartyName: "مؤسسة آفاق العمران", counterpartyTaxMasked: "***6789", counterpartyAddress: "الرياض", cashBankAccount: "1010 — البنك السعودي", paymentMethod: "تحويل بنكي", currencyCode: "SAR", exchangeRate: "1.00000000", amount: "125000.0000", baseAmount: "125000.0000", referenceNumber: "TRX-982741", notes: "دفعة أولى وفق العقد" },
  entries: [
    {
      number: 1,
      date: "2026-08-11",
      description: "إثبات سند القبض",
      lines: [
        { number: 1, accountCode: "101020", accountName: "البنك السعودي", costCenter: "مشروع النخيل", description: "إيداع الدفعة", currencyCode: "SAR", exchangeRate: "1", debit: "125000", credit: "0", baseDebit: "125000", baseCredit: "0" },
        { number: 2, accountCode: "210110", accountName: "دفعات العملاء المقدمة", costCenter: "مشروع النخيل", description: "دفعة العميل", currencyCode: "SAR", exchangeRate: "1", debit: "0", credit: "125000", baseDebit: "0", baseCredit: "125000" },
      ],
    },
  ],
};
