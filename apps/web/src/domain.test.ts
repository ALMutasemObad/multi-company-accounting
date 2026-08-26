import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "./i18n/core";
import {
  allocationsTotal,
  exchangeRateForCurrency,
  formatMoney,
  messageForError,
  statusLabel,
  toMoney,
  toRate,
  validatePaymentDraft,
  validateReceiptDraft,
  journalTotals,
  validateFiscalPeriods,
  validateJournalDraft,
  flattenTree,
  validateTreasuryAccount,
} from "./domain";

afterEach(() => setActiveLocale("ar"));

describe("واجهة سند الصرف", () => {
  it("يعرض حالات السند ورسائل الأعمال بالعربية", () => {
    expect(statusLabel("POSTED")).toBe("مرحّل");
    expect(messageForError(undefined, "OVER_ALLOCATION")).toContain("يتجاوز");
    expect(messageForError("FORBIDDEN")).toContain("الصلاحية");
  });

  it("يربط رموز حالات وأخطاء الأعمال بالقاموس الإنجليزي", () => {
    setActiveLocale("en");
    expect(statusLabel("POSTED")).toBe("Posted");
    expect(messageForError(undefined, "OVER_ALLOCATION")).toContain("exceeds");
    expect(messageForError("FORBIDDEN")).toContain("permission");
  });

  it("يضبط دقة المبالغ وأسعار الصرف", () => {
    expect(toMoney("1250.5")).toBe("1250.5000");
    expect(toRate("1")).toBe("1.00000000");
    expect(formatMoney("1250.5000")).toContain("١");
  });

  it("يقترح سعر العملة الأساسية وآخر سعر مسجل للعملة الأجنبية", () => {
    expect(exchangeRateForCurrency({ id: "1", code: "SAR", nameAr: "ريال سعودي", decimals: 2, isBase: true })).toBe("1.00000000");
    expect(exchangeRateForCurrency({ id: "2", code: "USD", nameAr: "دولار أمريكي", decimals: 2, latestExchangeRate: "3.75000000" })).toBe("3.75000000");
    expect(exchangeRateForCurrency({ id: "3", code: "EUR", nameAr: "يورو", decimals: 2 })).toBe("");
    expect(messageForError(undefined, "RATE_NOT_FOUND")).toContain("سعر صرف");
  });

  it("يجمع التوزيعات ويقبل سندًا صحيحًا", () => {
    const allocations = [
      { payableItemId: "101", allocatedAmount: "50.0000" },
      { payableItemId: "102", allocatedAmount: "75.0000" },
    ];
    expect(allocationsTotal(allocations)).toBe(125);
    expect(
      validatePaymentDraft({
        supplierId: "5",
        counterAccountId: "",
        amount: "125",
        exchangeRate: "1",
        allocations,
      }),
    ).toEqual([]);
  });

  it("يمنع جمع المورد والحساب وعدم تطابق التوزيعات", () => {
    const errors = validatePaymentDraft({
      supplierId: "5",
      counterAccountId: "9",
      amount: "100",
      exchangeRate: "1",
      allocations: [
        { payableItemId: "101", allocatedAmount: "90" },
      ],
    });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("فقط");
    expect(errors.join(" ")).toContain("مجموع");
  });

  it("يتحقق من طرف سند القبض برسالة خاصة بالعميل", () => {
    const errors = validateReceiptDraft({
      customerId: "",
      counterAccountId: "",
      amount: "50",
      exchangeRate: "1",
      allocations: [],
    });
    expect(errors).toEqual(["اختر عميلًا أو حسابًا مقابلًا فقط."]);
    expect(messageForError(undefined, "INVALID_CUSTOMER")).toContain("العميل");
  });

  it("يلزم توزيع سند الطرف ويقبل السند المباشر إلى حساب", () => {
    expect(validatePaymentDraft({
      supplierId: "5",
      counterAccountId: "",
      amount: "50",
      exchangeRate: "1",
      allocations: [],
    })).toEqual(["يجب توزيع سند الصرف المرتبط بالمورد بالكامل على التزام واحد أو أكثر."]);
    expect(validateReceiptDraft({
      customerId: "7",
      counterAccountId: "",
      amount: "50",
      exchangeRate: "1",
      allocations: [],
    })).toEqual(["يجب توزيع سند القبض المرتبط بالعميل بالكامل على فاتورة واحدة أو أكثر."]);
    expect(validatePaymentDraft({
      supplierId: "",
      counterAccountId: "9",
      amount: "50",
      exchangeRate: "1",
      allocations: [],
    })).toEqual([]);
    expect(validateReceiptDraft({
      customerId: "",
      counterAccountId: "9",
      amount: "50",
      exchangeRate: "1",
      allocations: [],
    })).toEqual([]);
  });
});

describe("السنوات المالية والقيود اليومية", () => {
  it("يرفض الفترات المتداخلة والخارجة عن حدود السنة", () => {
    const errors = validateFiscalPeriods("2026-01-01", "2026-12-31", [
      { periodNumber: 1, startDate: "2026-01-01", endDate: "2026-06-30" },
      { periodNumber: 2, startDate: "2026-06-01", endDate: "2027-01-31" },
    ]);
    expect(errors.join(" ")).toContain("تواريخ الفترة");
    expect(errors.join(" ")).toContain("تتداخل");
  });

  it("يحسب القيد بسعر الصرف ويقبل القيد المتوازن", () => {
    const entries = [{
      entryNumber: 1, entryDate: "2026-08-09", description: "إثبات مصروف",
      lines: [
        { lineNumber: 1, accountId: "1", costCenterId: null, customerId: null, supplierId: null, description: null, currencyId: "1", exchangeRate: "3.75", debitAmount: "100", creditAmount: "0" },
        { lineNumber: 2, accountId: "2", costCenterId: null, customerId: null, supplierId: null, description: null, currencyId: "1", exchangeRate: "3.75", debitAmount: "0", creditAmount: "100" },
      ],
    }];
    expect(journalTotals(entries)).toEqual({ debit: 375, credit: 375 });
    expect(validateJournalDraft(entries)).toEqual([]);
  });

  it("يرفض السطر مزدوج الطرف وكل قيد فرعي غير متوازن", () => {
    const entries = [{
      entryNumber: 1, entryDate: "2026-08-09", description: "اختبار",
      lines: [
        { lineNumber: 1, accountId: "1", costCenterId: null, customerId: null, supplierId: null, description: null, currencyId: "1", exchangeRate: "1", debitAmount: "10", creditAmount: "10" },
        { lineNumber: 2, accountId: "2", costCenterId: null, customerId: null, supplierId: null, description: null, currencyId: "1", exchangeRate: "1", debitAmount: "0", creditAmount: "5" },
      ],
    }];
    const errors = validateJournalDraft(entries);
    expect(errors.join(" ")).toContain("السطر 1");
    expect(errors.join(" ")).toContain("غير متوازن");
  });
});

describe("الدليل المحاسبي والخزينة", () => {
  it("يرتب العناصر شجريًا ويحتفظ بالعناصر ذات الأب المفقود", () => {
    const rows = flattenTree([
      { id: "2", parentId: "1", name: "فرعي" },
      { id: "1", parentId: null, name: "رئيسي" },
      { id: "3", parentId: "99", name: "منفصل" },
    ], (item) => item.parentId);
    expect(rows.map((item) => [item.id, item.treeDepth])).toEqual([["1", 0], ["2", 1], ["3", 0]]);
  });

  it("يتحقق من اسم البنك والحساب المرتبط حسب نوع حساب الخزينة", () => {
    expect(validateTreasuryAccount({ accountType: "BANK", ledgerAccountId: "", bankName: "" })).toHaveLength(2);
    expect(validateTreasuryAccount({ accountType: "BANK", ledgerAccountId: "10", bankName: "بنك الاختبار" })).toEqual([]);
    expect(validateTreasuryAccount({ accountType: "CASH", ledgerAccountId: "10", bankName: "لا يقبل" }).join(" ")).toContain("اسم بنك");
  });
});
