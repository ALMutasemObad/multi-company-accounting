export const paymentMethodDefinitions = [
  { code: "CASH", nameAr: "نقدي", requiresReference: false },
  { code: "BANK_TRANSFER", nameAr: "تحويل بنكي", requiresReference: true },
  { code: "CARD", nameAr: "بطاقة", requiresReference: true },
  { code: "CHEQUE", nameAr: "شيك", requiresReference: true },
] as const;
