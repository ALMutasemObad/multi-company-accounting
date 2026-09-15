---
title: "ADR-028 — Report and Document Output Platform"
status: "accepted"
version: "1.0"
date: "2026-09-15"
decision_owner: "Printing & Document Output and Reporting"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "ADR-003-domain-boundaries-and-eventing.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "QUERY_SCALABILITY_FOUNDATION_2026-08-29_AR.md"
  - "TAX_SUMMARY_REPORT_AR.md"
  - "INDIRECT_CASH_FLOW_REPORT_AR.md"
  - "COST_CENTER_ACTIVITY_REPORT_AR.md"
  - "BARCODE_LABEL_RENDERING_B2_AR.md"
---

# ADR-028: منصة مخرجات التقارير والمستندات

## 1. السياق والمشكلة

يوجد في النظام مساران ناضجان جزئيًا لكنهما غير موحدين:

- `Printing & Document Output` يحفظ `DocumentPrintArchive` واحدًا لكل مستند محاسبي،
  مع `formatVersion=1` وJSON snapshot وبصمة SHA-256، ثم يولد PDF ويعد مرات الطباعة.
- `Reporting` يحسب القوائم وكشوف الأستاذ وملخص الضريبة وحركة مراكز التكلفة وقت الطلب،
  ويولد CSV/XLSX/PDF داخل ذاكرة طلب HTTP، ويسجل تصديرًا في Audit.

توجد أربع مشكلات لا يعالجها جمع المسارين في مولد ملفات واحد:

1. `PrintSnapshot` الحالي يخلط بيانات الطرف وبنود الفاتورة مع حسابات الأستاذ والقيود؛
   لذلك لا يميز عقدًا خارجيًا عن ملحق محاسبي داخلي.
2. أرشفة أول طباعة ليست تعريفًا صريحًا لوقت **إصدار** مستند نظامي، ولا توجد سياسة
   احتفاظ أو legal hold أو بصمة artifact منفصلة عن بصمة البيانات.
3. التقرير query-time ليس مستندًا صادرًا. معناه يعتمد على المعلمات و`asOf` وأساس
   القياس ووقت التوليد واتساق القراءة؛ حفظ PDF وحده لا يجعله مصدر حقيقة.
4. التصدير الكبير الحالي متزامن. حد 10,000 صف و`truncated=true` حاجز أمان حالي،
   وليس bulk export ولا يسمح بإرسال ملف ناقص بوصفه كاملًا.

كذلك يكرر `pdf-renderer.ts` و`financial-statement-exporter.ts` الهوية والخطوط وRTL
والجداول والترقيم، ويحول مولد PDF للتقارير decimal text عبر `Number` للعرض. هذا
التكرار تقني؛ أما اختيار الحقول والحساب والتجميع والتنقيح فمسؤولية مالك الحقيقة ولا
يجوز نقلها إلى Printing.

هذا القرار Target Architecture قابلة للتنفيذ تدريجيًا. لا يغير Runtime أو Schema أو
OpenAPI في هذه المهمة، ولا يزعم أن PDF الحالي مستند ضريبي ممتثل أو PDF/UA أو PDF/A.

## 2. القرار المختصر

نعتمد منصة إخراج داخل الـModular Monolith تتكون من ثلاثة حدود مستقلة:

```text
Domain/Reporting projection owner
  -> typed, audience-specific projection + policy decision + source watermark
      -> Printing/Reporting orchestration and archive/job lifecycle
          -> shared rendering kernel
              -> PDF | CSV | XLSX | THERMAL profile
```

- يملك كل Bounded Context **projection** الخاص بحقيقته وبالجمهور المقصود.
- تملك Printing أرشيف المستندات الصادرة ودورة رسمها، ولا تملك حقائق Sales أو Tax أو
  Payroll أو Core Accounting.
- يملك Reporting تعريف التقرير ومعلماته وحسابه وتجميعه وقراءة مصادره عبر Query Ports.
- النواة المشتركة تملك الرسم فقط: الهوية، الخطوط، bidi/RTL/LTR، الجداول، كسر الصفحة،
  الترقيم، تمثيل decimal text والتاريخ، وملفات الصيغ. لا تستورد Prisma ولا تحسب ضريبة
  أو رصيدًا أو صلاحية ولا تختار حقلاً أو تنقحه.
- المستند الصادر يبنى من snapshot immutable؛ التقرير يبنى query-time من معلمات
  canonical و`asOf/sourceWatermark` معلنين. لا يتحول أحدهما إلى الآخر ضمنيًا.

## 3. تصنيف المخرجات الإلزامي

كل `outputKind` يسجل في Registry مغلق مع `class`, `ownerContext`, `audience`,
`projectionVersion`, `requiredPermission`, `formats`, `archivePolicy`,
`retentionPolicyCode`, و`redactionPolicyVersion`. النوع غير المسجل يفشل مغلقًا.

| الفئة | المعنى | أمثلة البداية | الحقيقة والأرشفة |
|---|---|---|---|
| `EXTERNAL_STATUTORY_DOCUMENT` | مستند يصدر لطرف خارجي وتحدد صحته قاعدة قانونية/ضريبية مؤرخة | فاتورة مبيعات ضريبية وإشعارها عند تفعيل jurisdiction صالح | مالك المصدر يبني projection مكتملة؛ snapshot وartifact الصادران immutable ومحتفظ بهما وفق سياسة نظامية |
| `OPERATIONAL_DOCUMENT` | مخرج ينفذ أو يثبت نشاطًا يوميًا، وقد يكون خارجيًا أو داخليًا لكنه ليس ادعاءً نظاميًا تلقائيًا | سند قبض/صرف، POS receipt تشغيلي، ملصق باركود | يحدد Registry هل هو preview حي أو إصدار مؤرشف؛ لا يرث صفة ضريبية من شكله |
| `INTERNAL_ACCOUNTING_EVIDENCE` | دليل أو حزمة مراجعة داخلية ذات وصول مالي مقيد | قيد يومية، ملحق قيد، close pack، نسخة داخلية لفاتورة مورد | Core Accounting أو المالك المحاسبي يبني projection؛ لا تظهر خارجيًا ولا تشترك مع صلاحية طباعة العميل |
| `QUERY_TIME_REPORT` | نتيجة قراءة مشتقة لمعلمات ووقت/أساس محددين | المركز المالي، الدخل، التدفق النقدي، الأستاذ، اليومية، مراكز التكلفة، ملخص الضريبة الداخلي | Reporting يملك التعريف؛ لا archive دائم افتراضيًا، وartifact التصدير مؤقت ما لم يرقَّ صراحة إلى evidence package |

التصنيف الأولي يحكم الأسماء الحالية كما يلي:

- `SALES_INVOICE/SALES_CREDIT_NOTE`: خارجي نظامي فقط عندما تنجح سياسة الدولة والضريبة؛
  وإلا preview غير صادر وموسوم بوضوح، لا downgrade صامتًا إلى مستند نظامي.
- `RECEIPT/PAYMENT`: تشغيلي؛ لا يسمى فاتورة ضريبية ولا إثبات تسوية بنكية نهائيًا.
- `MANUAL_JOURNAL` وملحق الحسابات/القيود للفواتير: دليل محاسبي داخلي.
- `PURCHASE_INVOICE` المسجل من فاتورة المورد: دليل داخلي افتراضيًا؛ النظام لا يعيد
  إصدار مستند المورد باسمه.
- `INVENTORY_BARCODE_LABEL`: مخرج تشغيلي بجهاز/بروفايل مستقل.
- `TAX_SUMMARY`: تقرير مراجعة داخلي query-time، وليس إقرارًا ضريبيًا.

وجود نفس الرقم أو المصدر لا يسمح بدمج projections. يمكن لمستند مبيعات واحد أن ينتج
نسخة عميل خارجية وملحقًا محاسبيًا داخليًا بعقدين وصلاحيتين وبصمتين مختلفتين.

## 4. الملكية والعقود

### 4.1 مالك الـprojection

| المخرج | مالك projection | ما يقدمه إلى المنصة | ما لا تمنحه المنصة |
|---|---|---|---|
| فاتورة/إشعار مبيعات خارجي | Sales/AR، مع حقائق ضريبة من Tax Port | هوية الطرفين المسموح بها، البنود والعملة والضريبة والإجماليات وحالة السياسة | لا قراءة `SalesInvoice` من renderer ولا اختراع QR أو رقم ضريبي |
| فاتورة مورد/سند/قيد داخلي | Purchases أو Treasury أو Core Accounting بحسب الحقيقة | DTO داخلي محدود ومصنف الحساسية | لا كشفه بصلاحية المستند الخارجي |
| مستند Payroll مستقبلي | Payroll مع Statutory Adapter المؤرخ بعد اعتماده | projection للفرد/الجهة وفق audience وسياسة الخصوصية | لا قانون رواتب داخل kernel ولا وصول عام للمجاميع |
| تقرير مالي | Reporting | metadata + sections/rows أو row stream من Query Ports | لا حساب أرصدة أو تصنيف حسابات داخل kernel |
| باركود صنف | Inventory Query Port | symbology/value المملوكان والمتحقق منهما | لا parser أو lookup أو barcode identity داخل Printing |

عقد projection لا يحمل Prisma record ولا دوالًا تنفيذية. يحمل Decimal وBIGINT كنصوص
canonical، وتواريخ ISO، و`locale/direction` صريحين، وblocks ذات schema version. لا
يوجد `UniversalDocumentDto` يحتوي حقولًا اختيارية لكل المجالات؛ لكل عائلة عقد مصنف
واختبار compatibility، وتشترك فقط في primitives العرضية.

### 4.2 نواة الرسم المشتركة

الحزمة المستهدفة `apps/api/src/document-output-kernel` لا تعتمد على `apps/api/src/*`
الخاصة بالمجالات. يسمح لها بالآتي فقط:

- `OutputIdentity`: شعار/اسم المنشأة المسموحان، عنوان المستند، النسخة واللغة.
- `TextBlock`, `KeyValueBlock`, `TableBlock`, `TotalsBlock`, `SignatureBlock`,
  `MachineReadableBlock` بعد أن يصرح المالك بصلاحيته.
- font registry مثبت النسخة، fallback معلوم، واتجاه مستقل لكل run بدل قلب الأرقام.
- قياس الصفوف، التكرار الآمن لرأس الجدول، page breaks، page number وoverflow guards.
- التقريب **العرضي** المركزي لـdecimal text وفق دقة و`ROUND_HALF_UP` أو قاعدة مؤرخة
  مقدمة من projection metadata، مع إبقاء الإجماليات والحساب المالي الحاكم عند المالك.
  يمنع تحويل المال إلى `Number` أو إعادة حساب مجموع أو تقريب قيمة بلا policy معلنة.
- profile version ثابت لكل صيغة، ومخرج bytes مع `artifactSha256`, `byteLength`,
  ونتيجة validation.

لا تستورد النواة Prisma أو Auth أو Services أو Tax أو Ledger، ولا تستدعي شبكة أو
قاعدة بيانات، ولا تقرر audience أو redaction أو retention أو compliance.

## 5. المستند الصادر: اللقطة والإصدار والبصمة

### 5.1 سجل الإصدار المستهدف

يتطور `DocumentPrintArchive` توسعيًا إلى سجل إصدار يحمل على الأقل:

```text
companyId, outputKind, ownerContext, sourceType, sourceId, sourceRevision
audience, classification, projectionVersion, renderingProfileVersion
canonicalSnapshot, snapshotSha256, artifactSha256, mediaType, byteLength
status = PREPARED | ISSUED | FAILED | SUPERSEDED
preparedAt, issuedAt, issuedBy, retentionPolicyCode, retentionPolicyVersion
retainUntil, legalHold, supersedesArchiveId, failureCode
```

- uniqueness هو `(companyId, outputKind, sourceType, sourceId, sourceRevision,
  audience)`، لا `accountingDocumentId` وحده.
- `canonicalSnapshot` يبصم بـSHA-256 على serialization versioned ثابتة. الانتقال من
  legacy `JSON.stringify` مسار قراءة compatibility فقط؛ لا يعاد بصم سجل قديم بصمت.
- snapshot وhash وpolicy version لا تعدل بعد `PREPARED`. التصحيح ينشئ source revision
  أو مستند عكس/إشعارًا جديدًا ثم archive جديدًا مرتبطًا بـ`supersedesArchiveId`.
- artifact له بصمة مستقلة لأن تحديث الخط أو renderer قد يغير bytes مع بقاء البيانات.
- تنزيلًا لاحقًا لمستند `ISSUED` يعيد artifact المحفوظ نفسه عندما تفرض السياسة byte
  identity. إعادة الرسم مسموحة فقط كنسخة `RENDERED_COPY` معلنة من snapshot الأصلية،
  ولا تستبدل artifact الصادر ولا بصمته.

### 5.2 دورة الإصدار بلا معاملة طويلة

1. في معاملة قصيرة: يعاد التفويض، يقفل المصدر حسب مالكه، يتحقق من الحالة والنسخة،
   يبني المالك projection، وتخزن `PREPARED` مع snapshot/hash وAudit/Idempotency.
2. بعد commit: يرسم renderer ويحفظ artifact خارج معاملة قاعدة البيانات.
3. في معاملة قصيرة ثانية: تقارن snapshot/profile/artifact hashes، ثم تنتقل إلى
   `ISSUED` وتكتب Audit. لا يسمح بالتنزيل الخارجي قبلها.
4. فشل الرسم يبقي `PREPARED/FAILED` قابلًا لإعادة محاولة idempotent من اللقطة نفسها؛
   لا يعيد قراءة حقائق حية ولا يعدل Ledger.

إذا كانت سياسة المجال تعتبر posting نفسه لحظة إصدار قانونية، يجب أن يضيف المالك
snapshot في معاملة posting نفسها عبر Port صغير، ثم يبقى توليد bytes بعد commit. أما
إذا كانت byte identity شرط الإصدار، فحالة المجال لا تسمى `ISSUED` قبل الخطوة الثالثة.
يحدد Registry أحد النمطين صراحة؛ لا يستنتجه Router.

### 5.3 الاحتفاظ والحذف

- لكل مستند صادر `retentionPolicyCode/version` مؤرخ حسب النوع والدولة والجمهور.
- غياب سياسة صالحة يمنع إصدار مستند نظامي. لا نخترع مدة سنوات موحدة في هذا ADR.
- `retainUntil` لا يتقدم إلى تاريخ أقرب عند تحديث السياسة، و`legalHold=true` يمنع purge.
- purge عملية خلفية مدققة ومقيدة بالشركة والسياسة، وتحذف artifact فقط عندما تسمح
  السياسة؛ لا تحذف snapshot/hash/Audit إذا كان الالتزام يوجب إثباتها.
- التراجع البرمجي لا يسقط archives أو hashes أو artifacts صدرت فعليًا. الرجوع تشغيلي
  إلى آخر binary يفهم schema/profile، ثم forward migration عند الحاجة.

## 6. التقرير query-time ومعنى `asOf`

كل تعريف تقرير يسجل عقدًا مغلقًا:

```text
reportKind, definitionVersion, owner=Reporting
normalizedParameters, parametersSha256
requestedAsOf/dateRange, timezone, locale, baseCurrency
sourceBasis, sourceWatermark, generatedAt
redactionPolicyVersion, authorizationScopeDigest
rowCount, complete, truncationReason
```

- `asOf` تاريخ أعمال يختاره المستخدم؛ `generatedAt` وقت الحساب؛ و`sourceWatermark`
  حد البيانات الذي قرأه التقرير. لا تستخدم المصطلحات الثلاثة بالتبادل.
- `$transaction([...])` الحالي لا يسمى snapshot متسقة عبر المحركين بلا isolation
  مثبت واختبار. إما أن يعلن التقرير `READ_AT_GENERATION`، أو يستهلك watermark ثابتًا
  من المالك، أو يستخدم read model versioned. رفع isolation ليس حلًا افتراضيًا.
- المعلمات تشمل كل ما يغير الناتج: الشركة الموثوقة، الفترة/`asOf`، المقارنة، الحالة،
  الموضوع، مركز التكلفة، الترتيب، locale، العملة، field set وسياسة التنقيح.
- لا تجمع عملات أساس شركات مختلفة. تقرير المؤسسة يعرض كل شركة وعملتها أو يحتاج سياسة
  FX ووقت تقييم وADR مستقلين.
- نتيجة query-time لا تخزن دائمًا ولا تصبح حقيقة مالية. يسجل العرض telemetry آمنة؛
  ويسجل التصدير Audit للنوع والصيغة والمعلمات المنقحة والبصمات والاكتمال.
- `complete=false` أو أي truncation يظهر في body وmetadata واسم/غلاف الملف، ولا يسمح
  لمسار «تنزيل كامل» بإرجاع مقتطع مع HTTP نجاح صامت.

ترقية تقرير إلى `INTERNAL_ACCOUNTING_EVIDENCE` أمر صريح باسم مثل
`CreateReportEvidencePackage`: يثبت التعريف والمعلمات/watermark والنتيجة وبصمتها
وسياسة الاحتفاظ. لا تحدث الترقية بمجرد الضغط على Export.

## 7. حدود الصيغ

| الصيغة | الاستخدام | قواعد إلزامية |
|---|---|---|
| PDF | قراءة/طباعة بشرية ومستند صادر | profile ثابت؛ خطوط مضمنة؛ bidi صحيح؛ لا clipping؛ رؤوس جداول وصفحات متكررة؛ metadata لا تحمل سرًا؛ artifact hash؛ لا ادعاء PDF/A أو PDF/UA بلا validator |
| CSV | نقل جدولي interoperable | UTF-8 مع عقد delimiter/line endings؛ Decimal/IDs/تواريخ canonical text؛ منع formula injection لـ`= + - @ tab CR`؛ لا styling ولا خلايا مدمجة |
| XLSX | تحليل جدولي منضبط | worksheet names آمنة، RTL metadata عند الصلة، freeze/header/filter وفق profile، حماية formula injection؛ لا تحويل Decimal إلى IEEE-754 إذا فقد الدقة، ولا formulas أو macros مولدة افتراضيًا |
| THERMAL | إيصال/ملصق تشغيلي bounded | profile جهاز ثابت للعرض/encoding/DPI/quiet zones/cut؛ لا HTML أو أوامر طابعة خام من المستخدم؛ لا تقارير مالية عريضة؛ نسخة رقمية بديلة قابلة للوصول |

ليس مطلوبًا أن تحتوي الصيغ الأعمدة نفسها: projection يحدد semantics والجمهور، ثم
يحدد profile تمثيلها. CSV/XLSX قد يحتفظان بأعمدة لا تلائم PDF، لكن يمنع أن يغير format
الحساب أو أساس التقرير أو التنقيح.

الطباعة الحرارية لفاتورة ضريبية مبسطة لا تعتمد لمجرد نجاح الطابعة؛ تحتاج profile
jurisdiction صريحًا وبيانات مكتملة وQR صالحًا واختبار جهاز. وإلا تبقى `OPERATIONAL_DOCUMENT`.

## 8. التصدير الكبير غير المتزامن

### 8.1 متى ينتقل إلى job

يحدد كل report registry `syncRowLimit`, `syncByteLimit`, و`syncDeadlineBudget` بعد
قياس. الطلب الذي يقدَّر أنه يتجاوز أحدها لا يقرأ ثم يقتطع؛ يعيد `202` مع
`ReportExportJob`. يبقى حد 10,000 الحالي سلوكًا legacy معلنًا حتى تنفيذ هذه الشريحة،
ولا يعد قيمة السعة النهائية.

الحالات:

```text
REQUESTED -> RUNNING -> READY -> EXPIRED
     |          |
     v          +-------> FAILED
  CANCELLED     |
                v
             CANCELLED
```

السجل مملوك لـReporting ويحمل `companyId`, requester، permission/capability revision،
report/definition versions، parameters/hash، source watermark، format/profile،
status/version، attempt/lease، artifact metadata، expiry وfailure code منقحًا.

### 8.2 التنفيذ والاتساق

- إنشاء job وAudit الطلب وIdempotency في معاملة قصيرة. لا يفتح request معاملة قراءة
  تنتظر الملف.
- العامل يطالب job بقفل/lease شرطي، ويقرأ keyset batches بترتيب إجمالي ثابت. لكل دفعة
  معاملة قراءة قصيرة أو query bounded، ثم streaming writer خارج transaction.
- لا شبكة أو object-storage I/O ولا PDF/XLSX generation داخل transaction.
- يفحص cancellation/deadline قبل وبعد كل batch، ولا يبدأ دفعة جديدة بعدهما. query
  بدأت بالفعل تضبط بمهلة DB؛ لا يدعى أن `AbortSignal` ألغتها إن لم يفعل driver.
- retry محدود وidempotent على artifact staging key خاص بالمحاولة. لا ينشر artifact
  إلا بعد إغلاق stream وحساب hash/size/row count والتحقق من `complete=true`.
- consistency عبر الدفعات تتطلب source watermark يطبقه كل Query Port. إذا لم يملك
  المصدر watermark يمنع export audit-grade الكبير أو يوسم صراحة `READ_AT_GENERATION`
  حسب عقد التقرير؛ لا تمسك معاملة طويلة لتصنع الوهم.
- عامل export ليس Outbox event. يستخدم job store وlease خاصين. Outbox يبقى للأحداث
  اللاحقة للـcommit، ويمكنه فقط إرسال إشعار `ReportExportCompleted` إذا وجد مستهلك
  فعلي وعقد versioned.

التنزيل يعيد authenticate/authorize/entitlement والشركة عند كل مرة، ثم يطابق metadata
والبصمة والحالة وTTL. سحب العضوية أو الصلاحية يمنع رابطًا جديدًا والوصول عبر API؛ لا
يكون `jobId` bearer token. اسم object غير قابل للتخمين ولا يحتوي اسم شركة/عميل.

## 9. الكاش الآمن

الأرشيف النظامي **ليس كاشًا**. كاش المنصة اختياري للنتائج المشتقة أو bytes القابلة
لإعادة البناء فقط، ويبقى `/api/v1` وملفات المصادقة `Cache-Control: no-store`؛ لا CDN
ولا shared HTTP cache لمخرجات مالية.

يحسب المفتاح بعد التفويض، ومن القيم التالية كلها:

```text
environment + cacheSchemaVersion + companyId + outputKind
+ projection/definitionVersion + snapshotSha256|parametersSha256
+ sourceWatermark + renderingProfileVersion + format + locale/direction
+ audience + redactionPolicyVersion + authorizationScopeDigest
```

- غياب `companyId` أو watermark/bصمة لازمة يعني bypass، لا global fallback.
- القيمة تحمل envelope بالقيم نفسها و`artifactSha256/byteLength/expiry`; mismatch أو
  hash failure يعامل miss مع security signal ولا يعاد المحتوى.
- authorize يحدث قبل lookup وقبل تنزيل artifact. تغير permission/entitlement أو
  redaction policy يغير digest ويمنع hit قديمًا.
- statutory archive يقرأ سجله/Artifact الأصلي حتى لو أخفق الكاش. report cache failure
  fail-open إلى المصدر ضمن deadline، ولا يوسع الصلاحية ولا يعيد قيمة stale من scope آخر.
- TTL وحجم الذاكرة وsingle-flight وحدود التوازي خاصة بكل resource. لا `Map` غير محدود.
- لا يخزن كاش التقارير payload في browser persistent storage. يجوز page-memory مؤقتة
  مع مسحها عند logout/401/403/تبديل الشركة وإهمال الاستجابة القديمة.

## 10. التفويض والتنقيح والخصوصية

- `ActorContext` ليس grant. كل issue/view/export/download/reprint يعيد التفويض بصلاحية
  الفئة والجمهور، مع entitlement الحالي وcompany scope المشتق من الجلسة.
- تفصل الصلاحيات على الأقل بين `external_document.issue/view`,
  `internal_accounting_evidence.view/export`, و`reports.<kind>.view/export` عند التنفيذ؛
  الأسماء النهائية تدخل Migration/OpenAPI/seed مع خريطة capability ولا تستنتج من
  صلاحية عامة قائمة.
- مالك projection يطبق field allow-list وredaction قبل hash. لا تنقح النواة بعد الرسم
  ولا تخفي نصًا بصريًا مع بقائه في PDF text layer أو metadata.
- كل projection يحمل `audience` و`classification`; mismatch بينهما وبين Registry يفشل.
- الأسماء والمسارات وlogs وmetrics لا تحمل رقمًا ضريبيًا أو هوية طرف أو مبلغًا أو
  raw parameters/cache key. Audit يحمل المراجع والبصمات والسياسة والفاعل دون نسخ الملف.
- الرواتب والحضور وبيانات الأفراد لا تدخل المنصة قبل سياسة خصوصية/تشفير/احتفاظ وصلاحية
  audience مستقلة؛ لا تجعل النواة المشتركة هذه البيانات عامة.

## 11. الفشل المغلق للضريبة

مسؤولية Sales/Tax projection، لا renderer، أن تقدم الحقول القانونية الكاملة كما
تتطلبها حزمة jurisdiction المؤرخة. تطبق القواعد التالية:

1. قيمة مقنعة مثل `last4` أو حقل مفقود/placeholder ليست رقمًا ضريبيًا صالحًا.
2. غياب seller identity أو tax number أو timestamps أو totals أو tax breakdown أو
   currency أو policy version المطلوبة يعيد `STATUTORY_TAX_DATA_INCOMPLETE`.
3. لا ينشأ QR/TLV، ولا عبارة «فاتورة ضريبية» أو «متوافق»، ولا `ISSUED` عند الفشل.
4. يجوز preview موسومًا `NOT_ISSUED` و`NOT_TAX_COMPLIANT` إذا سمحت السياسة، وبلا QR؛
   لا يستخدم artifact نفسه لاحقًا كنسخة صادرة.
5. يرفض renderer MachineReadableBlock غير مصادق من projection policy، ويقارن QR facts
   مع الحقول المرئية قبل artifact acceptance.
6. النسخة الخارجية لا تحتوي account codes أو journal entries أو cost centers أو
   creator/poster الداخليين. الملحق الداخلي يحتاج صلاحية وعقدًا وبصمة منفصلين.

لا يدعي هذا القرار امتثال ZATCA Phase 2 أو أي دولة. المهمة
`tax-document-presentation-implementation` هي أول شريحة عرض ضريبي حالية؛ نتيجتها
الحقيقية هي baseline اللاحق، ولا يعاد تنفيذ QR أو A4 أو amount-in-words هنا.

## 12. قابلية الوصول وQA البصري

- العرض الرقمي الأساسي يستخدم بنية semantic: عنوان واحد معتدل، نص واضح، رؤوس جدول
  مرتبطة بالخلايا، ترتيب قراءة صحيح، `lang/dir` لكل مقطع، وتباين وتركيز ولوحة مفاتيح.
- PDF يحتاج فحص text extraction وترتيب القراءة والخطوط والروابط والعناوين. لا يسمى
  PDF/UA أو accessible بالكامل قبل validator وقارئ شاشة؛ عند قصور المحرك توفر نسخة
  HTML/structured data مكافئة للمستخدم المصرح.
- الجداول لا تصغر الخط بلا حد كي تلائم الصفحة. تستخدم أعمدة profile، wrap، تكرار الرأس،
  landscape أو continuation pages. فشل geometry يوقف الرسم بدل clipping.
- visual fixtures اصطناعية تغطي العربية والإنجليزية والمختلط، الأرقام السالبة، أقصى
  Decimal، وصفًا طويلًا، 0/1/عدة صفحات، جدولًا واسعًا، شعارًا مفقودًا، وكل audience.
- QA يجمع assertions دلالية، استخراج النص، فحص عدم وجود الحقول المحظورة، pixel diff
  بعتبة مراجعة، وفحص يدوي للعينات المتغيرة. لا تستخدم بيانات عملاء حقيقية.
- THERMAL/barcode يحتاج matrix طابعة/DPI/ورق وقارئ وصورة artifact مطبوع؛ المحاكي أو PNG
  وحده لا يثبت دعم الجهاز.

## 13. الرصد والتشخيص

تضاف عند التنفيذ metrics منخفضة الكاردينالية فقط:

- `mcap_output_render_duration_seconds{output_class,format,profile,outcome}`.
- `mcap_output_render_total{output_class,format,outcome}`.
- `mcap_report_export_jobs{status}` و`mcap_report_export_job_duration_seconds{report_kind,format,outcome}`.
- `mcap_output_artifact_bytes{output_class,format}` histogram، وعدادات
  `cache_hit|miss|bypass|integrity_failure`, `truncated_rejected`, `cancelled`,
  `retention_purge`, و`statutory_fail_closed`.

القيم unions مغلقة. يمنع `companyId`, user/document/job IDs، filename، path/query،
parameters/hash، مبلغ/عملة، tax number أو error text كـlabels. السجل المنظم يحمل
requestId أو job reference داخليًا، النوع/profile/outcome/failureCode المنقح والمدة؛
لا يحمل snapshot أو artifact أو cache key.

لا توجد أرقام SLO في هذا ADR. تجمع baseline للحجم والزمن والصفوف وذاكرة العامل وDB
وقت القراءة وqueue age وfailure/cancel، ثم تعتمد p95/p99 والعتبات مع Operations. تنبيه
فوري مطلوب لفشل integrity أو وجود job عالق/منتهي lease أو فشل مستمر للإصدار النظامي؛
لا يثبت alert وحده فسادًا ماليًا ولا يسمح بإعادة كتابة archive.

## 14. التزامن والحدود التشغيلية

- لا rendering أو file I/O أو network I/O داخل transaction.
- issue وjob creation idempotentان؛ الجسم المختلف مع المفتاح نفسه يرفض. transition
  يستخدم `expectedVersion` أو conditional update، وclaim يستخدم lease/token.
- ترتيب إصدار المستند: Idempotency -> source aggregate وفق قفل مالكه -> archive key ->
  Audit/Outbox عند وجود مستهلك. لا يقفل Printing صفًا ثم يستدعي مالك المصدر بعكس الترتيب.
- artifact staging لا يصبح downloadable قبل hash/size/validation والانتقال الذري إلى
  `ISSUED/READY`.
- عدة formats للـprojection نفسها jobs مستقلة ببصمة profile، ولا تكتب فوق object واحد.
- حدود الصفوف/bytes/pages/time مطلوبة لكل profile. تجاوزها فشل واضح أو async handoff،
  لا truncation أو font shrinking صامت.

## 15. شرائح التنفيذ الدقيقة وعدم التداخل

### RDO-0 — القرار الحالي

- الملفات: `docs/architecture/ADR-028-report-document-output-platform.md` و
  `docs/release/report-document-output-decision/README_AR.md` فقط.
- لا Schema أو dependencies أو Runtime أو OpenAPI أو tests تطبيق.

### RDO-1 — Kernel للتقارير فقط، صالح بالتوازي

الملفات المحجوزة:

- جديد: `apps/api/src/document-output-kernel/{model,decimal,bidi,font-registry,table-pagination,pdf-profile,tabular-profile}.ts`.
- تعديل: `apps/api/src/platform/tabular-file-exporter.ts` و
  `apps/api/src/reports/financial-statement-exporter.ts`.
- جديد: `apps/api/tests/document-output-kernel-*.test.ts` و
  `apps/api/tests/report-output-visual-fixtures.test.ts`.
- تسليم: `docs/release/report-document-output-rdo1/README_AR.md`.

لا تلمس RDO-1 `apps/api/src/printing/**` ولا اختبارات/fixtures/scripts المملوكة لمهمة
الضريبة، ولا Schema/OpenAPI/package files. القبول: parity للتقارير الحالية، منع
`Number` للمال، formula injection، bidi/page overflow، وCSV/XLSX/PDF fixtures.
الرجوع: revert هذه الشريحة فقط إلى exporters الحاليين؛ لا بيانات جديدة.

### RDO-2 — عقد التقرير وmetadata والتنقيح

بعد RDO-1، الملفات المحجوزة:

- جديد: `apps/api/src/reports/report-output-registry.ts` و
  `apps/api/src/reports/report-result-envelope.ts`.
- تعديل: `apps/api/src/reports/report-router.ts`, `report-service.ts`,
  `cash-flow-service.ts`, `tax-summary-service.ts`, `cost-center-activity-service.ts`
  وQuery Port types/adapters التابعة لها.
- تعديل منسق: `packages/contracts/openapi.yaml`,
  `apps/api/src/generated/openapi-request-guards.ts` عبر التوليد، واختبارات
  `report-router`, `report-service`, OpenAPI parity/response.
- تسليم: `docs/release/report-document-output-rdo2/README_AR.md`.

لا تلمس Printing أو Prisma schema. القبول: parameters canonical، فصل
`asOf/generatedAt/watermark`، اكتمال/truncation صريح، عزل شركتين، permission/field
redaction، وتطابق المال والعكس بين JSON والصيغ. الرجوع يحافظ على العقد القديم عبر
compatibility window ولا يحذف field استخدمه عميل.

### RDO-3 — Bulk report export jobs

بعد قياس RDO-2، الملفات المحجوزة:

- `apps/api/prisma/schema.prisma` وترحيل توسعي واحد باسم وقت التنفيذ لـ
  `report_export_jobs` وartifact metadata فقط.
- جديد: `apps/api/src/reports/export-jobs/**` و
  `apps/api/src/composition/create-report-export-runtime.ts`.
- تعديل منسق: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `report-router.ts`,
  OpenAPI/الحراس/seed permissions واختبارات الوحدة والتكامل على MariaDB/MySQL.
- تخزين: Port في `export-jobs` وAdapter محلي/معتمد في composition؛ لا SDK يتسرب للعقد.
- تسليم: `docs/release/report-document-output-rdo3/README_AR.md`.

لا تلمس `apps/api/src/printing/**`. القبول: 202/state machine، keyset/stream، لا معاملة
طويلة، watermark، cancellation/lease/retry/idempotency، إعادة تفويض التنزيل، TTL,
hash، تعطل التخزين، وعزل/سحب صلاحية. الرجوع يعطل إنشاء jobs ويتيح تنزيل READY حتى
انتهاء TTL؛ لا يسقط الجدول أو يحذف artifacts عشوائيًا.

### RDO-4 — اعتماد المستندات للنواة والأرشيف v2، متسلسل بعد مهمة الضريبة

**حاجز البدء:** يمنع حجز أو تعديل أي ملف في هذه الشريحة حتى تنتهي
`tax-document-presentation-implementation` بـcommit محلي، وتراجع وتدمج نتيجتها في
baseline جديدة. تبدأ RDO-4 من ذلك الالتزام، لا من نسخة ADR-028 الحالية، ويكون لها
مسؤول واحد ونطاق حصري جديد.

النطاق الأقصى المحجوز لهذه الشريحة بعد إعادة الجرد الإلزامية هو:

- `apps/api/src/printing/print-types.ts`, `print-ports.ts`, `print-archive.ts`,
  `print-service.ts`, `pdf-renderer.ts`, `prisma-print-snapshot-query-adapter.ts`،
  وملفات العرض الضريبي الجديدة التي تكون قد دخلت baseline من المهمة السابقة.
- جديد: `apps/api/src/sales/sales-document-projection-port.ts`,
  `apps/api/src/purchases/purchase-document-projection-port.ts`,
  `apps/api/src/treasury/treasury-document-projection-port.ts`,
  `apps/api/src/core-accounting/accounting-evidence-projection-port.ts` و
  `apps/api/src/composition/create-document-output-runtime.ts`، لنقل اختيار الحقول
  إلى المالكين بدل إبقاء join عابر للسياقات داخل Printing.
- `apps/api/prisma/schema.prisma` وترحيل expand-only واحد لأرشيف v2؛
  `packages/contracts/openapi.yaml` والحراس المولدة و`app.ts/server.ts` فقط عند إضافة
  أوامر `prepare/issue/download` الجديدة.
- `apps/api/tests/print-archive-v2.test.ts`, `document-output-audience.test.ts`,
  `document-output-legacy-v1.test.ts`، واختبارات Printing المتغيرة بعد تحريرها، وتسليم
  `docs/release/report-document-output-rdo4/README_AR.md`.

لا تعيد RDO-4 تصميم قالب A4 الثنائي أو QR TLV أو amount-in-words، ولا تخفف fail-closed
الذي سلمته المهمة الضريبية. القبول: عقدا external/internal منفصلان، archive key متعدد
الجمهور والمراجعة، snapshot/artifact hashes، PREPARED/ISSUED retry، عدم تسرب قيود في
نسخة العميل، وقراءة legacy v1. الرجوع إلى binary archive-aware مثبت، بلا إسقاط صفوف.

### RDO-5 — Thermal/device profiles وaccessibility evidence

بعد RDO-4، وبمهمة مستقلة:

- جديد: `apps/api/src/document-output-kernel/thermal-profile.ts` وAdapters للطابعات
  تحت `apps/api/src/printing/thermal/**`؛ لا أوامر خام من API.
- تعديل عقود المخرج المطلوب واختباراته فقط، و`tests/visual/document-output/**` ودليل
  أجهزة تحت `docs/release/report-document-output-rdo5/evidence`.
- لا يعدل barcode identity/codec في Inventory ولا tax projection.

القبول: profiles ثابتة، limits/encoding/RTL، matrix جهاز فعلي، بديل رقمي accessible،
وحجب الفاتورة الضريبية الحرارية حتى profile دولة صالح. الرجوع يعطل profile flag ويبقي
A4/archives قابلة للقراءة.

لا تبدأ شريحتان تشتركان في ملف. أي تغير في هذه القوائم بسبب baseline الجديدة يعاد
تسجيله في `WORKSPACE.json` قبل البدء، ولا توسع المهمة بصمت.

## 16. مصفوفة الاختبارات وبوابات القبول

كل شريحة ذات صلة تثبت:

1. projection owner لا renderer هو من يختار الحقول والحساب؛ حارس imports يمنع Prisma
   وخدمات المجالات داخل kernel.
2. شركتان ومستخدمان بأدوار مختلفة: لا أسماء أو صفوف أو totals أو artifacts أو cache
   hits عابرة، في PDF/CSV/XLSX/thermal والمحتوى المفكوك لا status فقط.
3. external document لا يحتوي account/journal/internal identities؛ internal evidence
   لا ينال بصلاحية external.
4. snapshot hash ثابت رغم ترتيب مفاتيح object، ويتغير عند field/projection/redaction
   policy؛ تغيير rendering profile يغير artifact hash/cache key ولا يعيد كتابة snapshot
   hash. legacy hash يقرأ ولا يعاد كتابته.
5. Decimal extreme/negative/zero وrounding metadata بلا `Number`، وتطابق JSON مع كل
   format.
6. long/mixed RTL/LTR، خطوط fallback، جداول متعددة الصفحات، لا clipping أو loop،
   واستخراج نص وترتيب صفحة.
7. async: duplicate request، عاملان، lease expiry، crash بعد حفظ artifact وقبل READY،
   cancellation/deadline، storage failure، retry exhausted، expiry وrevoked access.
8. statutory: missing/masked tax fields، QR mismatch، policy expired، renderer failure؛
   لا `ISSUED` ولا QR ولا ادعاء امتثال.
9. retention: legal hold، policy update، purge idempotent، وrollback binary يقرأ الصفوف.
10. Barcode/thermal round-trip من artifact مطبوع فعليًا عند تفعيل profile جهاز.

TypeScript والعقد وOpenAPI generated guard وresponse validation وبوابتا MariaDB 10.11
وMySQL 8.4 مطلوبة حسب الملفات المتغيرة. visual/device evidence لا تستبدل اختبارات
العزل والحساب، والاختبارات الوهمية لا تثبت lease أو migration.

## 17. أثر الباركود وقنوات الهاتف

الأثر موجود وليس `N/A` لأن القرار يحكم Printing/Export وthermal:

- Inventory يبقى مالك تعريف product barcode وsymbology/value والتطبيع. المنصة ترسم
  فقط قيمة وصلت من `InventoryBarcodeLabelQueryPort` أو projection مملوكة.
- QR الضريبي MachineReadableBlock قانوني مستقل، وليس product barcode ولا deep link.
  لا يعاد استخدام parser أو جدول Inventory له.
- أي item barcode يظهر في مستند يأخذ snapshot من مالك البند وقت الإصدار؛ لا يعيد lookup
  عند إعادة الطباعة، ولا يدعي lot/serial/expiry غير موجود.
- profiles تحفظ DPI وquiet zones وHRI، وتختبر round-trip من PNG/PDF ثم ورق فعلي.
- الهاتف/الكاميرا لا يفتحان QR أو URL تلقائيًا ولا ينقلان permission أو tax policy
  أو archive decision إلى العميل.

## 18. البدائل المرفوضة

### خدمة Reports/Printing واحدة تملك الاستعلام والرسم

مرفوضة لأنها تنقل projection والضريبة وLedger إلى shared service، وتعيد إنشاء مصدر
حقيقة موازٍ وتزيد direct cross-context reads.

### قالب عالمي مليء بالحقول الاختيارية

مرفوض لأنه يسمح بمرور حقول داخلية إلى جمهور خارجي ويجعل versioning والتدقيق والتنقيح
غير قابلين للإثبات.

### إعادة الحساب عند كل إعادة طباعة

مرفوض للمستند الصادر؛ تغير الاسم أو الحساب أو الضريبة أو renderer لا يجب أن يغير ما
صدر. يعاد الرسم من snapshot فقط وفق سياسة artifact المعلنة.

### حفظ كل تقرير دائمًا

مرفوض لأنه يكرر بيانات مالية حساسة ويخلط القراءة بالحقيقة ويخلق retention وتكلفة بلا
حاجة. الحفظ الدائم أمر evidence صريح، والتصدير العادي artifact قصير العمر.

### معاملة DB واحدة طوال bulk export

مرفوضة بسبب الأقفال/undo والـpool والـdeadline. الاتساق يأتي من watermark/read model
وبatches قصيرة، أو يعلن مستوى الاتساق ولا يدعى أكثر منه.

### public/shared cache للملفات المالية

مرفوض حتى مع URL غير قابل للتخمين؛ URL ليس تفويضًا، و`companyId` وحده لا يمثل audience
أو redaction أو permission revision.

## 19. النتائج والحالة

القرار يقلل تكرار الرسم من دون توسيع ملكية Printing أو Reporting، ويفصل بصورة قابلة
للاختبار بين نسخة العميل والدليل الداخلي والتقرير، ويعطي التصدير الكبير مسارًا لا
يمسك معاملات طويلة. كلفته Registry وعقود versioned وأرشيف/Job lifecycle وسياسة
احتفاظ ومصفوفة QA أوسع.

هذه المهمة اعتمدت القرار فقط. لم تنفذ kernel أو archive v2 أو job أو cache أو thermal،
ولم تعدل المهمة الضريبية الجارية أو Runtime أو Schema أو dependencies. التنفيذ يبدأ
بالشرائح المسجلة أعلاه وبصلاحيات ملفات مستقلة.
