---
title: "SUB-4 — Electronic Payment and Subscription Billing Foundation"
status: "review candidate implemented locally; commercial provider pending"
version: "1.1"
date: "2026-08-30"
related:
  - "ADR-015-platform-commercial-operations-and-billing.md"
  - "ADR-017-platform-subscriptions-entitlements-and-electronic-payments.md"
  - "PLATFORM_SUBSCRIPTION_LIFECYCLE_SUB3_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
---

# SUB-4: أساس الدفع الإلكتروني وفوترة الاشتراك

## نتيجة هذه الشريحة وحدودها

تضيف هذه الدفعة المخطط والترحيل والخدمة والعقد والواجهات وPort مزوّد الدفع وAdapter
تطوير موقّعًا. لا تتصل بمزوّد تجاري ولا تستخدم مفاتيح حقيقية؛ لذلك لا يعني المرشح أن
النظام اجتاز PCI أو Sandbox تجاريًا، ولا يسمح بتفعيل Adapter التطوير في Production.

مالك الكتابة هو **Platform Operations & Billing**. يظل **Platform Subscriptions &
Entitlements** مالك الخطة والاشتراك والاستحقاقات والتغييرات المؤرخة، ويمر الربط بينهما
عبر Ports. لا يكتب أي منهما Sales أو Treasury أو Receivables أو Ledger للشركة العميلة.

## دورة حياة محاولة الدفع

تملك `PlatformPaymentAttempt` الحالات التالية:

- `CHECKOUT`: حجزت المحاولة محليًا قبل استدعاء المزود.
- `PENDING`: أثبت Webhook موثوق أن المعالجة بدأت وما زال إثبات النتيجة منتظرًا.
- `PAID`: أثبت Webhook موثوق الدفع وأنشئ سداد منصة واحد مرتبط بالمحاولة.
- `FAILED`: فشل نهائي موثق بكود وسبب منقحين؛ إعادة المحاولة تنشئ Attempt جديدة.
- `CANCELLED`: ألغيت المحاولة أو انتهت قبل الدفع.
- `REFUNDED`: ثبت استرداد كامل لسداد المحاولة.

يحفظ `PlatformPaymentTransition` تاريخًا append-only من `fromState` إلى `toState` مع
المصدر والفاعل أو `providerEventId`. الوصول المتأخر إلى PAID من Attempt فاشلة أو
ملغاة لا يرفض تلقائيًا إذا كان Webhook موثوقًا؛ أما فشل أو إلغاء متأخر بعد PAID
فيحفظ كإيصال `IGNORED` بلا عكس حقيقة الدفع. انتقال PAID إلى REFUNDED وحده مسموح بعد
الدفع. الخدمة تقفل Attempt وتستخدم `version` وconditional update؛ تفرد
الإيصال أو الانتقال لا يستبدل هذا القفل.

الحالات تخص التحصيل فقط. لا تغير `PlatformSubscription.status` ولا تطبق
`PlatformSubscriptionChange` تلقائيًا. تبقى موافقة التغيير وتوقيته قرارًا مستقلًا،
ولا يوجد proration في SUB-4.

## نموذج البيانات والعزل

- `PlatformPaymentAttempt` يرتبط بالفاتورة بعلاقة مركبة `(invoiceId, companyId)`،
  ويخزن `publicId` وحالة ومزودًا وبيئة ومبلغًا وminor units وعملة ونسخة وفاعل الطلب.
  يخزن SHA-256 لمفتاح Idempotency وبصمة الطلب في `BINARY(32)`، لا المفتاح الخام.
- `PlatformCheckoutSession` واحد لكل Attempt، ويحمل `companyId` وعلاقة مركبة ومزودًا
  وبيئة ومعرف Checkout وHosted URL ووقت الانتهاء. يتفرد معرف Checkout داخل
  `(providerCode, providerEnvironment)` حتى لا تتصادم Adapters أو البيئات.
- `PlatformPaymentTransition` append-only، ويمنع FK المركب إسناده إلى Attempt شركة أخرى.
- `PlatformWebhookReceipt` يتفرد بـ`provider + environment + eventId`، ويخزن
  `payloadHash` فقط. يسمح بربط Attempt اختياري مقيد بالشركة، ويحمل مراجع payment/refund
  و`amountMinor/currencyCode` الاختيارية كي يحتفظ بحدث REFUNDED المبكر حتى تظهر محاولة
  PAID التي يمكن مطابقته بها. لا يخزن payload أو signature أو headers.
- `PlatformBillingPayment.source` يميز `MANUAL` عن `ELECTRONIC_PROVIDER`. الكاتب القديم
  يبقى متوافقًا لأن القيمة الافتراضية MANUAL وفاعله مطلوب؛ السداد الإلكتروني يتطلب
  Attempt من الفاتورة والشركة نفسيهما ولا يملك `receivedById` وهميًا.
- `PlatformBillingRefund` سجل كامل موجب واحد لكل Payment/Attempt. يمكن أن ينشأ من
  طلب محلي ببصمتي Idempotency وفاعل، أو من Webhook خارجي بلا `requestedById`.
- تربط `PlatformBillingInvoice` اختياريًا subscription/plan version/subscription change
  وتحفظ `planDisplayNameSnapshot`. الأعمدة اختيارية كي يظل التطبيق السابق قادرًا على
  إصدار الفواتير أثناء الترقية.

كل قوائم التشغيل تستخدم فهارس `(company, state/date, id)` وcursor أو page
محدودة في قاعدة البيانات. يمنع تحميل كل Attempts أو Webhooks أو Refunds ثم
`filter/slice` في الذاكرة.

## الأموال والعملات

السياسة الحالية محصورة في:

| العملة | exponent | الوحدة الصغرى |
|---|---:|---:|
| SAR | 2 | 100 |
| USD | 2 | 100 |
| YER | 2 | 100 |

يحفظ المبلغ `DECIMAL(19,4)` وتخزن minor units في `BIGINT UNSIGNED`. يقيد الترحيل
المبلغ بأن يكون موجبًا وأن يساوي `amountMinor / 100`. لا Float أو `Number` للحساب.
إضافة عملة ذات exponent مختلف ليست تعديل configuration بسيطًا؛ تحتاج قرارًا وترحيلًا
واختبارات round-trip وعقودًا محدثة.

## Port وAdapters

العقد `PlatformPaymentProviderPort` يملك أنواعًا محايدة فقط:

1. إنشاء Hosted Checkout من `attemptPublicId/provider/idempotencyReference/amountMinor/
   currency/return URLs/deadline` وإرجاع معرف Checkout وURL وانتهاء ومراجع منقحة.
2. التحقق من Webhook الخام والتوقيع والطابع الزمني والبيئة قبل أي كتابة، ثم إرجاع
   حدث محايد محدود لا SDK type أو payload كاملًا.
3. طلب full refund لسداد PAID، بمفتاح مزود ثابت وdeadline، ثم انتظار Webhook مصدرًا
   للحقيقة النهائية.

يركب Adapter في composition فقط. Adapter التطوير يولد جلسة Hosted محلية
ويستخدم سر اختبار منفصلًا وتوقيعًا وطابعًا زمنيًا وevent IDs حتمية لاختبار replay
والترتيب. اسمه وبيئته `DEVELOPMENT` ولا يدعي أنه بوابة تجارية أو Sandbox. لا يسمح
بـ`LIVE` قبل Adapter خارجي ومراجعة أمنية وتشريعية مستقلة.

## حدود المعاملة وWebhooks

إنشاء Checkout مسار قابل للاستئناف:

1. داخل معاملة قصيرة: تحقق من الشركة والفاتورة والرصيد والعملة، احجز Attempt وحالة
   CHECKOUT ومفتاحها وبصمتها وانتقالها الأول.
2. خارج المعاملة: استدع Adapter ضمن deadline صريح، بلا retry لأخطاء الأعمال.
3. داخل معاملة ثانية: اقفل Attempt، تحقق من النسخة، واحفظ Checkout بصورة idempotent
   مع بقاء CHECKOUT حتى يصل حدث مزود موثوق؛ وإذا تغيّرت الحالة
   بالتزامن تلغى جلسة المزود خارج المعاملة ولا تحفظ محليًا.

معالجة Webhook تتحقق من التوقيع والطابع والبيئة خارج المعاملة وقبل الثقة بالحقول، ثم
داخل معاملة واحدة تحجز `(provider, environment, eventId)`, وتقارن `payloadHash` عند
replay، وتقفل Attempt والفاتورة، وتطبق انتقالًا واحدًا، وتنشئ
`PlatformBillingPayment` مرة واحدة عند PAID. أي أثر خارجي لاحق يكتب Outbox في المعاملة
نفسها فقط عند وجود مستهلك معروف؛ Audit أو Receipt ليسا Outbox.

الحدث المكرر بالمعرف والبصمة نفسيهما يعاد بأمان. المعرف نفسه وبصمة مختلفة يرفض
`REJECTED`. الحدث الصحيح غير القابل للتطبيق بسبب ترتيب قديم يحفظ `IGNORED`، بينما
REFUNDED السابق لـPAID يحتفظ بمراجع المطابقة ولا يضيع.

## الاسترداد

- Full refund فقط وبالمبلغ والعملة الأصليين؛ لا partial refund.
- Payment واحد يملك Refund واحدة على الأكثر، وAttempt واحدة لا تنتج Payment أو Refund
  مكررتين.
- `PENDING/SUCCEEDED/FAILED` تحمل `version`؛ لا يعاد فشل أعمال تلقائيًا.
- الترحيل يثبت الإيجابية والتطابق مع minor units والتفرد، بينما مقارنة مبلغ Refund
  بمبلغ Payment قاعدة عبر الخدمة المقفلة لأن CHECK لا يستطيع قراءة صف آخر بأمان.
- لا يعكس الاسترداد دفاتر العميل ولا يحذف الفاتورة أو السداد؛ الرصيد المنصّي مشتق من
  السداد والاسترداد الكامل.

## الأمن وتقليل PCI

- لا PAN أو CVV أو magnetic stripe أو cardholder data أو provider secret أو access
  token في قاعدة البيانات أو Audit أو logs.
- Hosted Checkout هو الاتجاه الوحيد؛ URL المحفوظ لا يسجل في logs ويعامل كبيان حساس
  محدود العمر.
- لا تخزن تواقيع Webhook أو payload الخام؛ تحفظ بصمة SHA-256 والحقول الدنيا فقط.
- توقيع Adapter التطوير ليس ضابطًا تجاريًا ولا دليل PCI. اختيار مزود حقيقي يحتاج
  توثيق الاستضافة والـSAQ والاحتفاظ والمناطق والضرائب والاسترداد والنزاع.

## الترحيل والرجوع

الترحيل `20260830190000_platform_electronic_payments` توسعي ومتوافق مع الكاتب السابق:
الأعمدة الجديدة اختيارية أو ذات default آمن، ولا حذف أو rename. يرفض rollback إذا
وجد أي Attempt أو Refund أو Webhook أو ربط اشتراك/لقطة على فاتورة أو Payment إلكتروني.
بعد أول استخدام يكون الرجوع بإبقاء المخطط وتطبيق سابق متوافق ثم Forward Migration،
لا بإسقاط التاريخ.

## بوابات الإكمال المتبقية

- Port وAdapter التطوير والخدمة وAPI/RBAC/CSRF وOpenAPI والواجهات والاختبارات المركزة
  منفذة في هذا المرشح؛ Adapter التطوير سلوكي للاختبار فقط ولا يرقى إلى LIVE.
- تبقى MariaDB 10.11 وMySQL 8.4 من قاعدة فارغة وترقية populated baseline وتوافق
  التطبيق السابق وrollback المحروس والنسخ والاستعادة بوابات CI إلزامية قبل الدمج.
- إضافة مزوّد Sandbox تجاري لاحقًا تحتاج Adapter مستقلًا في composition، وإدارة أسرار
  خارج قاعدة البيانات، ومراجعة توقيع/شبكة/مهل/PCI/تشريع؛ لا تغيّر عقد المجال المحايد.

**Barcode Impact: N/A.** لا يتغير تعريف صنف أو البحث عنه أو إدخال/إخراج مستند صنف.
