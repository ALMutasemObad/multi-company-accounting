---
title: "ADR-023 — Central Accounting Default Mappings"
status: "proposed for acceptance; implementation not started"
version: "1.2"
date: "2026-09-09"
decision_owner: "Core Accounting"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "ADR-003-domain-boundaries-and-eventing.md"
  - "ADR-018-business-profile-and-progressive-compliance.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "CENTRAL_ACCOUNTING_MAPPINGS_SLICE_AR.md"
---

# ADR-023: مركز تعيين الحسابات التشغيلية الافتراضية

## السياق

تحتاج الوحدات التشغيلية إلى حسابات دفتر الأستاذ لأغراض مختلفة. التنفيذ الحالي لا
يملك مصدرًا واحدًا لهذه الافتراضات، بل يجمع بين ثلاثة أنماط مختلفة:

1. مراجع محفوظة تمثل حقيقة خاصة بكيان أو مستند، مثل حساب ذمم العميل أو المورد،
   وحساب إيراد ملف بيع الصنف، وحسابات بنود الفواتير.
2. إعدادات يملكها سياق آخر، مثل حساب دفتر الصندوق/البنك وحسابي معدل الضريبة.
3. استدلال وقت التشغيل داخل Inventory وFX وFinancial Close من
   `sourceTemplateKey` أو من رقم الحساب `3300`.

النمط الثالث يربط صحة الأوامر المالية بالقالب الأولي، ويكرر قواعد الأهلية، ولا يسمح
للمنشأة بتغيير حساب تشغيلي واحد من مكان واضح. أما جمع الأنماط الثلاثة كلها في جدول
واحد فسيكسر ملكية السياقات واللقطات التاريخية. لذلك يلزم فصل **افتراض الشركة** عن
**الحقيقة الخاصة بالكيان أو المستند**.

## جرد التنفيذ الحالي الذي يحكم القرار

| الاستعمال الحالي | مصدر الحساب | الدلالة التي يجب الحفاظ عليها |
|---|---|---|
| `Customer.receivableAccountId` | يرسله إنشاء/تعديل العميل، ويستخدمه Sales وTreasury لاحقًا | حقيقة خاصة بالطرف؛ لا تتغير عند تغيير الافتراض |
| `Supplier.payableAccountId` | يرسله إنشاء/تعديل المورد | حقيقة خاصة بالطرف؛ لا تتغير عند تغيير الافتراض |
| `SalesItemSellingProfile.revenueAccountId` | يضبط لكل صنف | حقيقة ملف بيع الصنف؛ الافتراض يملأ الجديد فقط |
| `SalesInvoiceLine.revenueAccountId` | يحفظ مع بند الفاتورة | لقطة مستند لا يعاد تفسيرها |
| `PurchaseInvoiceLine.debitAccountId` | يحفظ مع بند الفاتورة | لقطة مستند، وقد يكون أصلًا أو مصروفًا باختيار صريح |
| Inventory: أصل المخزون وCOGS | بحث وقت التشغيل عن `inventory` و`purchases` تحت `SMALL_BUSINESS_GENERAL` | افتراض شركة حقيقي يجب نقله إلى المركز |
| Inventory: الزيادة/النقص/الافتتاحي | بحث عن `misc-income` أو `misc-expense` أو `retained-earnings`، ثم حفظ `offsetAccountId` على الحركة | يحل المركز الحساب قبل الترحيل، وتبقى الحركة لقطة تاريخية |
| FX المحقق | `RealizedFxAccountService` يبحث عن `realized-fx-gain/loss` تحت القالب القديم | افتراض شركة حقيقي يجب نقله إلى المركز |
| الإقفال السنوي | `FinancialCloseService` يبحث مباشرة عن الحساب ذي الرمز `3300` | دين تقني يجب إزالته عبر Port مركزي |
| `TaxRate.outputTaxAccountId/inputTaxAccountId` | يملكه Tax لكل معدل | إعداد خاص بمعدل الضريبة؛ لا ينقل إلى المركز |
| `CashBankAccount.ledgerAccountId` | يملكه Treasury لكل أداة | حقيقة خاصة بالصندوق/البنك؛ لا ينقل إلى المركز |
| `Receipt/Payment.counterAccountId` | اختيار خاص بالحركة | حقيقة مستند؛ لا ينقل إلى المركز |
| `CashFlowAccountMapping.accountId` | تصنيف محفوظ تملكه Reporting | يبقى لدى Reporting؛ يفحصه Account lifecycle عبر Port المالك |
| القيد اليدوي ومراكز التكلفة | اختيار صريح في المستند | خارج مفهوم default mapping |
| دورة حياة `Account` | `Account` بلا `version`، والتعطيل يفحص الأبناء النشطين فقط، بينما الحذف يعد علاقات متعددة مباشرة من Prisma ولا يشمل كل التاريخ | فجوة اتساق وحدود؛ تعالج بـCAS وحارس استعمال مركب عبر Ports المالكين |

المراجع التنفيذية لهذا الجرد هي `apps/api/prisma/schema.prisma`،
`apps/api/src/accounts/default-chart-template.ts`،
`apps/api/src/core-accounting/realized-fx-account-service.ts`،
`apps/api/src/inventory/inventory-movement-service.ts`،
`apps/api/src/fiscal/financial-close-service.ts`، وخدمات العملاء والموردين والفواتير.
ويثبت `apps/api/src/reports/cash-flow-service.ts` أن Reporting هو كاتب تصنيف Cash
Flow الحالي.

## القرار

### 1. المالك والحد

يملك **Core Accounting** سجل `CompanyAccountingDefaultMapping` وقاموس مفاتيحه وقواعد
أهلية الحساب وحل الحسابات للمستهلكين. السبب أن المرجع النهائي هو `Account` وأن صحة
الحساب للتسجيل في Ledger قاعدة محاسبية، لا حقيقة تخص Sales أو Inventory.

لا يملك المركز العميل أو المورد أو الصنف أو معدل الضريبة أو أداة الخزينة أو بند
الفاتورة. لا يكتب أي مستهلك في جدول التعيينات أو `Account` مباشرة؛ يستدعي منفذًا
صغيرًا يقدمه Core Accounting.

### 2. قاموس المفاتيح الأولي المغلق

تكون المفاتيح Enum في Prisma وTypeScript وOpenAPI، وليست نصوصًا حرة:

| المفتاح | الفئة المؤهلة | الاستعمال الأول |
|---|---|---|
| `CUSTOMER_RECEIVABLE_DEFAULT` | `ASSET`، حساب ترحيل نشط، Control | ملء حساب عميل جديد عند عدم إرسال override |
| `SUPPLIER_PAYABLE_DEFAULT` | `LIABILITY`، حساب ترحيل نشط، Control | ملء حساب مورد جديد عند عدم إرسال override |
| `SALES_REVENUE_DEFAULT` | `REVENUE`، حساب ترحيل نشط | ملء الإيراد العام الجديد |
| `SERVICE_REVENUE_DEFAULT` | `REVENUE`، حساب ترحيل نشط | ملء خدمة/فوترة مهنية جديدة دون تغيير عقد قائم |
| `PURCHASE_EXPENSE_DEFAULT` | `EXPENSE`، حساب ترحيل نشط | ملء بند مصروف مشتريات جديد؛ لا يستبدل اختيار أصل صريحًا |
| `INVENTORY_ASSET` | `ASSET`، حساب ترحيل نشط، Control | أصل المخزون في الحركات والفواتير المستقبلية |
| `INVENTORY_COGS` | `EXPENSE`، حساب ترحيل نشط | تكلفة البضاعة المباعة |
| `INVENTORY_GAIN` | `REVENUE`، حساب ترحيل نشط | زيادة/تسوية مخزون دائنة |
| `INVENTORY_LOSS` | `EXPENSE`، حساب ترحيل نشط | نقص/هالك/تسوية مخزون مدينة |
| `INVENTORY_OPENING_EQUITY` | `EQUITY`، حساب ترحيل نشط | الطرف المقابل لرصيد افتتاحي للمخزون |
| `REALIZED_FX_GAIN` | `REVENUE`، حساب ترحيل نشط | ربح فرق عملة محقق |
| `REALIZED_FX_LOSS` | `EXPENSE`، حساب ترحيل نشط | خسارة فرق عملة محققة |
| `RETAINED_EARNINGS` | `EQUITY`، حساب ترحيل نشط | قيد الإقفال السنوي |

الأهلية المشتركة لكل المفاتيح: الحساب من الشركة نفسها، نشط، `allowsPosting=true`،
ولا يملك أطفالًا. لا يكفي تطابق الفئة وحده. يفحص قاموس واحد هذه القاعدة عند الكتابة
وعند الحل وعند محاولة تغيير الحساب المرجعي.

لا تضاف مفاتيح Payroll أو Fixed Assets أو Employee Expenses قبل وجود مسار مالي
مقبول يحدد invariant والمستهلك. وجود حساب باسم مناسب في القالب لا يصنع عقد تشغيل.

### 3. معنى default وعدم إعادة كتابة التاريخ

المركز يحدد افتراضًا للمستقبل، وليس علاقة ديناميكية بكل كيان:

- إنشاء عميل أو مورد بلا `accountId` صريح يحل الافتراض ثم **يحفظ** الحساب على الطرف.
- إذا سمح العقد بـoverride صريح، يتحقق Sales/Purchases من أهليته ويحفظه؛ لا يغير
  override تعيين الشركة.
- إنشاء ملف بيع صنف أو خدمة جديدة يمكن أن يعرض/يستخدم الافتراض، ثم يحفظ الحساب على
  الملف. تعديل التعيين لاحقًا لا يغير الملفات الموجودة.
- تحفظ بنود الفواتير والحركات والقيود الحساب الذي استخدم فعليًا. لا يعاد تفسير
  مستند POSTED ولا لقطة تاريخية.
- حسابات Inventory النظامية وFX والإقفال تحل في معاملة الأمر للحركة الجديدة. العكس
  يستخدم الأثر الأصلي ولا يعيد حل التعيين الحالي.

لا توجد cascade أو bulk rewrite عند تغيير mapping. أي إعادة تصنيف لكيانات قائمة
تحتاج أمرًا منفصلًا، preview، نطاقًا صريحًا، صلاحية، version، تدقيقًا وخطة أثر؛ وهي
خارج الشرائح الأولى.

### 4. النموذج المستهدف

ينشأ جدول مملوك لـCore Accounting بالحد الأدنى التالي:

```text
CompanyAccountingDefaultMapping
  companyId       BIGINT UNSIGNED
  key             AccountingDefaultMappingKey
  accountId       BIGINT UNSIGNED
  version         INT UNSIGNED
  source          TEMPLATE_SEED | LEGACY_BACKFILL | MANUAL
  createdById     BIGINT UNSIGNED NULL
  updatedById     BIGINT UNSIGNED NULL
  createdAt       DATETIME
  updatedAt       DATETIME
  PRIMARY KEY (companyId, key)
  FK (accountId, companyId) -> Account(id, companyId) RESTRICT
```

يجوز أن تكون هوية الفاعل `NULL` فقط لصف أنشأه Migration أو تجهيز نظامي موثق؛ كل
تغيير تفاعلي يحمل المستخدم ويكتب Audit. لا يستخدم المفتاح كرمز يختاره المستخدم،
ولا يحتاج `MasterDataCodeSequence`.

`source` أصل إنشاء الصف لا أولوية حل. بعد التعديل اليدوي يصبح `MANUAL`. لا يغير
تطبيق القالب أو إعادة تشغيل Seed صفًا موجودًا، وبخاصة الصف اليدوي.

ويضاف إلى Aggregate `Account` الحقل `version INT UNSIGNED NOT NULL DEFAULT 0`.
تحمل كل أوامر تحديث الحساب وتعطيله وحذفه `expectedVersion`، وتقفل صف الحساب ثم تنفذ
CAS على `(id,companyId,version)`؛ يزيد التحديث والتعطيل النسخة مرة واحدة. هذا ليس
جزءًا من جدول التعيينات، بل إغلاق لفجوة موجودة لأن `Account` Aggregate قابل للتغيير
ويحكم أهلية الترحيل. يجب أن يحدث OpenAPI وWeb وكل المستهلكين في إصدار منسق؛ لا يبقى
مسار كتابة legacy يتجاوز `expectedVersion` بعد التفعيل.
إذا غيّر reparent مستويات descendants يقفلها حسب id ويزيد نسخة كل صف تغير، وإذا
ربط تطبيق القالب tags بحساب قائم يمر بالعقد نفسه؛ لا توجد كتابة خلفية تتجاوز النسخة.

### 5. التوافق مع القوالب و`sourceTemplateKey`

تحتفظ القوالب الثلاثة الجديدة في مسار Company Profile بالأكواد:

- `PROFESSIONAL_SERVICES`.
- `RETAIL_INVENTORY`.
- `MANUFACTURING`.

لكن الحسابات الأساسية المشتركة تبقى موسومة حاليًا بـ
`sourceTemplateCode=SMALL_BUSINESS_GENERAL`، بينما تحمل الإضافات فقط كود القالب
المختار. لذلك يمنع افتراض أن `sourceTemplateCode` لكل حساب يساوي قالب الشركة.

ترتيب seed/backfill الحتمي هو:

1. صف mapping موجود وصالح؛ لا يلمس.
2. مرشح overlay دقيق للقالب المختار، إن كان للمفتاح مرشح خاص.
3. مرشح الأساس الدقيق `(SMALL_BUSINESS_GENERAL, sourceTemplateKey)`.
4. أثناء backfill فقط: حساب صالح وحيد يحمل `sourceTemplateKey` نفسه عبر أي كود؛
   التعدد Conflict ولا يختار أول صف.
5. للحساب المحتجز فقط، يدعم تقرير الترحيل اكتشاف `3300` كدين legacy إذا لم يوجد
   مفتاح قالب وكان المرشح وحيدًا ومؤهلًا. يسجل provenance ولا يبقى بحث الرقم في
   Runtime.
6. إذا لم يوجد مرشح وحيد صالح يترك المفتاح `UNMAPPED` للمراجعة؛ لا تخمين بالاسم.

خريطة المرشحين الأولية:

| المفتاح | `sourceTemplateKey` الأساسي | overlay المفضل |
|---|---|---|
| `CUSTOMER_RECEIVABLE_DEFAULT` | `receivables` | لا يوجد |
| `SUPPLIER_PAYABLE_DEFAULT` | `payables` | لا يوجد |
| `SALES_REVENUE_DEFAULT` | `sales-revenue` | لا يوجد؛ لا تخلط بيعًا عامًا بخدمة مهنية |
| `SERVICE_REVENUE_DEFAULT` | `service-revenue` | `PROFESSIONAL_SERVICES:professional-services-revenue` |
| `PURCHASE_EXPENSE_DEFAULT` | `purchases` | لا يوجد |
| `INVENTORY_ASSET` | `inventory` | لا يختار raw/WIP/finished تخمينيًا |
| `INVENTORY_COGS` | `purchases` | لا يوجد في الشريحة الأولى |
| `INVENTORY_GAIN` | `misc-income` | لا يوجد |
| `INVENTORY_LOSS` | `misc-expense` | `RETAIL_INVENTORY:inventory-shrinkage` للشركة المختارة حديثًا |
| `INVENTORY_OPENING_EQUITY` | `retained-earnings` | لا يوجد |
| `REALIZED_FX_GAIN` | `realized-fx-gain` | لا يوجد |
| `REALIZED_FX_LOSS` | `realized-fx-loss` | لا يوجد |
| `RETAINED_EARNINGS` | `retained-earnings` | لا يوجد |

يسمح لعدة مفاتيح بأن تشير إلى الحساب نفسه. لا يعني وجود حسابات تصنيع تفصيلية أن
النظام الحالي يعرف تصنيف كل صنف إلى خام/WIP/تام؛ اعتماد ذلك يحتاج نموذجًا وقرارًا
من Inventory، لا تخمينًا في المركز.

تنسيق التنفيذ مع Company Profile مؤقت لأن Schema وOpenAPI وملف القالب ملفات مشتركة.
بعد تطبيق القالب يمرر Onboarding قيمة `chartTemplateCode` إلى Accounting Setup Port
كي ينشئ Core Accounting التعيينات الناقصة في المعاملة نفسها. لا يستورد Core
Accounting نموذج `CompanyProfile` ولا يقرأ readiness/امتثال المنشأة وقت التشغيل.
غياب `CompanyProfile` في شركة قديمة لا يمنع استخدام التعيينات.

### 6. الحل وPorts

يكشف Core Accounting عقود Application صريحة، لا Prisma models:

```text
AccountingDefaultMappingCommandPort.resolveForCommand(tx, companyId, keys)
AccountingDefaultMappingSetupPort.seedMissing(tx, companyId, templateCode, actor)
AccountingDefaultMappingReadPort.inspectConfiguration(companyId)
LegacyMappingDiagnosticPort.compare(companyId, keys) // rollout only
```

تعيد قراءة الأمر الحاكمة مرجعًا محدودًا:
`key/accountId/accountClass/mappingVersion/source`. لا يسمح للمستهلك بطلب مفتاح نصي
خارج Enum، ولا تعيد DTO الحساب أو Prisma record كاملًا.

اتجاهات الاعتماد:

- Sales وPurchases وInventory وProfessional Billing تستهلك Command Port المقفل.
- `RealizedFxAccountService` وFinancial Close يصبحان Adapter/مستهلكين داخل Core
  Accounting نفسه، من دون بحث قالب أو رقم حساب.
- Registration/Onboarding يستهلك Setup Port بصفته Process Manager.
- Reporting يقرأ readiness عبر Query API أو Read Port فقط.
- دورة حياة Account في Core Accounting تستهلك
  `ReportingAccountUsageQueryPort` لفحص `CashFlowAccountMapping`؛ لا يقرأ Core جدول
  Reporting مباشرة.

لا يكتب أي Port في Customer/Supplier/Inventory/Tax/Treasury/Reporting. يقرر كل مالك
متى ينسخ default إلى كيانه داخل معاملته.

`resolveForCommand` ليس Query عاديًا: يثبت الحساب والنسخة والأهلية تحت الأقفال قبل
أن يحفظ الأمر حقيقة جديدة أو يبني Posting Plan. يستخدمه إنشاء Customer وSupplier
و`SalesItemSellingProfile` عند غياب override، كما تستخدمه Inventory وFX والإقفال.
يقرأ `(accountId,mappingVersion)` تمهيديًا، ثم يقفل Accounts تصاعديًا قبل mappings
معجمية، ويعيد القراءة. إذا تغير المرجع أو النسخة أو الأهلية يعيد
`ACCOUNTING_DEFAULT_MAPPING_CHANGED` ولا يحفظ الكيان على قرار قديم. أما override
الصريح فيقفل Account نفسه ويتحقق منه ولا يقرأ mapping.

### 7. سياسة الحل والمقارنة التشخيصية

الأولوية وقت التشغيل:

1. الحساب الصريح الخاص بالأمر أو الكيان، إذا كان العقد يسمح به، ثم التحقق والحفظ.
2. صف mapping مادي صالح يحمل `accountId` و`mappingVersion`.
3. خطأ `ACCOUNTING_DEFAULT_MAPPING_REQUIRED` بحالة readiness ورابط الإعدادات؛ لا
   رجوع إلى قالب أو رقم أو اسم أو حساب من فئة مماثلة.

إذا وجد صف mapping لكنه أصبح غير صالح، يفشل المسار مغلقًا؛ لا يتجاوزه إلى القالب.
هذا يكشف خطأ الإدارة بدل ترحيل عملية على حساب لم يختره المستخدم.

لا يعيد `resolveForCommand` نتيجة بلا صف ونسخة، في أي mode.
تبقى قراءة القالب القديم في `LegacyMappingDiagnosticPort` منفصلة عن resolver، وتعمل
فقط في backfill preview و`DIAGNOSTIC_SHADOW`: تقارن المرشح القديم بصف materialized
وتسجل حالة منقحة، ولا تغذي readiness ولا Command ولا Consumer ولا close pack.

لا تنتقل شركة/دفعة rollout إلى `READ_ONLY_AUTHORITATIVE` أو إلى أي مستهلك مركزي حتى
تجتاز completeness gate: صف صالح مادي و`mappingVersion` لكل المفاتيح الثلاثة عشر،
صفر missing/invalid/ambiguous، ونجاح فحص العزل والأهلية. بعدها فقط يشغل dual-read
للتشخيص مع بقاء التطبيق القديم هو السلطة، ثم ينقل المستهلك إلى resolver الصفوف
وحدها. لا يوجد mode يجمع «صف إن وجد وإلا قالب».

يزال Legacy diagnostic lookup بعد اكتمال المقارنة والتحويل، ولا تعتمد إزالته على
تاريخ تقويمي وحده.

### 8. Readiness حسب القدرة

قبل اجتياز البوابة يعيد Read Port لكل مفتاح `CONFIGURED/UNMAPPED/INVALID` ويعرض
`configurationCompleteness=INCOMPLETE`؛ هذه **preview تشخيصية** وليست readiness
حاكمة. تصبح readiness `READ_ONLY_AUTHORITATIVE` فقط عندما تكون المفاتيح الثلاثة عشر
كلها `CONFIGURED` بصف ونسخة صالحين. بعد البوابة يجمع أثر أي خلل لاحق حسب القدرة:

| القدرة | المفاتيح الحاكمة | أثر الغياب |
|---|---|---|
| إنشاء عميل بلا override | `CUSTOMER_RECEIVABLE_DEFAULT` | يمنع default فقط؛ يبقى override الصريح ممكنًا إذا سمح العقد |
| إنشاء مورد بلا override | `SUPPLIER_PAYABLE_DEFAULT` | السلوك نفسه |
| ملف بيع/خدمة بلا override | `SALES_REVENUE_DEFAULT` أو `SERVICE_REVENUE_DEFAULT` | يطلب اختيارًا صريحًا أو الإعداد |
| بند مشتريات غير مخزني بلا override | `PURCHASE_EXPENSE_DEFAULT` | يطلب اختيارًا صريحًا أو الإعداد |
| ترحيل مخزون | `INVENTORY_ASSET` و`INVENTORY_COGS` وما يلزم لنوع الحركة | يمنع الأمر المالي قبل أي أثر |
| تسوية متعددة العملة ذات فرق محقق | `REALIZED_FX_GAIN/LOSS` | يمنع التسوية ذات الفرق فقط |
| كل close pack؛ والقيد في الإقفال السنوي | `RETAINED_EARNINGS` | يمنع بناء/اعتماد pack إذا غاب أو بطل؛ غير السنوي يثبت المرجع ولا ينشئ به قيدًا |

لا تعتبر الحسابات القديمة على العملاء والموردين غير صالحة لمجرد اختلافها عن default.
Readiness المركز لا يعيد التحقق الجماعي من كل تاريخ المستندات.

لكل حزمة إقفال لا تكفي مساواة readiness لحظة العرض. تحفظ لقطة checklist/close pack
القيمة الدقيقة، ويستخدمها القيد نفسه في الإقفال السنوي فقط:

```json
{"key":"RETAINED_EARNINGS","accountId":"42","mappingVersion":3}
```

تدخل القيمة دائمًا في الـcanonical checklist/pack hash وفي approval subject
snapshot، حتى إذا لم ينشئ الإقفال غير السنوي قيد أرباح مبقاة. لذلك يكون
`accountId/mappingVersion` دائمًا قابلين للقفل ولا توجد حالة `null`. عند approve وعند close
النهائي، وبعد أقفال
`FiscalPeriod/FinancialCloseRun` الحاكمة، يقفل الأمر Account الملتقط ثم mapping،
ويعيد حل المفتاح والتحقق من `accountId/mappingVersion` والأهلية. أي اختلاف يعيد
`CHECKLIST_CHANGED` ويحتاج تحديث الحزمة وموافقة جديدة؛ لا يستخدم mapping الأحدث أو
أي lookup قديم بصمت. يتلقى منشئ مستند الإقفال `accountId` الملتقط الذي تم التحقق منه، ولا
يبحث عن `3300` ولا ينفذ resolve جديدًا بعد المقارنة.

### 9. دورة حياة الحساب المرجعي

لا يوجد DELETE/DEACTIVATE للتعيين. يمكن استبدال `accountId` فقط مع CAS وسبب اختياري
منقح. لكن استبدال mapping وحده لا يجعل الحساب القديم قابلًا للتعطيل أو الحذف.

يركب Core Accounting خدمة `AccountUsageGuard` من نتائج Ports صغيرة ينفذها مالكو
الحقائق. تتلقى كلها `tx/companyId/accountId` وتعيد فئات استعمال وأعدادًا محدودة، لا
Prisma records:

- Core Accounting يفحص الأبناء و`CompanyAccountingDefaultMapping` و`JournalLine`
  وأي حقيقة دفتر يملكها.
- `SalesAccountUsageQueryPort` يفحص Customer و`SalesItemSellingProfile` ولقطات
  `SalesInvoiceLine` الحالية والتاريخية.
- `PurchasesAccountUsageQueryPort` يفحص Supplier ولقطات `PurchaseInvoiceLine`.
- `TaxAccountUsageQueryPort` يفحص حسابي `TaxRate`.
- `TreasuryAccountUsageQueryPort` يفحص `CashBankAccount` وReceipt/Payment counter
  snapshots.
- `InventoryAccountUsageQueryPort` يفحص `InventoryMovement.offsetAccountId` وتاريخه.
- `ReportingAccountUsageQueryPort` يفحص `CashFlowAccountMapping` الذي يملكه Reporting.

كل Port إلزامي في Composition Root. غيابه أو رميه خطأ يفشل Account lifecycle مغلقًا
ويرجع المعاملة؛ لا يفسر الفشل كعدم استعمال، ولا يلتف Core عليه بقراءة جدول المالك.

يستدعي أمر Account الحارس داخل معاملته وبعد قفل Account وقبل:

- التعطيل أو الحذف.
- تغيير `accountTypeId` إلى فئة غير مؤهلة.
- جعل `allowsPosting=false`.
- إزالة `isControlAccount` عن حساب مربوط بمفتاح يتطلب Control.
- أي تغيير يجعله غير صالح للمفتاح.

التعطيل والحذف ممنوعان عند **أي** استعمال جار أو تاريخي، لا عند mapping وحده، لأن
العكس يجب أن يستطيع استعمال الحساب الأصلي. يعيد الرفض `ACCOUNT_IN_USE` بفئات آمنة
وأعداد محدودة، ويضيف مفاتيح mapping إن وجدت، من دون معرفات أطراف أو مستندات. يعاد
إسناد المراجع الجارية القابلة للتعديل فقط عبر أوامر سياقاتها المالكة؛ أما اللقطات
والقيود immutable فتبقي الحساب نشطًا ولا يوجد cascade أو تعطيل تلقائي. يمكن تصميم
حالة أرشفة/إخفاء مستقلة مستقبلًا، لكنها لا تعيد تعريف `isActive`.

لبيانات legacy التي تحتوي حسابًا معطلًا مستخدمًا تاريخيًا، يسمح Posting Engine
بمسار ضيق للعكس فقط: يقبل الحساب المعطل إذا طابق تمامًا حساب المصدر/القيد الأصلي
immutable وكانت العملية reversal موثقة. لا يسمح به لعملية جديدة أو override أو
mapping. يسجل فحص Migration هذه الحالات ولا يعيد تنشيطها بصمت. الحذف يبقى ممنوعًا
دائمًا متى وجد أي مرجع أو تاريخ.

### 10. التزامن والمعاملة

تغيير تعيين تفاعلي أمر idempotent ويحمل `expectedVersion`. يكون ترتيب القفل الموحد:

```text
Idempotency record
-> Account rows المطلوبة بترتيب id تصاعديًا
-> CompanyAccountingDefaultMapping rows بترتيب key
-> conditional update/insert
-> Audit
-> Outbox فقط عند وجود مستهلك مقبول
```

تستخدم أوامر تعطيل/حذف/تحوير Account الترتيب نفسه: تقفل الحساب أولًا ثم صفوف
التعيين التي تشير إليه، ثم تستدعي Usage Ports بترتيب ثابت، قبل CAS على
`Account.expectedVersion`. عند إنشاء mapping مفقود يقفل الحساب الهدف قبل الإدراج،
فيتسلسل مع التعطيل. عند استبدال mapping تقرأ النسخة، ثم تقفل الحسابين القديم والجديد
تصاعديًا، ثم صف المفتاح، وتعاد قراءة النسخة والأهلية قبل التغيير.

تستخدم أوامر إنشاء Customer/Supplier/Selling Profile بروتوكول
`resolveForCommand`: بعد أقفال Aggregate المصدر إن وجدت، تقرأ mapping تمهيديًا،
وتقفل Account ثم mapping، وتعيد فحص الأهلية والنسخة، ثم تحفظ المرجع على الكيان.
وبذلك ينتج سباق create-vs-replace أو create-vs-deactivate إما أمرًا كاملًا على نسخة
صالحة أو Conflict بلا إنشاء جزئي. يطبق الإقفال السنوي الترتيب نفسه على اللقطة المثبتة
بعد أقفال الفترة/التشغيل وقبل Ledger.

إذا تغير الصف بين القراءة والقفل يعاد `VERSION_CONFLICT` ولا يعاد خطأ الأعمال
تلقائيًا. يعاد فقط خطأ قاعدة transient عبر `TransactionExecutor` ضمن deadline واحد.
لا Network I/O ولا sleep داخل المعاملة.

يكتب تغيير mapping وAudit وسجل Idempotency في المعاملة نفسها. يعيد replay بالمفتاح
والجسم نفسيهما النتيجة نفسها بلا Audit ثانٍ، والجسم المختلف
`IDEMPOTENCY_MISMATCH`.

### 11. الأحداث والـOutbox

لا تنشئ الشريحة الأولى حدثًا؛ كل المستهلكين يحتاجون الحساب قبل commit ويقرؤونه عبر
Port متزامن، ولا يوجد cache أو مستهلك لاحق مقبول. `AuditLog` ليس Outbox.

إذا ظهر مستهلك حقيقي لاحقًا، يعتمد العقد `AccountingDefaultMappingChanged` بصيغة
past tense و`schemaVersion`، ويحمل `eventId/companyId/key/version/occurredAt` فقط دون
اسم حساب أو Prisma record. يكتب Outbox في معاملة mapping نفسها، ويكون المستهلك
idempotent. لا يضاف الحدث لمجرد احتمال إرسال تنبيه.

### 12. HTTP وRBAC وواجهة الإعدادات

العقد المستهدف:

- `GET /api/v1/accounting/default-mappings` بصلاحية
  `accounting_default_mappings.view`.
- `PUT /api/v1/accounting/default-mappings/{mappingKey}` بصلاحية
  `accounting_default_mappings.manage` وCSRF و`Idempotency-Key`.

يحمل PUT `accountId` و`expectedVersion` و`reason` اختياريًا. تكون النسخة `null`
للإنشاء فقط ورقمًا للاستبدال. إذا حضر السبب يطبقه الحارس المولد مع `x-trim` وحدود
10..500 محرف؛ الفراغ بعد trim غير صالح. تدخل القيمة المنقحة أو `null` عند غيابها في
بصمة Idempotency وتكتب في Audit فقط؛ لا يعيدها DTO القائمة. كل JSON تحت `/api/v1` يحمل
`Cache-Control: no-store`. تبقى BIGINT نصًا، ويولد حارس الجسم من OpenAPI.

تندرج الصلاحيتان تحت موديول `CORE_ACCOUNTING`. لا يفترض العقد implication غير
موجود: GET يحتاج `accounting_default_mappings.view`، وPUT يحتاج
`accounting_default_mappings.manage`، ومنتقي الحساب في الواجهة يحتاج `accounts.view`
أيضًا. تضيف Migration/seed تعريفات الصلاحيات وتمنح Role مدير النظام كل صف مطلوب
صراحة؛ الأدوار المخصصة لا تتوسع تلقائيًا. لا تمنح `settings.manage` أو
`accounts.update` أيًا منها.

تضاف البادئة `accounting_default_mappings.` إلى خريطة الاستحقاق في API
`company-capability-service` وإلى نظيرتها في Web `module-entitlements` على
`CORE_ACCOUNTING`، مع fixtures واختبارات parity في الجانبين. لا يكفي وجود permission
إذا لم تكن قدرة الشركة مستحقة.

توجد الصفحة تحت «الإعدادات > الحسابات الافتراضية»، لا داخل العملاء أو الموردين أو
شاشة البيع اليومية. يعرض كل صف الغرض والحساب والحالة والوحدات المستهلكة وأثر
التغيير «على العمليات الجديدة فقط». لا يعرض زر حذف.

الرابط المحلي المعتمد:

```text
#settings?section=accounting-default-mappings&focus=RETAINED_EARNINGS
```

يوسع parser قائمته البيضاء بـ`section` و`focus` من Enum فقط؛ لا يقبل URL أو
`companyId` أو Account ID. يفحص التنقل الاستحقاق والصلاحية قبل تركيب الصفحة، ولا
يكشف الرابط وجود حساب في شركة أخرى. مستخدم بلا صلاحية يعود لمسار مسموح ولا يرسل
طلب mapping.

تصبح سياسة Settings واعية بالأقسام بدل `allOf` موحد للصفحة: ظهور مدخل الإعدادات
يستخدم `anyOf` لصلاحيات الأقسام الفعلية، ثم يحرس كل قسم وطلب بصلاحيته. يستطيع صاحب
`mapping.view` وحدها فتح الرابط المباشر ورؤية هذا القسم، لكنه لا يركب ولا يطلب
Company/Currencies/Compliance. يكون القسم الافتراضي أول قسم مصرح، لا Company
بالضرورة. لا يظهر زر الاستبدال إلا مع `manage`، ولا يظهر account picker إلا مع
`accounts.view`؛ وفقد صلاحية الرابط يعيد لأول قسم مسموح أو Home بلا request محظور.

### 13. النشر والرجوع

ينفذ الانتقال توسعيًا:

1. إضافة الجدول والقاموس والصلاحيات و`Account.version`، وتشغيل backfill/إكمال يدوي
   حتى ينجح شرط 13/13 لكل شركة في الدفعة. GET قبل ذلك preview لا readiness حاكمة.
2. تفعيل `READ_ONLY_AUTHORITATIVE` للـreadiness بعد البوابة، ثم وضع
   `DIAGNOSTIC_SHADOW`: يقارن الصف بالبحث القديم من دون أن يعيد المرشح لأي أمر.
3. نقل المستهلكين واحدًا واحدًا إلى `resolveForCommand` الذي يقبل صفًا ونسخة فقط؛
   الشركة غير المجتازة تبقى كاملة على التطبيق القديم ولا تدخل مسارًا مختلطًا.
4. بعد نجاح المقارنة والتحويل، إزالة lookup
   `SMALL_BUSINESS_GENERAL/sourceTemplateKey/3300` من Runtime، وإبقاء دلالة القالب في
   Migration/template فقط.

الرجوع موحد عند حد الإصدار/الدفعة: يعاد المستهلك كاملًا إلى التطبيق القديم، لا إلى
lookup بديل داخل resolver المركزي، وتبقى rows وversions وAudit من دون حذف أو إعادة
كتابة. تجمد mapping mutations أثناء الرجوع، ويسجل تقرير الفرق، ثم تعاد completeness
وdiagnostic gates قبل محاولة forward جديدة. لا يكون «الصف إن وجد وإلا القديم»
مرشح rollback مقبولًا.

لا يسقط `rollback.sql` جدول mapping في هذا المسار؛ الرجوع تطبيقي ويحفظ الصفوف حتى
يستخدمها forward retry. لا يحذف Audit ولا يعيد كتابة source template tags أو حقائق
الأطراف.
يبقى عمود `Account.version` بعد cutover لأن إسقاطه يعيد فتح lost updates؛ لا يرجع
إصدارًا لا يرسل `expectedVersion` إلا في rollback مخطط يوقف كتابات Account ويستبدل
الحماية بقفل متشائم مكافئ خلال كامل النافذة.

## البدائل المرفوضة

### إبقاء البحث من القالب في كل خدمة

مرفوض لأنه يكرر قواعد الأهلية، ويربط Runtime بالقالب الأولي، ولا يوفر إدارة واضحة
أو CAS أو readiness موحدًا.

### نقل كل `accountId` إلى جدول مركزي

مرفوض لأن حساب الطرف والصنف والضريبة والبنك وبند المستند حقائق مملوكة لسياقاتها،
ولأن التغيير الرجعي سيكسر اللقطات والتدقيق.

### تخزين المفاتيح كنص قابل للتوسع بلا Migration

مرفوض لأن الخطأ الإملائي يصبح إعدادًا ماليًا صالحًا ظاهريًا. التوسع المقصود يحتاج
تحديث Enum والقاموس وOpenAPI والاختبارات في تغيير واحد.

### الاعتماد على رقم الحساب

مرفوض لأن الرمز دلالي قابل لاختلاف دليل المنشأة. يبقى `3300` أداة backfill legacy
ضيقة، ولا يعبر عقد Runtime.

### Eventual propagation عبر حدث

مرفوض لحل الحساب الحاكم؛ يحتاج المستهلك الحساب الصحيح قبل الترحيل في المعاملة.
يجوز الحدث فقط لأثر لاحق غير حاكم.

### موديول ERP أو rules engine خارجي

لم يعتمد. الحالة Aggregate إعداد صغير شديد الارتباط بـAccount eligibility وRBAC
ومعاملات Ledger. إدخال موديول عام سيكرر دليل الحسابات أو يكشف مخططًا خارجيًا بين
السياقات، ويزيد مخاطر الرخصة والترقية دون قيمة مثبتة. يعاد تقييم Adapter خارجي فقط
إذا ظهر تكامل محاسبي مستقل بعقد واسترداد واضحين.

## النتائج

### إيجابية

- مصدر واحد واضح للحسابات التشغيلية الافتراضية.
- إزالة الاعتماد الدائم على قالب أو رقم حساب في الأوامر المالية.
- بقاء حقائق الأطراف والأصناف والمستندات مستقرة تاريخيًا.
- readiness وأخطاء علاجية موحدة، مع عزل وCAS وتدقيق.
- إضافة قالب جديد لا تتطلب تعديل كل مستهلك.

### تكاليف ومخاطر

- Migration وbackfill محروسان، وفترة dual-read/shadow تشخيصية لا حاكمة.
- ضرورة تسلسل تغييرات Schema/OpenAPI مع Company Profile مؤقتًا.
- ضرورة تحديث Account lifecycle كي لا يصبح mapping صالح ظاهريًا إلى حساب معطل.
- تتطلب كل دفعة completeness وdiagnostic gate، ورجوعًا كامل المسار بلا مزج مصدرين.

## أثر الباركود وقنوات الهاتف

لا يغير القرار هوية الصنف أو الباركود أو parser أو lookup أو الطباعة. عند ملء
`SALES_REVENUE_DEFAULT` لملف بيع صنف جديد يجب أن يبقى resolve الباركود المملوك
لـInventory كما هو، ثم يحفظ Sales الحساب على الملف؛ لا يحمل الباركود مفتاح mapping
ولا يتجاوز RBAC أو تأكيد المستخدم. تختبر رحلة POS/الهاتف مع ملف موجود وآخر جديد كي
لا يصبح default بديلًا عن تحقق الصنف.

## حالة التطبيق

هذه المهمة توثيقية فقط. لم يضف جدول أو Enum أو API أو صلاحية أو واجهة، ولم يتغير
سلوك Runtime أو القوالب أو الإقفال. خطة الشرائح وبوابات التنفيذ في
[خطة مركز تعيين الحسابات](CENTRAL_ACCOUNTING_MAPPINGS_SLICE_AR.md).
