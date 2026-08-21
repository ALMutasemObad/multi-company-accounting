import type { Allocation, Currency, JournalEntry, Payment } from "./types";

export const statusLabels: Record<Payment["document"]["status"], string> = {
  DRAFT: "مسودة",
  POSTED: "مرحّل",
  CANCELLED: "ملغي",
  REVERSED: "معكوس",
};

export const errorLabels: Record<string, string> = {
  EMAIL_EXISTS: "البريد الإلكتروني مستخدم مسبقًا.",
  SELF_ROLE_CHANGE: "لا يمكنك تغيير أدوارك بنفسك. استخدم مسؤولًا آخر.",
  SELF_DISABLE: "لا يمكنك تعطيل حسابك الحالي.",
  INVALID_ROLE: "أحد الأدوار المحددة غير صالح أو تابع لشركة أخرى.",
  ROLE_CODE_EXISTS: "رمز الدور مستخدم مسبقًا داخل الشركة.",
  INVALID_PERMISSION: "إحدى الصلاحيات المحددة غير صالحة.",
  SYSTEM_ROLE_PROTECTED: "الدور النظامي محمي ولا يمكن تعديله أو تعطيله.",
  UNAUTHENTICATED: "انتهت الجلسة. سجل الدخول مرة أخرى.",
  FORBIDDEN: "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.",
  INVALID_CSRF: "انتهت صلاحية الحماية. سجل الدخول مرة أخرى.",
  VALIDATION_ERROR: "تحقق من الحقول المطلوبة وصيغ القيم.",
  NOT_FOUND: "لم يعد السجل المطلوب موجودًا.",
  CODE_EXISTS: "الرمز مستخدم مسبقًا داخل الشركة.",
  INVALID_ACCOUNT: "الحساب المحدد غير صالح للترحيل.",
  INVALID_SUPPLIER: "المورد المحدد غير نشط أو غير صالح.",
  INVALID_CUSTOMER: "العميل المحدد غير نشط أو غير صالح.",
  INVALID_CASH_BANK_ACCOUNT: "الصندوق أو الحساب البنكي غير صالح.",
  INVALID_PAYMENT_METHOD: "طريقة الدفع المحددة غير صالحة.",
  REFERENCE_REQUIRED: "الرقم المرجعي مطلوب لطريقة الدفع المحددة.",
  INVALID_CURRENCY: "العملة أو سعر الصرف غير صالح.",
  CURRENCY_NOT_FOUND: "العملة المطلوبة غير موجودة أو غير نشطة.",
  CURRENCY_NOT_ENABLED: "العملة غير مفعلة للشركة الحالية.",
  BASE_CURRENCY_RATE: "لا يُسجل سعر صرف مستقل للعملة الأساسية.",
  RATE_NOT_FOUND: "لا يوجد سعر صرف نافذ للعملة في التاريخ المحدد.",
  INVALID_AMOUNT: "يجب أن يكون المبلغ وسعر الصرف أكبر من صفر.",
  ALLOCATION_MISMATCH: "يجب أن يساوي مجموع التوزيعات مبلغ السند.",
  INVALID_ALLOCATION: "أحد التوزيعات لا يطابق الطرف أو العملة أو السطر المرحّل.",
  OVER_ALLOCATION: "التوزيع يتجاوز الرصيد المتبقي على السطر المستهدف.",
  VERSION_CONFLICT: "عُدّل السجل من مستخدم آخر. حدّث الصفحة وحاول مجددًا.",
  INVALID_STATE: "لا يمكن تنفيذ العملية في الحالة الحالية للسند.",
  PERIOD_CLOSED: "الفترة المالية مغلقة.",
  DATE_OUTSIDE_PERIOD: "تاريخ السند خارج الفترة المالية المحددة.",
  COUNTERPARTY_REQUIRED: "اختر طرفًا أو حسابًا مقابلًا، وليس كليهما.",
  IDEMPOTENCY_MISMATCH: "استُخدم مفتاح العملية سابقًا لطلب مختلف.",
  IDEMPOTENCY_IN_PROGRESS: "العملية قيد التنفيذ بالفعل. انتظر قليلًا.",
  ALREADY_REVERSED: "تم عكس السند مسبقًا.",
  INTERNAL_ERROR: "تعذر إكمال العملية بسبب خطأ غير متوقع.",
  DATE_RANGE_INVALID: "نطاق التاريخ غير صحيح؛ يجب ألا يسبق تاريخ النهاية تاريخ البداية.",
  OVERLAP: "يوجد تداخل بين الفترات أو مع سنة مالية قائمة.",
  PERIOD_OUTSIDE_YEAR: "يجب أن تقع جميع الفترات داخل حدود السنة المالية.",
  ORDER_VIOLATION: "يجب تنفيذ إغلاق أو إعادة فتح الفترات حسب ترتيبها الزمني.",
  DATES_LOCKED: "لا يمكن تعديل التواريخ بعد استخدام السنة أو الفترة في مستندات مالية.",
  DRAFT_DOCUMENTS_EXIST: "توجد مستندات مسودة في الفترة؛ رحّلها أو ألغها قبل الإغلاق.",
  RECONCILIATION_FAILED: "فشلت مراجعة اتزان الفترة، لذلك لم يتم إغلاقها.",
  INVALID_LINE: "أحد أسطر القيد غير مكتمل أو يحتوي مبلغًا مدينًا ودائنًا معًا.",
  INVALID_COST_CENTER: "مركز التكلفة المحدد غير صالح.",
  DUPLICATE_NUMBER: "أرقام القيود أو الأسطر يجب أن تكون فريدة.",
  UNBALANCED: "إجمالي المدين لا يساوي إجمالي الدائن.",
  MAKER_CHECKER_VIOLATION: "لا يمكن لمن أنشأ القيد ترحيله؛ يلزم مستخدم آخر وفق فصل المهام.",
  INVALID_PARENT: "الحساب أو المركز الأب غير صالح أو غير نشط.",
  CYCLE_DETECTED: "لا يمكن نقل العنصر تحت أحد فروعه؛ سيؤدي ذلك إلى دورة شجرية.",
  LEVEL_EXCEEDED: "تجاوزت الشجرة الحد الأقصى المسموح للمستويات.",
  HAS_ACTIVE_CHILDREN: "لا يمكن تعطيل عنصر لديه فروع نشطة.",
  HAS_CHILDREN: "احذف الحسابات الفرعية أولًا قبل حذف هذا الحساب.",
  ACCOUNT_IN_USE: "لا يمكن حذف الحساب لأنه مستخدم في قيود أو مستندات أو إعدادات محاسبية. يمكنك تعطيله بدلًا من ذلك.",
  TEMPLATE_CONFLICT: "تعذر تطبيق الدليل الافتراضي بسبب تعارض في رمز حساب أو بنية حساب أب. راجع الحسابات الحالية ثم أعد المحاولة.",
  POSTING_NOT_ALLOWED: "الحساب غير صالح للترحيل أو لديه حسابات فرعية.",
  INVALID_BANK_DETAILS: "اسم البنك مطلوب للحسابات البنكية، ولا يقبل للصندوق النقدي.",
  READ_ONLY_REFERENCE: "طريقة الدفع العامة مرجعية ولا يمكن تعديلها أو تعطيلها داخل الشركة.",
  INVALID_TAX_RATE: "نسبة الضريبة أو حساب ضريبة المدخلات/المخرجات غير صالح.",
  INVALID_DISCOUNT: "قيمة الخصم لا يمكن أن تتجاوز قيمة السطر.",
  INVALID_TOTAL: "يجب أن يكون إجمالي الفاتورة أكبر من صفر وأن تكون التواريخ صحيحة.",
  SOURCE_INVOICE_REQUIRED: "اختر الفاتورة الأصلية للإشعار الدائن.",
  INVALID_SOURCE_INVOICE: "الفاتورة الأصلية غير صالحة أو لا تخص العميل والعملة المحددين.",
  CREDIT_EXCEEDS_INVOICE: "إجمالي الإشعارات الدائنة يتجاوز قيمة الفاتورة الأصلية.",
  DEBIT_EXCEEDS_INVOICE: "إجمالي الإشعارات المدينة يتجاوز قيمة فاتورة المورد الأصلية.",
  HAS_SETTLEMENTS: "لا يمكن عكس فاتورة مرتبطة بسداد أو تحصيل أو إشعار مرحّل؛ عالج المستندات المرتبطة أولًا.",
  DUPLICATE_VALUE: "الرمز أو القيمة مستخدمة مسبقًا داخل الشركة.",
};

export function messageForError(code?: string, reason?: string) {
  return errorLabels[reason ?? ""] ?? errorLabels[code ?? ""] ?? "تعذر إكمال الطلب. حاول مرة أخرى.";
}

export function formatMoney(value: string | number) {
  const amount = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function exchangeRateForCurrency(currency?: Currency) {
  if (!currency) return "";
  if (currency.isBase) return "1.00000000";
  return currency.latestExchangeRate ?? "";
}

export function allocationsTotal(allocations: Allocation[]) {
  return allocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocatedAmount || 0),
    0,
  );
}

export function validatePaymentDraft(input: {
  supplierId: string;
  counterAccountId: string;
  amount: string;
  exchangeRate: string;
  allocations: Allocation[];
}) {
  const errors: string[] = [];
  if (Boolean(input.supplierId) === Boolean(input.counterAccountId))
    errors.push("اختر موردًا أو حسابًا مقابلًا فقط.");
  if (Number(input.amount) <= 0) errors.push("أدخل مبلغًا أكبر من صفر.");
  if (Number(input.exchangeRate) <= 0)
    errors.push("أدخل سعر صرف أكبر من صفر.");
  if (
    input.allocations.length > 0 &&
    Math.abs(allocationsTotal(input.allocations) - Number(input.amount)) > 0.00005
  )
    errors.push("مجموع التوزيعات يجب أن يساوي مبلغ السند.");
  if (
    input.allocations.some(
      (allocation) =>
        !allocation.targetJournalLineId ||
        Number(allocation.allocatedAmount) <= 0,
    )
  )
    errors.push("أكمل رقم السطر وقيمة كل توزيع.");
  return errors;
}

export function validateReceiptDraft(input: {
  customerId: string;
  counterAccountId: string;
  amount: string;
  exchangeRate: string;
  allocations: Allocation[];
}) {
  return validatePaymentDraft({
    supplierId: input.customerId,
    counterAccountId: input.counterAccountId,
    amount: input.amount,
    exchangeRate: input.exchangeRate,
    allocations: input.allocations,
  }).map((message) => message.replace("موردًا", "عميلًا"));
}

export function toMoney(value: string) {
  const numeric = Number(value || 0);
  return numeric.toFixed(4);
}

export function toRate(value: string) {
  const numeric = Number(value || 0);
  return numeric.toFixed(8);
}

export function journalTotals(entries: JournalEntry[]) {
  return entries.flatMap((entry) => entry.lines).reduce(
    (total, line) => ({
      debit: total.debit + Number(line.debitAmount || 0) * Number(line.exchangeRate || 0),
      credit: total.credit + Number(line.creditAmount || 0) * Number(line.exchangeRate || 0),
    }),
    { debit: 0, credit: 0 },
  );
}

export function validateJournalDraft(entries: JournalEntry[]) {
  const errors: string[] = [];
  if (!entries.length) errors.push("أضف قيدًا واحدًا على الأقل.");
  entries.forEach((entry, entryIndex) => {
    if (!entry.description.trim()) errors.push(`أكمل وصف القيد ${entryIndex + 1}.`);
    if (entry.lines.length < 2) errors.push(`يحتاج القيد ${entryIndex + 1} إلى سطرين على الأقل.`);
    entry.lines.forEach((line, lineIndex) => {
      const debit = Number(line.debitAmount || 0);
      const credit = Number(line.creditAmount || 0);
      if (!line.accountId || !line.currencyId || Number(line.exchangeRate) <= 0 || (debit > 0) === (credit > 0))
        errors.push(`راجع بيانات السطر ${lineIndex + 1} في القيد ${entryIndex + 1}.`);
    });
    const entryTotals = journalTotals([entry]);
    if (Math.abs(entryTotals.debit - entryTotals.credit) > 0.00005)
      errors.push(`القيد ${entryIndex + 1} غير متوازن بالعملة الأساسية.`);
  });
  const totals = journalTotals(entries);
  if (entries.length && Math.abs(totals.debit - totals.credit) > 0.00005)
    errors.push("يجب أن يتساوى إجمالي المدين والدائن بالعملة الأساسية.");
  return errors;
}

export function validateFiscalPeriods(yearStart: string, yearEnd: string, periods: Array<{ periodNumber: number; startDate: string; endDate: string }>) {
  const errors: string[] = [];
  if (!yearStart || !yearEnd || yearEnd < yearStart) errors.push("نطاق السنة المالية غير صحيح.");
  if (!periods.length) errors.push("أضف فترة مالية واحدة على الأقل.");
  const numbers = new Set<number>();
  periods.forEach((period, index) => {
    if (numbers.has(period.periodNumber)) errors.push("أرقام الفترات يجب أن تكون فريدة.");
    numbers.add(period.periodNumber);
    if (!period.startDate || !period.endDate || period.endDate < period.startDate || period.startDate < yearStart || period.endDate > yearEnd)
      errors.push(`راجع تواريخ الفترة ${index + 1}.`);
  });
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i += 1)
    if (sorted[i]!.startDate <= sorted[i - 1]!.endDate) errors.push("لا يمكن أن تتداخل الفترات المالية.");
  return [...new Set(errors)];
}

export function flattenTree<T extends { id: string }>(items: T[], parentOf: (item: T) => string | null) {
  const children = new Map<string | null, T[]>();
  items.forEach((item) => children.set(parentOf(item), [...(children.get(parentOf(item)) ?? []), item]));
  const result: Array<T & { treeDepth: number }> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id); result.push({ ...item, treeDepth: depth }); walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  items.forEach((item) => { if (!visited.has(item.id)) { visited.add(item.id); result.push({ ...item, treeDepth: 0 }); walk(item.id, 1); } });
  return result;
}

export function validateTreasuryAccount(input: { accountType: "CASH" | "BANK"; ledgerAccountId: string; bankName: string }) {
  const errors: string[] = [];
  if (!input.ledgerAccountId) errors.push("اختر حساب الأستاذ المرتبط.");
  if (input.accountType === "BANK" && !input.bankName.trim()) errors.push("اسم البنك مطلوب للحساب البنكي.");
  if (input.accountType === "CASH" && input.bankName.trim()) errors.push("لا تُدخل اسم بنك للصندوق النقدي.");
  return errors;
}
