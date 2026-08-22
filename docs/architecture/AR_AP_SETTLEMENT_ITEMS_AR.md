---
title: "AR/AP Settlement Items"
status: "implemented mandatory architecture"
version: "1.0"
date: "2026-08-22"
related:
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "ADR-003-domain-boundaries-and-eventing.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
---

# عناصر الذمم المدينة والدائنة وعقد التسوية

## 1. القرار

لا تستخدم الخزينة `JournalLineId` كهوية دين أو التزام. الهوية العامة للتخصيص هي:

- `ReceivableItemId` لتخصيص سند القبض.
- `PayableItemId` لتخصيص سند الصرف.

يبقى `SalesInvoice.arJournalLineId` و`PurchaseInvoice.apJournalLineId` أثر ربط داخليًا بين مستند المصدر وCore Accounting، ولا يظهر في OpenAPI أو DTOs أو الواجهة ولا يدخل في قرار التسوية.

## 2. الملكية

| المفهوم | مالك الكتابة | الغرض |
|---|---|---|
| `ReceivableItem` | Sales & Accounts Receivable | هوية ذمة العميل، أصل المبلغ، الرصيد، الحالة والنسخة |
| `PayableItem` | Purchases & Accounts Payable | هوية ذمة المورد، أصل المبلغ، الرصيد، الحالة والنسخة |
| `Receipt` و`ReceiptAllocation` | Treasury | حركة النقد وطلب تخصيصها إلى `ReceivableItem` |
| `Payment` و`PaymentAllocation` | Treasury | حركة النقد وطلب تخصيصها إلى `PayableItem` |
| `JournalEntry` و`JournalLine` | Core Accounting | الأثر الدفتري فقط |

تستدعي Treasury منفذي `ReceivableSettlementPort` و`PayableSettlementPort` داخل المعاملة نفسها. لا تعدّل Treasury جدول عناصر الذمم من خدمة المستند مباشرة، ولا تقرأ أسطر الأستاذ لاكتشاف الرصيد.

## 3. دورة الحياة والـinvariants

- ينشأ عنصر واحد عند ترحيل فاتورة المصدر، داخل معاملة المصدر والقيد نفسها.
- `originalAmount > 0` و`0 <= outstandingAmount <= originalAmount`.
- الحالات المادية: `OPEN`, `PARTIAL`, `SETTLED`, `REVERSED`.
- `OPEN` يعني أن الرصيد يساوي الأصل، و`SETTLED` يعني صفرًا، و`PARTIAL` بينهما.
- `REVERSED` لا يقبل تخصيصًا جديدًا، ورصيده صفر.
- يطابق العنصر شركة الطرف والطرف والعملة في أمر الخزينة.
- كل تغيير للرصيد يستخدم `version` وconditional update؛ فشل عدد الصفوف يعني تعارضًا.
- لا يسمح مجموع القبوض أو المدفوعات والإشعارات المرحلة بتجاوز الرصيد.
- عكس فاتورة المصدر لا ينجح بعد أي تسوية؛ عكس القبض أو الدفع يعيد الرصيد، وعكس الإشعار يعيد التخفيض.

## 4. حدود المعاملة وترتيب الأقفال

يحدث إنشاء العنصر أو إنقاصه أو استعادته في معاملة ACID نفسها التي ينفذ فيها `PostingEngine` القيد والحالة والتدقيق والـIdempotency. لا Network I/O ولا Eventual Consistency في هذا المسار.

الترتيب الحاكم هو: Idempotency، الشركة/الفترة، مستند المصدر، التسلسل عند الحاجة، عناصر الذمم مرتبة تصاعديًا، ثم أسطر الأستاذ، ثم Audit/Outbox. ينفذ `beforeLedger` سياسة الذمم قبل أقفال `JournalLine` في العكس، لذلك يتنافس reverse-vs-settlement على العنصر نفسه ولا يمكن أن ينجح الأثران المتعارضان.

## 5. الترحيل والـbackfill

الترحيل `20260822230000_receivable_payable_items`:

1. ينشئ الجدولين بقيود المبالغ والعلاقات المركبة مع `companyId`.
2. ينشئ عنصرًا لكل فاتورة مصدر `POSTED` أو `REVERSED`.
3. يحسب الرصيد من تخصيصات القبض/الدفع المرحلة ومن الإشعارات المرحلة فقط.
4. يربط التخصيصات القديمة بالعنصر عبر رابط الفاتورة الداخلي المؤقت.
5. يفشل عمدًا إذا وجد تخصيص قديم لا يمكن ربطه، أو رصيدًا سلبيًا، أو مستندًا معكوسًا له تخفيض فعال؛ لا يسقط بيانات غير مفهومة بصمت.
6. يجعل الهوية الجديدة إلزامية ثم يحذف `target_journal_line_id` ومفاتيحه.

ثبت المساران من قاعدة فارغة ومن مخطط سابق يحوي بيانات تاريخية على MariaDB 10.4.32 وMySQL 8.4.11. اختبرت على المحركين حالة جزئية فعلية: 100 ← 60 للذمم المدينة و200 ← 150 للدائنة مع نقل التخصيصين ورفض حارس الترحيل لحالة backfill غير صالحة.

## 6. توافق API والنشر والرجوع

هذا تغيير عقد مقصود في OpenAPI `1.9.0`: يستبدل الحقل القديم بدل دعمه مزدوجًا. يجب تحديث API والواجهة وأي مستهلك خارجي كحزمة واحدة.

النشر الحالي أحادي النسخة وليس rolling مختلط الإصدارات:

1. أخذ نسخة احتياطية قابلة للاستعادة وتشغيل preflight على البيانات القديمة.
2. إيقاف استقبال الكتابات المالية.
3. تشغيل `prisma migrate deploy`.
4. تشغيل Artifact الجديد فقط، ثم readiness وsmoke tests.

بعد حذف العمود القديم لا يجوز إعادة تشغيل Binary قديم. الرجوع الآمن هو استعادة النسخة الاحتياطية مع الـArtifact القديم، لا رجوع Binary وحده. إذا أصبح النشر rolling مستقبلًا، يلزم Migration توسعة/تعايش/تقليص مستقلة وADR توافق قبل ذلك.

## 7. بوابات منع التراجع

- حارس معماري يمنع `targetJournalLineId` من Prisma والعقود والخزينة والواجهة.
- اختبارات عزل الشركة على منافذ العناصر.
- اختبارات ترحيل وعكس القبض والدفع والإشعارات وحالات `OPEN/PARTIAL/SETTLED/REVERSED` والنسخة.
- اختبارات over-allocation متزامن وreverse-vs-settlement على قاعدة فعلية.
- Prisma validate/generate، TypeScript، OpenAPI guard generation، واختبارات قاعدة فارغة وترقية على المحركين.
