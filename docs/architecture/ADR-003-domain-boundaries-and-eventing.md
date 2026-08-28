---
title: "ADR-003 — Domain Boundaries and Transactional Eventing"
status: "accepted"
version: "1.1"
date: "2026-08-21"
supersedes: []
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "AR_AP_SETTLEMENT_ITEMS_AR.md"
  - "TREASURY_CONTEXT_OWNERSHIP_AR.md"
---

# ADR-003: حدود المجالات والأحداث الموثوقة داخل الـModular Monolith

## السياق

النظام مبني كـModular Monolith ويحتاج Strong Consistency للترحيل المحاسبي. التدقيق كشف أن حدود المجالات موجودة ضمنيًا، لكن الخدمات المالية تشترك مباشرة في Prisma models الخاصة بالمستندات والقيود، كما أن البريد وبعض الأعمال اللاحقة للـcommit لا تملك تسليمًا durable.

ADR-001 منع Queue أو Microservice دون ADR، ورفض Eventual Consistency لدفتر الأستاذ. هذا القرار يحافظ على ذلك، ويسمح فقط ببنية أحداث داخلية موثوقة للأعمال التي يمكن تنفيذها بعد نجاح المعاملة.

## القرار

### 1. شكل النظام

- يبقى النظام Modular Monolith.
- لا Microservices أو Broker خارجي في هذه المرحلة.
- تفصل Bounded Contexts منطقيًا عبر Ownership وPorts داخل العملية.

### 2. ملكية دفتر الأستاذ

- Core Accounting هو المالك الوحيد لـ`AccountingDocument`, `JournalEntry`, و`JournalLine` من ناحية الترحيل والعكس.
- `PostingEngine` المركزي هو منفذ الترحيل والعكس الوحيد للمستندات المالية، بينما تبقى كتابة مسودة القيد داخل Core Accounting.
- Context المصدر يبني Posting Plan، بينما Ledger يتحقق ويحفظ الأثر.
- الترحيل والعكس والتسوية المالية الأساسية تبقى داخل معاملة ACID واحدة.

### 3. الاتصال بين السياقات

- invariant مطلوب قبل commit: استدعاء متزامن عبر Port.
- side effect بعد commit: Domain/Integration Event عبر Transactional Outbox.
- لا HTTP داخلي بين وحدات المونوليث.

عقد Treasury مع AR/AP يستخدم `ReceivableItemId/PayableItemId` عبر منافذ تسوية متزامنة داخل المعاملة. لا تعبر هوية `JournalLine` هذا الحد.

تعتمد Sales وPurchases على `TaxQuotePort` متزامن داخل المعاملة للحصول على النسبة والحساب المناسبين؛ وحدة `Tax` وحدها تكتب `TaxRate`، بينما تحفظ الفاتورة لقطة النسبة والمبلغ.

تستهلك خدمتا Receipt وPayment داخل Treasury `TreasuryInstrumentPort` متزامنًا للتحقق من صندوق/بنك الشركة وطريقة الدفع والمرجع الإلزامي. وحدة Treasury وحدها تكتب `CashBankAccount/PaymentMethod`، بينما يمر تجهيز الطرق العامة عبر Setup port مملوك لها.

### 4. Transactional Outbox

- يضاف Outbox في مرحلة تنفيذ مستقلة عبر Prisma Migration.
- يحفظ الحدث في نفس معاملة تغيير المجال.
- يعالج Worker الأحداث بأسلوب At-least-once.
- كل Handler يجب أن يكون idempotent.
- يسمح بWorker داخل نفس deployment أو process منفصل يستخدم قاعدة البيانات نفسها.
- لا يعتبر السماح بالـOutbox موافقة على Kafka/RabbitMQ أو أي Broker خارجي؛ ذلك يحتاج ADR جديدًا.

### 5. الأحداث

- تبدأ الأولوية بـ`RegistrationVerificationRequested`.
- تليها أحداث المستندات المرحلة والمعكوسة والفترات المغلقة/المعاد فتحها عندما يوجد مستهلك واضح.
- تستخدم أسماء past tense وعقود versioned.
- لا تنشر Prisma records كاملة.
- لا تستخدم `AuditLog` أو `SecurityEvent` أو logs التشغيلية كـOutbox.
- لا Event Sourcing في القرار الحالي.

### 6. موضع Outbox داخل المعاملة

```text
reserve idempotency
load and validate aggregate
execute domain transition
persist ledger/source changes
append audit
append outbox event
complete idempotency
commit
```

إذا فشلت المعاملة فلا يوجد حدث قابل للنشر. إذا نجحت وتعطل التطبيق لاحقًا، يبقى الحدث في Outbox لإعادة المحاولة.

## البدائل التي تم رفضها

### Eventual posting

رفض لأن نجاح مستند المصدر دون قيده أو العكس دون أثر كامل يخرق سلامة النظام المالي.

### In-memory event bus فقط

رفض للأعمال الموثوقة؛ يفقد الحدث عند تعطل العملية بعد commit.

### استخدام AuditLog كـOutbox

رفض لاختلاف غرض السجل وعقده وسياسة الاحتفاظ وحالة التسليم.

### Broker خارجي الآن

رفض لعدم وجود حاجة تشغيلية تبرر مكونًا إضافيًا وتعقيد النشر والمراقبة.

### تحويل النظام إلى Microservices

رفض لأن المشكلة الحالية هي Ownership داخل المونوليث، وليس قيود النشر أو التوسع المستقل.

## النتائج الإيجابية

- حدود أوضح دون خسارة المعاملات المحلية.
- موثوقية أفضل للبريد والتكاملات.
- إزالة تدريجية لتكرار الترحيل.
- إمكانية إضافة projections أو Broker لاحقًا دون تغيير نموذج المجال الأساسي.

## التكاليف والمخاطر

- إضافة Outbox worker ومراقبة retries والتراكم.
- ضرورة idempotency في المستهلكين.
- إعادة هيكلة تدريجية لخدمات مالية كبيرة.
- ضرورة إبقاء الحارس المعماري محدثًا حتى لا تعود الكتابات العابرة للسياقات بعد اكتمال الترحيل.

## خطة التطبيق

1. [x] منع المخالفات الجديدة وتثبيت Context Map.
2. [x] استخراج Posting Engine وPosting Plans لكل المسارات المالية الحالية.
3. [x] إضافة Outbox migration وworker مع بريد التسجيل.
4. [x] إضافة event contracts واختبارات retry/idempotency.
5. [x] فصل هوية تسويات Treasury عن Ledger بعناصر ذمم مملوكة لـAR/AP.
6. [x] حسم ملكية Tax والحاسبة والنسخ المتفائلة عبر منفذ واحد.
7. [x] حسم ملكية Treasury ومرجعيات أدوات النقد والنسخ المتفائلة عبر منفذ واحد.
8. [ ] نقل أحداث المستندات والفترات عند وجود مستهلكين.
9. [ ] تقييم Broker فقط عبر قياسات وADR جديد.

## مؤشرات نجاح القرار

- لا توجد كتابة جديدة في Ledger خارج Core Accounting.
- لا توجد Network I/O داخل المعاملات.
- لا يفقد بريد التسجيل بعد نجاح الطلب.
- جميع handlers قابلة لإعادة التنفيذ دون أثر مكرر.
- لا تستخدم السجلات الرقابية كناقل أحداث.
- انخفاض عدد direct cross-context Prisma accesses مع كل مرحلة.

## حالة التطبيق

نُفذت في 21 أغسطس 2026 أول شريحة من القرار عبر الترحيل `20260822100000_transactional_outbox` والحدث `RegistrationVerificationRequested`:

- يكتب الطلب والحدث داخل معاملة التسجيل نفسها.
- يعالج عامل داخل المونوليث الحدث بأسلوب at-least-once مع claim شرطي وlease وretry محدود وbackoff+jitter.
- لا يحمل العقد البريد أو كلمة المرور أو رمز التحقق؛ يشتق الرمز بمفتاح مستقل ولا يخزن إلا Hash الرمز.
- يغطي الاختبار الالتزام قبل البريد، والتسليم المكرر، وانتهاء lease، وتوقف المزود والتعافي، وdead letter والاحتفاظ.

لا يغير هذا التنفيذ قرار بقاء Ledger strongly consistent، ولا يضيف Broker أو خدمة مستقلة.

نُفذت في 22 أغسطس 2026 شريحة ملكية دفتر الأستاذ:

- أضيف `PostingEngine` داخل Core Accounting، ونُقلت إليه عمليات ترحيل وعكس القيود اليدوية وسندات القبض والصرف وفواتير المبيعات والمشتريات وإشعاراتها.
- تبني سياقات المصدر Posting Plans فقط؛ إنشاء `JournalEntry` و`JournalLine` المرحلين وتغيير حالات `POSTED/REVERSED` يجريان داخل المحرك.
- أضيف حارس معماري عام يمسح جميع ملفات مصدر الـAPI ويمنع أي كتابة مباشرة أو متداخلة أو SQL خام إلى Ledger خارج `PostingEngine` وخدمة مسودة القيد اليدوي المملوكين لـCore Accounting.
- تشترك عمليات الترحيل وإغلاق الفترة في قفل صف الفترة، وتشترك التسويات وعكس الفاتورة في أقفال `ReceivableItem/PayableItem` المرتبة تصاعديًا قبل أقفال Ledger.

نُفذت في 22 أغسطس 2026 شريحة عناصر الذمم:

- أضيف `ReceivableItem` و`PayableItem` بأرصدة مادية وحالة ونسخة وعزل شركة.
- أصبحت تخصيصات القبض والدفع تشير إلى العنصر، وتنفذ Treasury التغيير عبر منفذ AR/AP صغير داخل معاملة `PostingEngine`.
- غطى الترحيل backfill والتخصيصات التاريخية وحواجز الفشل الآمن، ونجح من قاعدة فارغة ومن مخطط سابق ببيانات على MariaDB 10.4.32 وMySQL 8.4.11.
- تغطي الاختبارات عكس القبض والدفع والإشعارات، over-allocation، وسباق reverse-vs-settlement.

لا يوجد Broker أو اتساق نهائي لدفتر الأستاذ في هذه الشرائح.

نُفذت في 22 أغسطس 2026 شريحة ملكية Tax:

- أصبحت `TaxService` المالك الوحيد لـ`TaxRate` ومساري HTTP الحاليين، وأزيل CRUD من Sales/Purchases.
- توحد حساب الخصم والضريبة والعملة الأساسية في `calculateTaxDocument` مع تطابق تقريب تفاصيل Posting.
- أضيفت `version` متفائلة، ويمر تعارض قاعدة البيانات عبر `TransactionExecutor` قبل إرجاع `VERSION_CONFLICT` للنسخة القديمة.
- نجح الترحيل التوسعي من الصفر وكترقية بصفوف تاريخية، ونجحت حزمة 168 اختبار API على MariaDB 10.4.32 وMySQL 8.4.11.

نُفذت في 22 أغسطس 2026 شريحة ملكية Treasury:

- أصبحت `TreasuryService` المالك الوحيد لـ`CashBankAccount/PaymentMethod` ومساراتهما الحالية، وأزيل CRUD من Customer/Supplier reference services.
- تستهلك Receipt وPayment `TreasuryInstrumentPort` داخل المعاملة بدل Prisma reads المكررة، من دون دمج قواعد AR وAP.
- أضيفت `version` متفائلة للتعديل والتعطيل، وتمر الأخطاء العابرة عبر `TransactionExecutor` بينما تعاد النسخة القديمة كـ409.
- نجح الترحيل التوسعي من الصفر وكترقية بمرجعيات تاريخية، ونجحت حزمة 178 اختبار API على MariaDB 10.4.32 وMySQL 8.4.11.
