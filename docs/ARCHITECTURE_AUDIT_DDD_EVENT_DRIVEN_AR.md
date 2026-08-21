---
title: "Architecture Audit — DDD and Event-Driven"
project: "نظام جوار المالي"
language: "ar"
audit_type: "read-only architecture assessment"
focus:
  - "Domain-Driven Design (DDD)"
  - "Bounded Contexts"
  - "Coupling and ownership"
  - "Event-Driven Architecture"
  - "Recommended event insertion points"
audit_date: "2026-08-21"
repository_scope: "project working tree as inspected"
implementation_changes: false
confidence: "high for static architecture findings"
---

# تقرير تدقيق معمارية نظام جوار المالي

## الغرض من المستند

هذا المستند مخصص للمراجعة البشرية أو للإدخال إلى نموذج ذكاء اصطناعي آخر لتقييم معمارية النظام، وتحديدًا في:

- Domain-Driven Design.
- Bounded Contexts.
- أماكن الترابط القوي بين المجالات.
- الوضع الحالي للـEvent-Driven Architecture.
- الأحداث المقترحة وأماكن إدخالها.

التقييم مبني على قراءة الكود ومخطط Prisma والوثائق المعمارية والاختبارات في نسخة الـworking tree التي كانت موجودة وقت التدقيق. لم يتضمن التدقيق تعديل كود النظام أو مخطط قاعدة البيانات.

> ملاحظة للمراجع: كانت توجد تغييرات غير ملتزمة مسبقًا في الـworking tree عند إجراء التدقيق. لذلك يعكس التقرير الحالة الحالية التي تمت معاينتها، وليس بالضرورة آخر commit في Git.

## أسئلة مقترحة للمراجع أو نموذج الذكاء الاصطناعي الآخر

1. هل تصنيف الـBounded Contexts المقترح يعكس لغة الأعمال الفعلية للنظام؟
2. هل يجب أن تكون المقبوضات والمدفوعات ضمن Treasury أم ضمن AR/AP؟
3. هل يمكن إنشاء مالك مركزي للترحيل المحاسبي دون زيادة غير ضرورية في التعقيد؟
4. هل Transactional Outbox مناسب للنشر الحالي على MySQL/MariaDB؟
5. ما أقل خطة إعادة هيكلة تقلل الترابط مع المحافظة على سلامة القيود المحاسبية؟

## الوثائق الحاكمة الناتجة عن التدقيق

هذا التقرير تشخيصي. التوصيات التي يجب الالتزام بها مستقبلًا حُولت إلى وثائق معيارية داخل `docs/architecture`:

- `docs/architecture/ARCHITECTURE_GUARDRAILS_AR.md`
- `docs/architecture/BOUNDED_CONTEXT_MAP_AR.md`
- `docs/architecture/ADR-003-domain-boundaries-and-eventing.md`
- `docs/architecture/CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md`
- `docs/architecture/CHANGE_REVIEW_CHECKLIST_AR.md`

كما يوجه `AGENTS.md` أي وكيل أو مطور آلي إلى قراءتها قبل تنفيذ تغيير معماري.

# 1. الحكم التنفيذي

النظام حاليًا **Modular Monolith جيد من ناحية المعاملات والعزل المحاسبي**، لكنه ليس تطبيق DDD مكتملًا ولا نظامًا Event-Driven فعليًا.

تقسيم المجلدات يعكس مجالات العمل، لكن الحدود غير محمية معماريًا. معظم الوحدات تصل مباشرة إلى Prisma وتكتب في `AccountingDocument`, `JournalEntry`, و`JournalLine`. نتيجة ذلك أن دفتر الأستاذ ليس له مالك واحد، وقواعد الترحيل والعكس موزعة ومكررة بين خدمات المستندات المختلفة.

التوصية الأساسية:

> الاستمرار كـModular Monolith، وإنشاء Core Accounting/Posting Engine مركزي، ثم إدخال Domain Events وTransactional Outbox للأعمال اللاحقة للـcommit. لا يُحوّل الترحيل المحاسبي نفسه إلى Eventual Consistency.

# 2. التقييم المختصر

هذه الدرجات مؤشرات معمارية تقريبية وليست قياسًا رياضيًا:

| المحور | التقييم | الملاحظة |
|---|---:|---|
| Modular Monolith | 3/5 | تقسيم وظيفي جيد، لكن الحدود غير مفروضة |
| Strategic DDD | 2.5/5 | المجالات واضحة ضمنيًا، ولا توجد Context Map أو Ownership صريح |
| Tactical DDD | 1.5/5 | الخدمات Transaction Scripts، ولا توجد Aggregates أو Domain Events أو Value Objects واضحة |
| سلامة المعاملات | 4/5 | معاملات، Idempotency، Optimistic Version وعزل شركة جيد |
| Event-Driven | 1/5 | توجد سجلات أحداث، لكن لا يوجد Event Bus أو Outbox أو Subscribers |
| جاهزية التحول التدريجي | 4/5 | المونوليث الحالي يسمح بالإصلاح دون Microservices |

الوثائق تقرر وجود `PostingEngine` مركزي وتواصل عبر interfaces/services، لكن التنفيذ الفعلي لا يحتوي هذا المحرك حتى الآن.

الأدلة:

- `HANDOFF_CURRENT/01_PROJECT_DOCUMENTATION/docs/07-architecture.md:34-69`
- `HANDOFF_CURRENT/01_PROJECT_DOCUMENTATION/decisions/ADR-001-architecture.md:16-26`
- `project/apps/api/src/server.ts:47-66`

# 3. الشكل المعماري الحالي

```text
React/Vite UI
     |
Express Routers
     |
Application/Transaction Services
     |
PrismaClient direct access
     |
Shared MySQL/MariaDB schema
```

الخدمات تُنشأ في Composition Root واحد، وهذا مناسب للـModular Monolith، لكن كل خدمة تحصل غالبًا على `PrismaClient` الكامل، وبالتالي تستطيع الوصول إلى جداول أي مجال آخر.

الأدلة:

- `project/apps/api/src/server.ts:30-66`
- `project/apps/api/src/app.ts:84-137`

# 4. الـBounded Contexts الموجودة منطقيًا

## 4.1 جدول السياقات

| Bounded Context | الوحدات والكيانات الحالية | التصنيف | حالة الحدود |
|---|---|---|---|
| Identity & Access | `auth`, `users`, `User`, `Session`, `Role`, `Permission`, `UserCompany` | Generic/Supporting | واضح نسبيًا |
| Tenant & Company Configuration | `companies`, `platform`, `Organization`, `Company`, العملات وأسعار الصرف | Supporting | موجود، لكنه يقرأ مباشرة من جميع الوحدات المالية |
| Registration & Onboarding | `registration`, `RegistrationRequest`, `RegistrationEvent`, تجهيز الشركة | Supporting Process | له دورة حياة واضحة، لكنه يعبر عدة Contexts مباشرة |
| Core Accounting | `fiscal`, `accounts`, `journals`, المستند المحاسبي والقيود ودليل الحسابات | Core Domain | أهم Context، لكن ملكيته غير حصرية |
| Sales & Accounts Receivable | `sales`, العملاء، فواتير المبيعات، الإشعارات الدائنة، الذمم | Core/Supporting | موجود لكنه مجزأ |
| Purchases & Accounts Payable | `purchases`, `suppliers`, فواتير المشتريات، الإشعارات المدينة | Core/Supporting | واضح نسبيًا، لكنه يكتب في Ledger مباشرة |
| Treasury | الصناديق والبنوك، طرق الدفع، المقبوضات والمدفوعات | Core/Supporting | موجود ضمنيًا وموزع بين عدة خدمات |
| Tax Configuration | `TaxRate` وحسابا ضريبة المدخلات والمخرجات | Supporting | ملكيته ملتبسة بين المبيعات والمشتريات |
| Reporting | `reports`, Dashboard، الأستاذ، القوائم المالية | Supporting/Read Model | Context قراءة downstream مناسب |
| Document Output | `printing`, أرشيف لقطات الطباعة وPDF | Supporting | واضح |
| Audit & Security Monitoring | `audit`, `security`, `AuditLog`, `SecurityEvent` | Generic/Supporting | واضح، لكنه ليس Event Bus |

## 4.2 Context Map مختصرة

```text
Registration & Onboarding
    ├──> Tenant & Company Configuration
    ├──> Identity & Access
    └──> Core Accounting Setup

Sales & AR ─────────┐
Purchases & AP ─────┼──> Core Accounting / General Ledger
Treasury ───────────┘

Reporting <──── Ledger + Sales + Purchases + Treasury
Printing  <──── AccountingDocument + document details
Audit/Security <──── all contexts
```

## 4.3 ملاحظات على الحدود

- `ActorContext` معرف داخل `users/user-service.ts` وتستورده أغلب المجالات. هذا نوع cross-cutting موجود داخل Context غير مناسب لملكيته.
- إدارة العملاء موجودة داخل `receipts/reference-service.ts` بدل وحدة Customers أو Receivables واضحة.
- `SupplierReferenceService` يحتوي أيضًا منطق Treasury مكررًا.
- لا توجد طبقة تمنع Context من الكتابة مباشرة في جداول Context آخر.

# 5. أماكن الترابط القوي

## 5.1 دفتر الأستاذ مشترك بين جميع الوحدات — Critical

`AccountingDocument` مرتبط مباشرة بالمبيعات والمشتريات والمقبوضات والمدفوعات والقيود:

- `project/apps/api/prisma/schema.prisma:467-501`
- `project/apps/api/prisma/schema.prisma:526-581`

كل خدمة تنفذ منطق الترحيل بنفسها:

- المبيعات: `project/apps/api/src/sales/sales-invoice-service.ts:270-346`
- المقبوضات: `project/apps/api/src/receipts/receipt-service.ts:278-363`
- المدفوعات: `project/apps/api/src/payments/payment-service.ts:294-379`
- المشتريات: `project/apps/api/src/purchases/purchase-invoice-service.ts:275-351`
- القيود اليدوية: `project/apps/api/src/journals/manual-journal-service.ts:273-345`

النتائج:

- تعديل قاعدة ترحيل أو عكس يحتاج تغيير عدة خدمات.
- يمكن أن تختلف سياسات الترحيل بين أنواع المستندات.
- لا يوجد مالك حصري لحالة `POSTED/REVERSED`.
- Core Accounting أصبح Shared Database Model أكثر من كونه Bounded Context.

التوصية:

- كل Context يبني `PostingPlan` أو `PostingInstructions`.
- `PostingEngine` داخل Core Accounting وحده يتحقق ويحفظ `JournalEntry/JournalLine` ويغير حالة المستند.
- لا يسمح للوحدات الأخرى بإنشاء القيود مباشرة.

## 5.2 تسويات الذمم تعتمد على معرف داخلي من Ledger — High

`ReceiptAllocation` و`PaymentAllocation` يشيران مباشرة إلى `targetJournalLineId`:

- `project/apps/api/prisma/schema.prisma:775-787`
- `project/apps/api/prisma/schema.prisma:1023-1035`

كما أن عكس فاتورة مبيعات يقرأ `ReceiptAllocation` مباشرة لمنع عكس فاتورة محصلة:

- `project/apps/api/src/sales/sales-invoice-service.ts:361-370`

هذا يجعل AR/AP وTreasury يعتمدان على البنية الداخلية للـGeneral Ledger.

التوصية:

- استخدام مفهوم مجال واضح مثل `ReceivableItemId` أو `PayableItemId` في التسويات.
- الاحتفاظ بعلاقة Journal Line داخل Core Accounting كتنفيذ داخلي، لا كعقد بين Contexts.

## 5.3 الوصول المباشر إلى Prisma عبر الحدود — High

المشكلة ليست غياب Repository بحد ذاته، بل عدم وجود Ownership يمنع وحدة من قراءة أو تعديل جداول وحدة أخرى.

المثال الأوضح: تعطيل عملة شركة يفحص مباشرة:

- `JournalLine`
- `Receipt`
- `Payment`
- `SalesInvoice`
- `PurchaseInvoice`

الدليل:

- `project/apps/api/src/companies/company-service.ts:124-175`

يفضل أن يتم ذلك عبر Usage Query Port أو Policy مملوكة لطبقة Accounting Integration بدل معرفة أسماء جميع جداول المستندات.

## 5.4 ملكية الضرائب غير واضحة — High

نفس جدول `TaxRate` يُدار من خدمتين وواجهتي API مختلفتين:

- `project/apps/api/src/sales/sales-invoice-service.ts:417-440`
- `project/apps/api/src/purchases/purchase-invoice-service.ts:422-445`
- `project/packages/contracts/openapi.yaml:4176-4251`

التوصية:

- إنشاء مالك واحد باسم `TaxConfiguration`، أو وضعه ضمن `Accounting Configuration`.
- المبيعات والمشتريات تستهلك Tax Policy عبر Query Port.

## 5.5 Treasury موزع ومكرر — Medium/High

إدارة `CashBankAccount` و`PaymentMethod` موجودة في:

- `project/apps/api/src/receipts/reference-service.ts:293-495`
- `project/apps/api/src/suppliers/supplier-service.ts:290-455`

المسارات الفعلية تستخدم خدمة `receipts/reference-service`، بينما التنفيذ الآخر يبدو تكرارًا غير مستعمل في التركيب الحالي.

التوصية:

- إنشاء وحدة Treasury مالكة للصناديق والبنوك وطرق الدفع.
- إزالة المعرفة بهذه الكيانات من Customer/Supplier reference services عند مرحلة إعادة الهيكلة.

## 5.6 Onboarding يعبر عدة Contexts — Medium

التجهيز ينشئ في عملية واحدة:

- المؤسسة والشركة.
- المستخدم والإسناد.
- الدور والصلاحيات.
- دليل الحسابات.
- العملات وطرق الدفع.

الدليل:

- `project/apps/api/src/platform/company-provisioning-service.ts:46-135`

المعاملة الذرية مفيدة حاليًا، لكن يفضل اعتبار الخدمة Process Manager يستدعي Ports معلنة لكل Context، وليس مالكًا مباشرًا لجميع الجداول.

## 5.7 Reporting — ترابط downstream مقبول

`ReportService` يقرأ Ledger والمقبوضات والمدفوعات والعملاء والموردين. هذا مقبول لأن اتجاه الاعتماد Read-only، بشرط:

- ألا يكتب في مصادر المجالات.
- أن تبقى استعلاماته في Read Model/Query Layer مستقلة.
- ألا تعتمد Contexts التشغيلية على Reporting في الاتجاه العكسي.

الدليل:

- `project/apps/api/src/reports/report-service.ts`

# 6. تقييم Tactical DDD

## 6.1 ما هو موجود

- لغة أعمال واضحة في أسماء الخدمات والعمليات.
- حالات مستند واضحة مثل `DRAFT`, `POSTED`, `REVERSED`, `CANCELLED`.
- معاملات تحمي invariants الحساسة.
- Optimistic Version وIdempotency للعمليات الحرجة.
- عزل الشركة مدعوم بـ`companyId` وعلاقات مركبة.
- بعض الحسابات معزولة في Calculators للمبيعات والمشتريات.

## 6.2 ما هو غير موجود أو ضعيف

- لا توجد Aggregates صريحة تتحكم في الانتقالات.
- Prisma records هي عمليًا Domain Model وPersistence Model في الوقت نفسه.
- لا توجد Domain Events.
- لا توجد Value Objects مركزية مثل `Money`, `ExchangeRate`, `DocumentNumber`, `FiscalDate`.
- لا يوجد Posting Domain Service مركزي رغم وجوده في التصميم المعتمد.
- توجد نسبة كبيرة من `any` في الخدمات والـserializers، ما يضعف العقود بين طبقات المجال.
- Idempotent command handling وdocument numbering وaccount validation مكررة في خدمات متعددة.

لا يوصى بإنشاء Repository لكل جدول لمجرد تطبيق نمط شكلي. الأولوية هي Aggregates الحساسة، ملكية Ledger، وPorts بين الـContexts.

# 7. تقييم Event-Driven الحالي

## 7.1 الأشياء التي تحمل اسم Event حاليًا

- `AuditLog`: سجل امتثال وتدقيق.
- `SecurityEvent`: سجل مخاطر وتنبيهات أمنية.
- `RegistrationEvent`: سجل دورة التسجيل.
- Structured operational logs.

الأدلة:

- `project/apps/api/prisma/schema.prisma:358-398`
- `project/apps/api/prisma/schema.prisma:225-279`
- `project/apps/api/src/operations/logger.ts`

## 7.2 لماذا النظام ليس Event-Driven حاليًا؟

لا يوجد:

- Publisher/Subscriber.
- Domain Event Dispatcher.
- Transactional Outbox.
- Consumer Handlers.
- Retry/DLQ.
- Event schema/versioning.
- ضمان تسليم side effects بعد نجاح المعاملة.

لا ينبغي استخدام `AuditLog` كـOutbox، لأن سجل التدقيق له غرض ودورة احتفاظ ومحتوى مختلف عن عقد التكامل.

## 7.3 فجوة موثوقية البريد

بعد commit لطلب التسجيل، يتم تشغيل إرسال البريد بأسلوب fire-and-forget:

- `project/apps/api/src/registration/registration-service.ts:86-160`
- `project/apps/api/src/registration/registration-service.ts:285-311`

إذا توقفت العملية بعد commit وقبل تنفيذ الإرسال، فلا توجد رسالة durable تضمن إعادة المحاولة.

هذا هو أفضل use case أولي لإدخال Transactional Outbox.

# 8. الأحداث المقترحة وأماكن إدخالها

| الأولوية | الحدث | مكان الإنشاء | مستهلكون محتملون |
|---|---|---|---|
| P0 | `RegistrationVerificationRequested` | معاملة إنشاء/إعادة إرسال طلب التسجيل | Email delivery worker |
| P1 | `CompanyProvisioned` | معاملة التجهيز بعد نجاح البيانات الأساسية | Welcome notification، تكاملات، jobs غير حرجة |
| P1 | `SalesInvoicePosted` | معاملة ترحيل فاتورة المبيعات | إشعارات، integrations، projections |
| P1 | `SalesCreditNotePosted` | معاملة ترحيل الإشعار الدائن | AR projections والتكاملات |
| P1 | `PurchaseInvoicePosted` | معاملة ترحيل فاتورة المشتريات | إشعارات، integrations، projections |
| P1 | `PurchaseDebitNotePosted` | معاملة ترحيل الإشعار المدين | AP projections والتكاملات |
| P1 | `ReceiptPosted` | معاملة ترحيل سند القبض مع تفاصيل التسويات | AR aging/read models |
| P1 | `PaymentPosted` | معاملة ترحيل سند الصرف مع تفاصيل التسويات | AP aging/read models |
| P1 | `ManualJournalPosted` | معاملة ترحيل القيد اليدوي | رقابة وتنبيهات وتكاملات |
| P1 | `AccountingDocumentReversed` | معاملة العكس | إبطال projections وإشعار الأنظمة التابعة |
| P1 | `FiscalPeriodClosed` | معاملة إغلاق الفترة | Close pack، snapshots، notifications |
| P1 | `FiscalPeriodReopened` | معاملة إعادة الفتح | إبطال snapshots وتنبيه الرقابة |
| P1 | `SecurityRiskDetected` | عند حفظ حدث HIGH/CRITICAL | Incident/Email/SMS integration |
| P2 | `CustomerDeactivated` | معاملة تعطيل العميل | Integrations وتنظيف caches |
| P2 | `SupplierDeactivated` | معاملة تعطيل المورد | Integrations وتنظيف caches |
| P2 | `CompanyCurrenciesChanged` | معاملة تحديث عملات الشركة | مزامنة وإعادة تقييم مستقبلية |
| P2 | `ExchangeRateChanged` | معاملة سعر الصرف | تكاملات أو revaluation jobs مستقبلية |
| P3 | `ReportExportRequested` | عند تحويل التصدير الكبير إلى job | Export worker |
| P3 | `DocumentPrintRequested` | عند تحويل الطباعة إلى job | PDF worker |

## 8.1 نقاط الإدخال التقنية المناسبة

في أوامر الترحيل والعكس، يجب حفظ Outbox Event داخل المعاملة نفسها بعد تنفيذ التغيير المحاسبي وقبل جعل سجل Idempotency `COMPLETED`.

الأمثلة الحالية على نقطة الإدخال:

- المبيعات: `project/apps/api/src/sales/sales-invoice-service.ts:618-636`
- المشتريات: `project/apps/api/src/purchases/purchase-invoice-service.ts:624-642`
- القيود اليدوية: `project/apps/api/src/journals/manual-journal-service.ts:732-807`
- المدفوعات: `project/apps/api/src/payments/payment-service.ts:783-850`
- الفترات المالية: `project/apps/api/src/fiscal/fiscal-service.ts:160-177`

الترتيب المقترح داخل المعاملة:

```text
1. Validate command and idempotency
2. Load/lock aggregate
3. Execute business transition
4. Persist accounting effects
5. Append audit record
6. Append outbox event
7. Mark idempotency record COMPLETED
8. COMMIT
9. Worker publishes/handles outbox event
```

# 9. ما يجب أن يبقى متزامنًا

لا يوصى بإدخال Eventual Consistency في العمليات التالية:

- إنشاء القيود وتغيير المستند إلى `POSTED`.
- التحقق من توازن المدين والدائن.
- فحص الفترة المفتوحة.
- التحقق من الحساب والعملة وسعر الصرف.
- التحقق من عدم تجاوز رصيد الفاتورة في التسوية.
- حجز رقم المستند.
- Maker/Checker وOptimistic Version.
- العكس وتحديث رابط مستند العكس.
- Idempotency.

هذه العمليات يجب أن تبقى داخل معاملة ACID واحدة. الحدث يُحفظ في المعاملة نفسها، لكن تتم معالجته بعد الـcommit.

# 10. المعمارية المستهدفة المقترحة

لا حاجة إلى Kafka أو RabbitMQ في المرحلة الحالية. الأنسب:

1. Domain Events داخل المونوليث.
2. جدول `outbox_events` منفصل عن Audit.
3. كتابة الحدث مع تغييرات المجال في نفس Prisma transaction.
4. Worker داخل نفس التطبيق أو process منفصل يقرأ Outbox.
5. تسليم At-least-once مع Handlers idempotent.
6. `processed_events` أو Inbox للمستهلكين ذوي الآثار الحساسة.
7. Ordering لكل Aggregate فقط، وليس ترتيبًا عالميًا.
8. إضافة Broker خارجي فقط عند ظهور حاجة تشغيلية حقيقية.

## 10.1 Event Envelope مقترح

```json
{
  "eventId": "uuid",
  "eventType": "SalesInvoicePosted",
  "schemaVersion": 1,
  "aggregateType": "SalesInvoice",
  "aggregateId": "123",
  "companyId": "10",
  "occurredAt": "2026-08-21T12:00:00.000Z",
  "correlationId": "request-or-operation-id",
  "causationId": "command-or-parent-event-id",
  "payload": {}
}
```

## 10.2 ضوابط الأحداث

- استخدام أسماء بصيغة الماضي.
- عدم نشر Prisma records كاملة.
- تضمين أقل payload مطلوب للمستهلك.
- إصدار Version لعقد الحدث.
- عدم وضع بيانات حساسة غير لازمة.
- جميع handlers يجب أن تتحمل التكرار.
- عدم افتراض Exactly-once delivery.
- عدم استخدام AuditLog كناقل أحداث.

# 11. ترتيب المعالجة المقترح

## المرحلة 0 — قرارات معمارية

- تثبيت Context Map.
- تحديد مالك كل جدول ومفهوم.
- كتابة ADR للأحداث والـOutbox.
- التأكيد في ADR أن Ledger سيبقى Strongly Consistent.

## المرحلة 1 — حماية Core Accounting

- إنشاء `PostingEngine` مركزي.
- منع الوحدات الأخرى من إنشاء `JournalEntry/JournalLine` مباشرة.
- توحيد Money وDocument Sequence والتحقق من الحساب والفترة.
- توحيد Idempotent Command Executor.

## المرحلة 2 — حسم المناطق الملتبسة

- إنشاء Treasury owner واضح.
- إنشاء Tax Configuration owner واضح.
- فصل Customer Master عن `receipts/reference-service`.
- إزالة Treasury CRUD المكرر من Supplier service.
- استبدال `targetJournalLineId` بمفهوم Receivable/Payable Item على حدود المجالات.

## المرحلة 3 — الأحداث عالية القيمة

- Outbox لبريد التسجيل أولًا.
- أحداث الترحيل والعكس.
- أحداث إغلاق وإعادة فتح الفترة.
- تنبيهات Security HIGH/CRITICAL.

## المرحلة 4 — Read Models والتكاملات

- إدخال projections فقط عند الحاجة.
- نقل التقارير الثقيلة أو التصدير إلى background jobs عند الحاجة.
- إضافة broker خارجي فقط إذا أصبح هناك scaling أو integrations مستقلة تبرره.

# 12. نقاط القوة التي يجب المحافظة عليها

- قرار Modular Monolith مناسب لحجم النظام وحساسية المعاملات.
- استخدام معاملات محلية بدل معاملات موزعة للدفتر.
- عزل الشركة بـ`companyId` وعلاقات مركبة.
- Idempotency للترحيل والعكس والإغلاق.
- Optimistic Version للمستندات.
- عدم تعديل المستندات المرحلة والتصحيح بالعكس.
- استخدام `Prisma.Decimal` للمبالغ.
- التقارير مشتقة من القيود الفعلية بدل تخزين حقيقة مالية موازية.
- Audit/Security منفصلان عن logs التشغيلية.

# 13. الخلاصة النهائية

النظام لا يحتاج Microservices حاليًا. المشكلة الأساسية ليست حجم المونوليث، بل أن حدوده غير محمية وأن Core Accounting لا يملك عمليات الترحيل بصورة حصرية.

أعلى ثلاث أولويات معمارية مستقبلية هي:

1. جعل `PostingEngine` المالك الوحيد للقيود وحالة الترحيل والعكس.
2. حسم Ownership الخاص بـTreasury وTax وعمليات تسوية الذمم.
3. إدخال Transactional Outbox بدءًا ببريد التسجيل، ثم أحداث المستندات المالية والفترات.

يجب أن تستخدم الأحداث للأعمال اللاحقة للـcommit، لا لاستبدال المعاملة المحاسبية الأساسية.

# 14. فهرس الأدلة الأساسي

| الموضوع | الملف |
|---|---|
| القرار المعماري | `HANDOFF_CURRENT/01_PROJECT_DOCUMENTATION/decisions/ADR-001-architecture.md` |
| التصميم المعماري | `HANDOFF_CURRENT/01_PROJECT_DOCUMENTATION/docs/07-architecture.md` |
| مخطط البيانات | `project/apps/api/prisma/schema.prisma` |
| Composition Root | `project/apps/api/src/server.ts` |
| تركيب HTTP | `project/apps/api/src/app.ts` |
| القيود اليدوية | `project/apps/api/src/journals/manual-journal-service.ts` |
| المقبوضات | `project/apps/api/src/receipts/receipt-service.ts` |
| المدفوعات | `project/apps/api/src/payments/payment-service.ts` |
| المبيعات | `project/apps/api/src/sales/sales-invoice-service.ts` |
| المشتريات | `project/apps/api/src/purchases/purchase-invoice-service.ts` |
| الفترات المالية | `project/apps/api/src/fiscal/fiscal-service.ts` |
| الشركة والعملات | `project/apps/api/src/companies/company-service.ts` |
| التسجيل | `project/apps/api/src/registration/registration-service.ts` |
| تجهيز الشركة | `project/apps/api/src/platform/company-provisioning-service.ts` |
| التقارير | `project/apps/api/src/reports/report-service.ts` |
| التدقيق | `project/apps/api/src/audit/audit-service.ts` |
| الأمان | `project/apps/api/src/security/security-event-service.ts` |
