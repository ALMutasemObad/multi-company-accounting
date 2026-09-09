---
title: "خطة شرائح مركز تعيين الحسابات الافتراضية"
status: "planned; documentation only"
version: "1.3"
date: "2026-09-09"
related:
  - "ADR-023-central-accounting-mappings.md"
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "OPENAPI_EXECUTABLE_CONTRACTS_AR.md"
  - "FINANCIAL_CLOSE_WORKFLOW_AR.md"
---

# خطة شريحة مركز تعيين الحسابات التشغيلية الافتراضية

## 1. النتيجة المطلوبة

إنشاء مكان واحد تحت إعدادات Core Accounting يحدد حسابات الشركة الافتراضية التي
تحتاجها الأوامر التشغيلية، مع إبقاء الحسابات الخاصة بالطرف والصنف والضريبة والبنك
ولقطات المستند عند مالكيها. تنتهي الخطة بإزالة بحث Inventory وFX وFinancial Close
عن `SMALL_BUSINESS_GENERAL` و`sourceTemplateKey` والرمز `3300` وقت التشغيل.

هذه الوثيقة خطة تنفيذ وليست ادعاء تنفيذ. لا تنشئ المهمة الحالية Schema أو API أو
واجهة أو Permission.

## 2. Baseline يجب تثبيته قبل أي تعديل

يشغل منفذ الشريحة تقرير جرد آليًا يفشل إذا تغيرت الحقائق التالية من دون تحديث ADR:

| الموضع | Baseline في `main` | قرار النقل |
|---|---|---|
| `Customer.receivableAccountId` | مطلوب ومحفوظ على العميل | يبقى؛ default للإنشاء الجديد فقط |
| `Supplier.payableAccountId` | مطلوب ومحفوظ على المورد | يبقى؛ default للإنشاء الجديد فقط |
| `SalesItemSellingProfile.revenueAccountId` | مطلوب لكل ملف بيع | يبقى؛ يملأ عند الإنشاء فقط |
| `SalesInvoiceLine.revenueAccountId` | محفوظ على البند | immutable snapshot بعد الترحيل |
| `PurchaseInvoiceLine.debitAccountId` | محفوظ على البند، ASSET أو EXPENSE | يبقى override صريحًا |
| `TaxRate.outputTaxAccountId/inputTaxAccountId` | يملكهما Tax | مستبعدان من الجدول المركزي |
| `CashBankAccount.ledgerAccountId` | يملكه Treasury | مستبعد |
| `Receipt/Payment.counterAccountId` | اختيار حركة | مستبعد |
| `CashFlowAccountMapping.accountId` | تصنيف تقرير يملكه Reporting | مستبعد من default mapping؛ يفحص عبر Reporting Usage Port |
| `InventoryMovement.offsetAccountId` | يحفظ بعد حل سياسة الحركة | يبقى لقطة للحركة |
| Inventory runtime | مفاتيح `inventory/purchases/misc-*/retained-earnings` | ينقل عبر Port |
| FX runtime | `realized-fx-gain/loss` مقيدان بالقالب القديم | ينقل عبر Port |
| Annual close runtime | بحث مباشر عن `code=3300` | يزال من consumer في ADM-5C ومن diagnostic في ADM-6 |
| `Account` concurrency | لا يحمل `version`، وأوامر update/deactivate/delete لا تحمل `expectedVersion` | يضاف CAS إلزامي في ADM-1 |
| Account deactivate/delete | التعطيل يفحص الأبناء النشطين فقط؛ الحذف يقرأ علاقات عدة مباشرة من Prisma ولا يشمل Selling Profile أو Inventory history | يستبدل بـ`AccountUsageGuard` مركب عبر Ports المالكين |

أوامر الجرد المقترحة تحفظ في دليل الشريحة ولا تغير الملفات:

```powershell
rg -n "AccountId|accountId" apps/api/prisma/schema.prisma
rg -n "sourceTemplateCode|sourceTemplateKey|code: \"3300\"" apps/api/src
rg -n "receivableAccountId|payableAccountId|revenueAccountId|debitAccountId" apps/api/src packages/contracts/openapi.yaml
```

يجب مقارنة النتيجة أيضًا بفرع Company Profile المقبول عند التكامل، لأن القوالب
الثلاثة لم تكن جزءًا من baseline الأصلي لهذه الوثيقة.

## 3. عقد المجال المستهدف

### 3.1 القاموس

يعرف ملف واحد داخل `apps/api/src/accounts`:

- Enum المفاتيح الثلاثة عشر المعتمدة، صراحة:
  `CUSTOMER_RECEIVABLE_DEFAULT`، `SUPPLIER_PAYABLE_DEFAULT`،
  `SALES_REVENUE_DEFAULT`، `SERVICE_REVENUE_DEFAULT`،
  `PURCHASE_EXPENSE_DEFAULT`، `INVENTORY_ASSET`، `INVENTORY_COGS`،
  `INVENTORY_GAIN`، `INVENTORY_LOSS`، `INVENTORY_OPENING_EQUITY`،
  `REALIZED_FX_GAIN`، `REALIZED_FX_LOSS`، `RETAINED_EARNINGS`.
- `expectedAccountClass`.
- `requiresControlAccount`.
- مرشحي القالب المرتبين.
- القدرة والمستهلك ورسالة العلاج لكل مفتاح.

تستخدم الخدمة والقالب وbackfill والواجهة عقدًا مولدًا من القاموس؛ لا تنسخ arrays
داخل Inventory أو Sales. لا يعبر Prisma enum إلى Context آخر؛ يصدر Port نوع
Application صريحًا مطابقًا بالعقد.

### 3.2 الـAggregate وقواعده

`CompanyAccountingDefaultMapping` Aggregate صغير مفتاحه `(companyId,key)`:

- صف واحد على الأكثر لكل مفتاح وشركة.
- `accountId` من الشركة نفسها عبر composite FK.
- `version` يبدأ من صفر ويزيد مرة واحدة لكل استبدال ناجح.
- `source` يحفظ أصل الصف ولا يسمح للعميل بتعيين `TEMPLATE_SEED` أو
  `LEGACY_BACKFILL`.
- لا delete ولا deactivate للصف.
- account يجب أن يطابق Registry عند الكتابة وعند الاستعمال.
- لا يجري أي تغيير تلقائي على كيان مستهلك عند استبدال الحساب.
- غياب صف مسموح في migration preview فقط؛ لا تصبح الشركة authoritative قبل وجود
  13/13 صفًا صالحًا، ولا يعوضه أي legacy candidate.

`Account` Aggregate مستقل لكنه جزء من نفس شريحة السلامة: يضاف له `version` افتراضي
صفر، وتلزم أوامر update/deactivate/delete بـ`expectedVersion`. كل mutation ناجح
يزيد النسخة مرة واحدة، والحذف يطابقها قبل التنفيذ. لا يترك Router أو تطبيق قالب
مسار تعديل Account يتجاوز القفل وCAS بعد cutover.

### 3.3 أوامر المجال

#### `SetAccountingDefaultMapping`

```text
companyId
key
accountId
expectedVersion: number | null
idempotencyKey
actorUserId
reason?: string
```

- `expectedVersion=null` يعني «أنشئ إذا كان مفقودًا» فقط.
- الرقم يعني «استبدل هذه النسخة فقط».
- إرسال الحساب الحالي بنسخة صحيحة no-op يعيد التمثيل الحالي بلا زيادة نسخة أو Audit؛
  أما replay بالمفتاح نفسه فيعيد النتيجة المحفوظة كذلك.
- لا يقبل `source` أو `accountClass` أو `companyId` من الجسم.
- `reason` اختياري؛ عند حضوره يطبقه الحارس مع `x-trim` وحدود 10..500، ويكون الفراغ
  بعد trim غير صالح. تدخل القيمة المنقحة أو `null` عند الغياب في fingerprint، وتدخل
  Audit عند وجودها، ولا تعاد في DTO القائمة.

#### `SeedMissingAccountingDefaultMappings`

أمر Setup داخلي فقط، داخل معاملة تجهيز الشركة أو تطبيق القالب. ينشئ المفاتيح
المفقودة من `templateCode` والمرشحين الذين أعادهم تطبيق القالب. لا يستبدل صفًا
موجودًا ولا يحتاج HTTP. يحمل الفاعل إن توفر؛ وإلا يضع مصدرًا نظاميًا واضحًا ضمن
تدقيق تجهيز الشركة.

#### `InspectAccountingDefaultMappingConfiguration`

Read Port للواجهة والتقرير فقط. يعيد حالات كل Enum وcompleteness/readiness mode، ولا
يعيد account reference لأي consumer ولا يكتب backfill. قبل 13/13 تكون نتائجه preview
غير حاكمة.

#### `ResolveAccountingDefaultMappingsForCommand`

Command Port مقفل يستخدمه كل أمر سيحفظ accountId أو يرحل به، بما في ذلك إنشاء
Customer وSupplier و`SalesItemSellingProfile`. يقرأ mapping تمهيديًا، ثم يقفل
Accounts تصاعديًا فـmappings معجمية ويعيد قراءة accountId/version والأهلية. يعيد
`ACCOUNTING_DEFAULT_MAPPING_CHANGED` عند التغير؛ لا يحفظ مرجعًا قديمًا ولا يعيد
المحاولة الأعمالية بصمت. override الصريح يقفل Account ويتحقق منه من دون mapping.
إذا غاب صف أو نسخة أو بطلت الأهلية يعيد
`ACCOUNTING_DEFAULT_MAPPING_REQUIRED` مع status/remediation؛ لا يستدعي Diagnostic
Port ولا يقبل نتيجة قالب.

## 4. OpenAPI وHTTP

### 4.1 القراءة

```http
GET /api/v1/accounting/default-mappings
```

Query اختياري: `capability` و`status` و`key` بقيم Enum فقط. يعيد كل مفاتيح Registry
حتى إذا لم يوجد صف، كي تستطيع الواجهة إظهار النقص:

```json
{
  "data": [
    {
      "key": "RETAINED_EARNINGS",
      "category": "FINANCIAL_CLOSE",
      "status": "CONFIGURED",
      "requiredAccountClass": "EQUITY",
      "requiresControlAccount": false,
      "account": {
        "id": "42",
        "code": "3300",
        "nameAr": "الأرباح المبقاة",
        "nameEn": "Retained earnings"
      },
      "version": 1,
      "source": "MANUAL",
      "consumers": ["ANNUAL_CLOSE"]
    }
  ],
  "configurationCompleteness": {
    "configuredKeys": 13,
    "requiredKeys": 13,
    "status": "COMPLETE"
  },
  "readinessMode": "READ_ONLY_AUTHORITATIVE",
  "readiness": {
    "annualClose": "READY",
    "inventory": "READY",
    "realizedFx": "READY"
  }
}
```

BIGINT نص. لا يعيد أسماء/معرفات من شركة أخرى، ولا يعيد تفاصيل Audit في القائمة.
تستخدم الاستجابة `no-store`.

قبل 13/13 يعيد endpoint القائمة نفسها لأغراض الإصلاح مع
`readinessMode=PREVIEW_ONLY` و`readiness=null`; لا يحسب مرشح legacy عنصرًا configured.
بعد البوابة فقط تصبح readiness حاكمة. `LegacyMappingDiagnosticPort` إن كان مفعّلًا
يعرض نتيجة مقارنة منفصلة للمشغل المخول، ولا يغير `status` أو readiness.
اسم `READ_ONLY_AUTHORITATIVE` يصف مصدر **قراءة readiness** فقط؛ لا يلغي PUT الإداري
المصرح، لكنه لا يسمح لأي consumer قبل اجتياز ADM-3 كذلك.

### 4.2 الكتابة

```http
PUT /api/v1/accounting/default-mappings/{mappingKey}
Idempotency-Key: ...
X-CSRF-Token: ...

{
  "accountId": "42",
  "expectedVersion": 0,
  "reason": "توحيد حساب الإقفال المعتمد"
}
```

الحالات:

| الحالة | HTTP/code |
|---|---|
| نجاح | `200` وتمثيل الصف الجديد |
| key غير معروف | `400 INVALID_ACCOUNTING_DEFAULT_MAPPING_KEY` |
| حساب غير موجود أو من شركة أخرى | `404 ACCOUNT_NOT_FOUND` غير كاشف |
| الحساب لا يطابق الأهلية | `409 ACCOUNT_NOT_ELIGIBLE_FOR_DEFAULT_MAPPING` |
| النسخة قديمة أو null مع صف موجود | `409 VERSION_CONFLICT` |
| تغير mapping أثناء أمر مستهلك | `409 ACCOUNTING_DEFAULT_MAPPING_CHANGED` |
| مفتاح Idempotency بجسم مختلف | `409 IDEMPOTENCY_MISMATCH` |
| الأمر ما زال قيد التنفيذ | `409 IDEMPOTENCY_IN_PROGRESS` |
| استنفاد retry | `503 CONCURRENCY_RETRY_EXHAUSTED` |
| انتهاء deadline | `504 REQUEST_DEADLINE_EXCEEDED` |

يعلن OpenAPI `x-permission` و`additionalProperties:false`، ويولد حارس الجسم. لا
ينشئ Router مخطط Zod موازيًا. تختبر الاستجابة الفعلية بالحارس المولد.
`reason` اختياري مع `x-trim/minLength:10/maxLength:500`، والفراغ غير صالح. يستخدم
command القيمة المنقحة نفسها في HTTP fingerprint وAudit.

### 4.3 عقد CAS لدورة Account

تضيف استجابات list/get/create/update/deactivate للحساب `version`. يصبح
`expectedVersion` مطلوبًا في `PATCH /accounts/{id}` وجسمي deactivate/delete، وتعيد
النسخة القديمة `409 VERSION_CONFLICT`. يقفل التطبيق Account في نطاق الشركة، يعيد
القراءة، ثم ينفذ conditional mutation ويزيد النسخة. حذف الحساب يطابق النسخة ولا
يزيدها لأنه يزيل الصف بعد نجاح الحارس.

إعادة parenting التي تغير مستويات descendants تقفل كل Accounts المتأثرة بترتيب id
وتزيد نسخة كل صف تغير فعليًا؛ expectedVersion للجذر من العميل، ونسخ descendants
يلتقطها الخادم ويعيد التحقق منها تحت القفل. كما أن تطبيق القالب إذا ربط tags بحساب
قائم يقفله ويزيد نسخته، ولا يكتب حقول Account خارج هذا العقد. تحدث OpenAPI/الحارس
المولد وWeb في cutover واحد.

### 4.4 أخطاء المستهلكين

إذا احتاج أمر مالي mapping غير صالح يعيد Problem خاصًا بالقدرة، مثل:

```json
{
  "code": "ACCOUNTING_DEFAULT_MAPPING_REQUIRED",
  "mappingKeys": ["INVENTORY_ASSET", "INVENTORY_COGS"],
  "remediation": {
    "view": "settings",
    "section": "accounting-default-mappings",
    "focus": "INVENTORY_ASSET"
  }
}
```

لا يحمل Problem حسابًا مرشحًا أو سبب وجود صف في شركة أخرى. يحول العميل remediation
المقيد إلى hash محلي؛ لا يتبع URL من الخادم.

## 5. RBAC والاستحقاق

تضاف الصلاحيات:

| الصلاحية | الغرض |
|---|---|
| `accounting_default_mappings.view` | قراءة القائمة وreadiness والحساب المختار |
| `accounting_default_mappings.manage` | استبدال mapping |

- لا يفترض أي permission implication غير منفذ. GET يفحص `view`، وPUT يفحص `manage`،
  وaccount picker يفحص `accounts.view` مستقلًا.
- تضيف Migration/`reference-seed-service` تعريف الصلاحيتين، ويمنح seed Role مدير
  النظام صفوف `view/manage/accounts.view` صراحة. الأدوار المخصصة لا توسع تلقائيًا.
- لا تمنح `settings.manage` ولا `accounts.update` صلاحية mapping، ولا تمنح `manage`
  العرض أو اختيار الحساب ضمنيًا؛ إن احتاج الدور الثلاثة تمنح له الثلاثة صراحة.
- تضاف `accounting_default_mappings.` إلى
  `apps/api/src/platform-subscriptions/company-capability-service.ts` وإلى
  `apps/web/src/module-entitlements.ts` تحت `CORE_ACCOUNTING`، وتضاف fixtures واختبارات
  parity للبادئة في API/Web. لا تكفي RBAC إذا غاب استحقاق الموديول.
- مستهلك داخلي لا يفحص صلاحية المستخدم الخاصة بالإعدادات؛ يفحص صلاحية أمره ثم
  يستهلك Port الموثوق. لا يصبح غياب `mapping.view` مانعًا للفاتورة المصرح بها.

## 6. واجهة الإعدادات والروابط العميقة

### 6.1 موضع الواجهة

قسم `accounting-default-mappings` داخل `CompanySettingsPage` أو مساحة إعدادات
محاسبية مستقلة، وليس بطاقة في شاشة العميل/المورد/الفاتورة/POS. تظهر الرحلات اليومية
default المطبق أو زر «اختيار مختلف» فقط عند صلاحية العقد؛ لا تعرض لوحة الإدارة.

يستبدل Web سياسة `settings` الحالية ذات `allOf` العام بسياسة section-aware قابلة
للتنفيذ:

- مدخل Settings مسموح إذا تحقق `anyOf` من سياسات الأقسام المعروفة، ومنها
  `accounting_default_mappings.view` مع استحقاق `CORE_ACCOUNTING`.
- لكل section سياسة مستقلة؛ قسم mapping لا يركب مكونات Company/Currencies/Compliance
  ولا يرسل طلباتها ما لم توجد صلاحياتها الخاصة.
- يبدأ Settings من القسم المطلوب المصرح، وإلا أول قسم مصرح؛ لا يفترض Company قسمًا
  افتراضيًا. إن لم يسمح أي قسم يعود Home.
- صاحب `view` فقط يرى الحالة. الاستبدال يحتاج `manage`، وإظهار/طلب account picker
  يحتاج `accounts.view` أيضًا؛ غيابه لا يمنع قراءة mapping الحالية.

مصفوفة الأقسام الأولية:

| section | سياسة التركيب/GET | سياسة الأفعال |
|---|---|---|
| Company/general controls | `allOf(companies.view, settings.manage)` | `settings.manage` مع متطلبات كل route |
| Currencies/rates | `currencies.view` | `currencies.manage/create` حسب العقد |
| Accounting default mappings | `accounting_default_mappings.view` + استحقاق `CORE_ACCOUNTING` | `manage` للتبديل، و`accounts.view` للمنتقي |
| Company profile/compliance | سياسة القسم التي يعتمدها BP صراحة | لا ترث mapping أو settings العام |

تنتقل طلبات `CompanySettingsPage` الحالية إلى loaders مستقلة لكل section؛ يمنع
loader جامع يستدعي `/companies/current` و`/settings` و`/currencies` عند فتح mapping.

قائمة الإعدادات مجمعة إلى أربع مجموعات من دون أحجام خط عشوائية:

- الأطراف والمبيعات.
- المشتريات والخدمات.
- المخزون وفروق العملة.
- الإقفال.

يستخدم التصميم مقاسين أساسيين: عنوان معتدل ونص مريح، والمستويات الثانوية بالوزن
والمسافة. لا خط زخرفي تحت العنوان.

### 6.2 الحالة والتغيير

كل بطاقة تعرض:

- اسم الغرض، لا Enum وحده.
- الحساب ورمزه وفئته.
- `CONFIGURED/UNMAPPED/INVALID` نصًا وأيقونة، لا لونًا فقط. تعرض مقارنة legacy، إن
  كانت نافذة التشخيص مفعلة، كسطر diagnostic منفصل لا كحالة جاهزية.
- الوحدات التي تستخدمه وأثر التغيير «الجديد فقط».
- زر استبدال إن امتلك المستخدم `manage`.

حوار الاستبدال يحمل select قابلًا للبحث من `/accounts` مقيدًا بالفئة، يعرض سبب عدم
أهلية الحساب ولا يخفي Conflict. بعد 409 يحتفظ بالاختيار، يحدث الصف، ويطلب من
المستخدم تأكيد النسخة الجديدة؛ لا يعيد الإرسال بصمت.

لا يوجد زر حذف أو toggle تعطيل. رابط الحساب يفتح دليل الحسابات إذا امتلك المستخدم
`accounts.view`، وإلا يظهر الاسم بلا رابط.

### 6.3 deep links

يوسع `PageRoute` بقسم Settings وقيمة focus من Mapping Enum:

```text
#settings?section=accounting-default-mappings
#settings?section=accounting-default-mappings&focus=REALIZED_FX_GAIN
```

- يقبل `section/focus` مرة واحدة فقط، ويرفض أي query زائد.
- لا يحمل hash شركة أو accountId أو redirect URL.
- `authorizedPageRoute` يفحص module وسياسة القسم `accounting_default_mappings.view`،
  لا سياسة `settings` العامة فقط.
- إذا لم يملك المستخدم الصلاحية لا يركب React section ولا يرسل GET.
- section غير مصرح يعاد إلى أول section مصرح أو Home، ولا يرسل طلبًا لقسم آخر.
- عند focus موجود ينتقل العنوان إليه بعد التحميل بـfocus مرئي و`aria-live` يعلن
  سبب فتحه؛ لا ينقل focus قبل وجود العنصر.

### 6.4 الإتاحة والتجاوب

- labels ورسائل الخطأ مرتبطة بعناصرها، والحوار يحبس focus ويعيده إلى الزر.
- كل status له نص، والأيقونة `aria-hidden` إذا كانت زخرفية.
- ترتيب لوحة المفاتيح منطقي في RTL/LTR.
- العربية والأردية RTL؛ الإنجليزية والهندية LTR.
- 390/768/1440/1920 بلا overflow للصفحة. على الهاتف تتحول الصفوف إلى بطاقات.
- هدف اللمس مناسب، ولا تعتمد الأهلية على JavaScript وحده؛ الخادم يعيد التحقق.
- كل النصوص في ملفات اللغات الأربع، بلا نص ثابت في JSX.

## 7. مراحل التنفيذ

### ADM-0 — بوابة الجرد والتكامل

لا تغير منتجًا. تثبت baseline وتقبل ADR وتحدد تسلسل الملفات المشتركة.

التسلسل المؤقت:

1. قبول نتيجة `company-profile-bp1` أو نقلها إلى فرع تكامل محلي.
2. إعادة بناء مهمة ADM من `origin/main` المحدث أو cherry-pick منسق في integration
   branch يديره المدير.
3. تسلسل أي تعديل على `schema.prisma` وOpenAPI و`default-chart-template.ts` بحيث لا
   تلمسها مهمتان بالتزامن؛ لا يلزم جمع كل الشرائح في مهمة ضخمة.

لا يصبح Company Profile prerequisite دائمًا. إذا لم يصل، يتعرف backfill/diagnostic
على القالب legacy للشركات القديمة، لكن أي consumer منقول يظل معتمدًا على rows فقط؛
ثم يضاف Adapter للقوالب الجديدة في integration follow-up.

بوابة القبول:

- لا file overlap نشط.
- تحديث جرد الاستعمال الفعلي.
- قرار صريح لأي مفتاح جديد أو مستبعد.

### ADM-1 — متطلبات دورة Account

تقسم إلى تغييرات صغيرة قبل جدول mapping:

1. **ADM-1A:** إضافة `Account.version` وتحديث Account OpenAPI/Web/CAS بما فيه
   descendants وتطبيق القالب، ثم اختبارات MariaDB/MySQL.
2. **ADM-1B:** تعريف Usage Ports وإضافة adapters وAccount-lock handshake سياقًا
   واحدًا في كل تغيير، ومنها `ReportingAccountUsageQueryPort` لـ
   `CashFlowAccountMapping`. يبقى enforcement غير مفعل حتى تسجل Composition Root كل
   adapters؛ عند تفعيله يفشل startup/الأمر مغلقًا إن غاب أو فشل Adapter.

بوابة القبول: ترفض update/deactivate/delete النسخة القديمة، ويزيد كل صف Account تغير
نسخته مرة واحدة، ويغطي الحارس Core/Sales/Purchases/Tax/Treasury/Inventory/Reporting
والتاريخ من دون قراءة Core لجداول مالك آخر.

### ADM-2 — Schema وbackfill وبوابة 13/13

تنشئ Enum/table/composite FK وRegistry/Eligibility وRead/Setup/Command Ports، ثم
تعرف الصلاحيات والمنح والبادئات وOpenAPI GET/PUT وSettings section-aware. يسبق فتح
PUT وجود last-known-good mapping-aware rollback artifact مثبت الـdigest ومجتاز بوابة
التوافق في §11؛ يرفع فتح PUT أرضية الرجوع قبل أول طلب. تستخدم الإدارة لإكمال الصفوف
التي لم يستطع backfill الحتمي حسمها. التنسيق مع Company Profile مؤقت للملفات
المشتركة فقط.

قبل البوابة يعمل GET بوضع `MIGRATION_PREVIEW`: يعرض
`CONFIGURED/UNMAPPED/INVALID` ومرشح diagnostic منفصلًا إن وجد، لكنه يعيد
`readinessMode=PREVIEW_ONLY` ولا يعلن جاهزية حاكمة. لا ينقل مستهلكًا ولا يستدعي
`resolveForCommand`، ويبقى التطبيق القديم هو السلطة كاملة.

بوابة الاكتمال لكل شركة/دفعة:

- 13 صفًا ماديًا بالضبط، صف لكل Enum، وكل صف يحمل `mappingVersion`.
- كل الحسابات من الشركة نفسها ومؤهلة، وصفر missing/invalid/ambiguous.
- إعادة Migration/Seed لا تغير `MANUAL` ولا تكرر Permission.
- بعد النجاح فقط يصبح `readinessMode=READ_ONLY_AUTHORITATIVE`؛ فشل أي شرط يبقي
  الشركة خارج التحويل، ولا يمثل مرشح القالب readiness.

### ADM-3 — dual-read تشخيصي فقط

يشغل `LegacyMappingDiagnosticPort` بعد بوابة 13/13. ينفذ التطبيق القديم قراره كالمعتاد
ويقرأ التشخيص الصف المركزي للمقارنة، أو العكس في job/preview منفصل؛ لا يعيد diagnostic
candidate إلى resolver ولا يخزن به حقيقة تشغيلية. تسجل metrics حالات
`MATCH/DIFFERENT/LEGACY_MISSING` وأعدادًا فقط.

بوابة القبول: parity على MariaDB/MySQL لكل مسارات الأطراف وInventory وFX وClose،
صفر أثر كتابة من المقارنة، واختبار يثبت أن حذف/إفساد صف مركزي يعيد config error من
resolver التجريبي ولا يستعمل نتيجة legacy.

### ADM-4 — defaults الجديدة للأطراف والمحتوى التجاري

بعد البوابتين فقط تصبح حقول create للعميل والمورد اختيارية، وتستخدم Customer وSupplier
وSelling Profile والخدمة/الفوترة المهنية وبند المشتريات غير المخزني
`resolveForCommand`. لا تعدل كيانات قائمة. override الصريح يقفل Account ولا يقرأ
mapping، أما غياب الصف أو بطلانه فيعيد `ACCOUNTING_DEFAULT_MAPPING_REQUIRED` حتى لو
أعاد التشخيص مرشحًا.

بوابة القبول تشمل precedence للـoverride، ثبات الكيان السابق، idempotent replay،
وcreate-vs-replace/deactivate لكل مالك بلا أثر جزئي. preview الاستيراد يثبت
accountId/mappingVersion أو يعيد Conflict عند commit.

### ADM-5 — نقل المستهلكين الماليين على صفوف فقط

تنفذ كشرائح مستقلة بعد اكتمال وتشخيص الشركة:

1. **ADM-5A Inventory:** يحل أزواج Asset/COGS/Opening/Gain/Loss من الصفوف، ويحفظ
   `offsetAccountId`; العكس يستخدم الحركة الأصلية.
2. **ADM-5B FX:** يحل gain/loss عند وجود فرق فقط؛ Receipt/Payment reverse يستخدم
   القيد الأصلي.
3. **ADM-5C Close:** يثبت close pack لقطة discriminated مغلقة: آخر فترة في السنة
   تحمل
   `{kind:"ANNUAL",retainedEarnings:{key:"RETAINED_EARNINGS",accountId,mappingVersion}}`،
   وغير السنوية تحمل `{kind:"NON_ANNUAL"}` بلا مرجع retained. يدخل discriminator
   وفروعه في canonical hash وapproval snapshot. يعاد قفل Account ثم mapping والتحقق
   في approve/close للفرع السنوي فقط؛ وأي تغير يعيد `CHECKLIST_CHANGED`. لا يحل أو
   يقفل الفرع غير السنوي هذا المفتاح، فلا يحجبه غيابه أو بطلانه ولا يبطله تغييره.
   يتلقى `createAnnualCloseDocument` الحساب المثبت ولا يبحث عن `3300`. تبقى دورة
   الفترة محكومة بـ[عقد الإقفال المالي](FINANCIAL_CLOSE_WORKFLOW_AR.md).

يمثل OpenAPI الفرعين بـ`oneOf` و`discriminator=kind` مع
`additionalProperties:false` إن عبرت اللقطة HTTP، وتطبق القيمة المحفوظة parser
مغلقًا والعقد TypeScript المولد نفسه؛ لا يقبل persisted JSON فرعًا ملتبسًا أو ناقصًا.

كل `resolveForCommand` في هذه الشرائح يفشل قبل الأثر عند missing/invalid، ولا يستدعي
قالبًا أو رقمًا. تختبر posting/reversal/races على المحركين، ويمنع source guard أي
legacy lookup داخل consumers.

### ADM-6 — إزالة legacy diagnostic lookup

بعد نقل كل الدفعات بنجاح يزال `LegacyMappingDiagnosticPort` والـdual-read flags وكل
بحث Runtime عن `SMALL_BUSINESS_GENERAL/sourceTemplateKey/3300`. يجوز بقاء القيم في
template وMigration/backfill ودليل تاريخي فقط.

بوابة القبول: كل شركة محولة اجتازت 13/13، لا استدعاء diagnostic خلال النافذة، ولا
query قديم داخل مستهلك أو close. ينجح rollback drill بعد فتح PUT إلى artifact
mapping-aware يقرأ mapping rows الباقية؛ لا يختبر أو يقبل تطبيقًا يتجاهلها أو lookup
بديلًا داخل resolver المركزي.

## 8. backfill مفصل

### 8.1 المدخلات

- Accounts لكل شركة مع `sourceTemplateCode/sourceTemplateKey` والفئة والحالة
  و`allowsPosting/childCount/isControlAccount`.
- `initialChartTemplateCode` إن توفر من BP-1، بوصفه hint للـoverlay فقط.
- لا قراءة Customers/Suppliers/Invoices لتحديد default؛ انتشار قيمة لا يثبت قرار
  المنشأة.

### 8.2 الخوارزمية

لكل `(company,key)` بالترتيب المعجمي:

1. إذا وجد mapping اتركه.
2. ابن قائمة candidates الدقيقة وفق ADR.
3. استبعد غير المؤهل.
4. إذا بقي واحد، أدخل `LEGACY_BACKFILL`.
5. إذا بقي صفر، اترك missing.
6. إذا بقي أكثر من واحد في الرتبة نفسها، سجل Conflict في تقرير rollout ولا تدخل.

لا يستخدم `LIMIT 1` بلا ترتيب ودلالة. لا يبحث بالاسم العربي/الإنجليزي. لا يغير
Account tags أو الرموز.

### 8.3 القوالب الثلاثة

- common base keys موسومة `SMALL_BUSINESS_GENERAL` حتى في القوالب الجديدة؛ يجب
  backfill قراءتها كذلك.
- Professional يفضل `professional-services-revenue` لمفتاح الخدمة فقط إذا كان هذا
  هو القالب المختار؛ يبقى `SALES_REVENUE_DEFAULT` على `sales-revenue` حتى لا تخلط
  المبيعات العامة بالخدمات المهنية.
- Retail يفضل `inventory-shrinkage` لـ`INVENTORY_LOSS` في تجهيز شركة جديدة؛ شركة
  قائمة كانت تعمل على `misc-expense` لا تنقل تلقائيًا من دون عرض وموافقة.
- Manufacturing لا يختار `raw-materials/work-in-progress/finished-goods` بدل
  `INVENTORY_ASSET`؛ النظام الحالي لا يملك تصنيف صنف يحكم ذلك.

### 8.4 التقرير

يحفظ دليل rollout المنقح أعدادًا فقط لكل template/key:

- inserted.
- alreadyConfigured.
- missing.
- ambiguous.
- invalid.

لا يسجل اسم الحساب أو بيانات مالية أو Idempotency keys. لا يعتبر نجاح Migration
دليل readiness إذا بقي missing/ambiguous.

## 9. التزامن وCAS

### 9.1 Set mapping

```text
normalize reason -> fingerprint {key,accountId,expectedVersion,reason|null}
-> Idempotency scope (companyId, actorUserId, operation, key)
-> read current mapping for candidate ids
-> lock old/new Account ids ascending
-> lock mapping(company,key)
-> re-read and check expectedVersion
-> validate same company/class/active/posting/leaf/control
-> insert or conditional update
-> append ACCOUNTING_DEFAULT_MAPPING_SET audit
-> complete idempotency
```

تفرد `(companyId,key)` لا يستبدل CAS. `P2002` في create race يعاد كConflict/Replay
حسب Idempotency، ولا يعامل deadlock تلقائيًا.

### 9.2 Account lifecycle

ينفذ Core Accounting `AccountUsageGuard` كمنسق، ولا يكرر قائمة علاقات Prisma داخل
`AccountService`. يستدعي بالترتيب الثابت وفي `tx` نفسها:

| Port/المالك | ما يبلغه للحارس |
|---|---|
| Core Accounting | children، default mappings، `JournalLine` وحقائق الدفتر |
| `SalesAccountUsageQueryPort` | Customer، Selling Profile، `SalesInvoiceLine` الجارية والتاريخية |
| `PurchasesAccountUsageQueryPort` | Supplier و`PurchaseInvoiceLine` الجارية والتاريخية |
| `TaxAccountUsageQueryPort` | input/output account على `TaxRate` |
| `TreasuryAccountUsageQueryPort` | `CashBankAccount` وReceipt/Payment counter snapshots |
| `InventoryAccountUsageQueryPort` | `InventoryMovement.offsetAccountId` والتاريخ |
| `ReportingAccountUsageQueryPort` | `CashFlowAccountMapping` الذي يملكه Reporting |

ترجع المنافذ `category/count/hasImmutableHistory` محدودة ولا تعيد DTO أو معرف مستند.
كل أمر ينشئ مرجع Account، بما فيه overrides وTax/Treasury والمستندات والحركات، يجب أن
يقفل Account نفسه ويتحقق من نشاطه قبل حفظ المرجع. هذا handshake هو ما يمنع phantom
جديدًا بعد فحص الحارس؛ إضافة علاقة Account جديدة مستقبلًا لا تقبل بلا Port واختبار.
Core Accounting لا يستورد Reporting Prisma model؛ غياب/فشل
`ReportingAccountUsageQueryPort` يفشل lifecycle command مغلقًا ويرجع المعاملة كاملة.

```text
Idempotency عند وجوده
-> lock Account and compare expectedVersion
-> lock mappings referencing it ordered by key
-> query owner usage ports in fixed order
-> re-read Account/version and mapping eligibility
-> reject with bounded usage categories/keys, or conditional CAS mutation
-> Audit
```

إذا بدأ mapping create في الوقت نفسه يقفل الحساب أولًا أيضًا؛ إما يرى حسابًا صالحًا
ويكمل قبل التعطيل، أو يرى التعطيل ويرفض. لا يبقى mapping جديد إلى حساب معطل.

أي current أو historical usage يمنع deactivation/delete؛ استبدال mapping وحده ليس
كافيًا. تنقل المراجع الجارية القابلة للتعديل عبر أوامر مالكها، أما snapshot/Journal
history فيبقي الحساب نشطًا ولا يحذف. legacy history الذي يشير إلى حساب معطل يبلغ في
preflight؛ لا يعاد تنشيطه آليًا. يسمح Posting Engine للعكس فقط باستخدام حساب معطل
إذا طابق accountId في المصدر/القيد الأصلي immutable، ولا يسمح له كdefault أو عملية
جديدة. بهذا تبقى قابلية reverse ولا تتحول `isActive` إلى archive غامض.

### 9.3 الاستهلاك داخل الأوامر

لا يحتاج resolver إلى قفل طويل لمجرد شاشة قراءة، لكن كل أمر يحفظ default أو يرحل
به يجب أن يثبت المرجع في نفس المعاملة. يشمل ذلك Customer/Supplier/Selling Profile
create، لا الأوامر المالية وحدها. للحفاظ على ترتيب Account ثم mapping المستخدم في
أوامر الإدارة، يقرأ الأمر `(accountId,version)` قراءة تمهيدية، ثم:

```text
أقفال source الأعلى مثل الفترة والمستند
-> Account ids المحلولة بترتيب تصاعدي
-> mapping keys بترتيب معجمي
-> إعادة قراءة accountId/version والأهلية
-> حفظ accountId في Aggregate المالك أو بناء Posting Plan ثم أقفال Ledger
```

إذا تغير الحساب أو النسخة بين القراءتين يعاد Conflict آمن أو تعاد قراءة الأمر وفق
سياسة العملية؛ لا يستمر بقائمة أقفال ناقصة. لا يقفل أي مسار mapping ثم Account كي
لا يعكس ترتيب أمر التعديل أو Account lifecycle. يوثق الترتيب النهائي في سياسة
التزامن عند التنفيذ ويختبر post-vs-mapping-change. لا يخلط الأمر حسابين من نسختين
مختلفتين.

في close ذي `kind=ANNUAL` تكون القراءة التمهيدية هي لقطة retained المثبتة في
checklist/pack hash. يعاد فحص id/version/eligibility في approve وclose؛ أي فرق يساوي
`CHECKLIST_CHANGED` لا retry أعمالي ولا lookup قديم. أما `kind=NON_ANNUAL` فلا يحمل
المرجع ولا ينفذ هذا القفل أو الفحص؛ تغيير retained لا يغير hash ولا يعيد الموافقة.
وفي override الصريح يقفل Account ويفحصه ولا يقفل mapping لأنه لم يعتمد عليه.

## 10. Audit والرصد والـOutbox

### Audit

`ACCOUNTING_DEFAULT_MAPPING_SET` يحمل فقط:

- key.
- old/new account IDs كنصوص عند السماح وفق سياسة التدقيق.
- old/new version.
- source.
- `reason` المنقح إذا وجد، ولا يسجل النص الخام أو الفراغ.

لا يحمل أسماء حسابات أو مبلغًا أو Payload الطلب. Seed في تجهيز الشركة يدخل ضمن
Audit التجهيز مع قائمة keys لا بيانات الحساب التفصيلية. Migration backfill يوثق
بـprovenance ودليل الإصدار، لا ينتحل مستخدمًا في `AuditLog` الإلزامي الفاعل.

### Metrics

- `accounting_default_mapping_resolution_total{key,status}`.
- `accounting_default_mapping_legacy_diagnostic_total{key,result}`.
- `accounting_default_mapping_conflict_total{key}`.
- `accounting_default_mapping_update_total{key,result}`.
- transaction retry/deadline metrics القائمة.

لا توضع `companyId` كـPrometheus label عالي الكثافة؛ يمكن وضعها في structured log
المقيد. لا account name/id أو payload مالي في metrics.

### Outbox

لا Outbox في ADM-1..6 لعدم وجود مستهلك لاحق. إذا اعتمد event، تضاف Migration وعقد
versioned وhandler duplicate test في شريحة مستقلة؛ لا يستخدم Audit ناقلًا.

## 11. forward migration والـrollback

### Forward

1. ADM-1 تضيف `Account.version` وUsage Ports/handshake، بما فيها Reporting. يجوز قبل
   فتح PUT فقط تثبيت rollback row-unaware بمنطق المستهلك القديم لكنه ADM-1-safe
   ويحافظ على Account CAS/Usage Guard. تبني في الوقت نفسه artifact mapping-aware
   مرشحًا ليصبح last-known-good قبل فتح PUT.
2. ADM-2 تنشئ Enum/table/FK/indexes والصلاحيات وGET/PUT، ثم backfill والإكمال اليدوي؛
   تظل readiness `PREVIEW_ONLY` حتى نجاح 13/13.
3. بعد البوابة تصبح readiness `READ_ONLY_AUTHORITATIVE` وتشغل ADM-3 dual-read
   diagnostic بلا أي أثر في resolve.
4. ADM-4 ثم ADM-5A/B/C تنقل consumers إلى materialized rows فقط.
5. ADM-6 تزيل Legacy Diagnostic Port والـlookups من Runtime.

اختبارات Migration:

- قاعدة فارغة.
- ترقية baseline مع قالب كامل.
- ترقية دليل مخصص بلا tags.
- شركة لكل قالب من الثلاثة.
- حسابات tags مكررة عبر codes تؤدي Conflict لا اختيارًا تخمينيًا.
- حساب `3300` مؤهل وغير مؤهل ومتعدد.
- إعادة seed ومقاطعة migration/إعادتها وفق دعم الأداة.
- صفر/12/13 صفًا وحالة Registry/DB enum drift: لا ينجح completeness إلا 13 Enum rows
  فريدة صالحة بنسخ.
- diagnostic candidate بلا صف لا يحسب configured ولا يفتح readiness.
- rollback قبل فتح PUT فقط يقبل الأثر row-unaware مع بقاء rows؛ فتح PUT ولو بلا
  mutation، أو وجود `MANUAL`، أو رصد `DIFFERENT` يرفضه نهائيًا.
- last-known-good mapping-aware يقرأ الصفوف ونسخها الحالية على المحركين؛ artifact
  مفقود/فاسد/غير متوافق يجعل أوامر consumers المتأثرة fail-closed ويثبت عدم وجود
  legacy query، مع عدم حذف rows/Audit.
- ترقية Accounts قائمة تجعل `version=0`، ثم update/deactivate/delete بنسخة صحيحة
  ونسخة stale على المحركين.
- تقرير الحسابات المعطلة المرتبطة بتاريخ لا يعدلها ولا يحذفها.

### Rollback

- بعد ADM-1 يترك عمود `Account.version`; إذا تعذر تشغيل CAS يوقف Account mutations
  بدل الرجوع إلى كاتب بلا version.
- بعد تفعيل Usage Guard لا يعطل إلى السلوك القديم. فشل Adapter يجعل
  update/deactivate/delete المتأثرة read-only حتى الإصلاح أو Binary يضم الحارس كاملًا.
- تسجل أداة rollout لكل دفعة أرضية monotonic: `PRE_PUT` فقط إذا لم يفتح PUT قط ولا
  يوجد `source=MANUAL` ولم تسجل نتيجة `DIFFERENT`. في هذه المرحلة وحدها يجوز الرجوع
  الكامل إلى Binary row-unaware بمنطق المستهلك القديم، بشرط بقائه ADM-1-safe
  ومتوافقًا مع schema وAccount CAS/Usage Guard.
- قبل فتح PUT تعتمد بوابة التوافق last-known-good mapping-aware مثبتًا بـrelease id
  وsource SHA وartifact digest. تطابق schema/migration range وRegistry version/13
  keys، وتثبت دعم Account CAS/Usage Guard ومصادر الصفوف ومنها `MANUAL`، وقراءة
  `accountId/mappingVersion` من الصفوف فقط، وعقد close discriminated. يجتاز الأثر
  smoke/rollback drill على MariaDB 10.11 وMySQL 8.4؛ لا تقبل `latest` أو أثرًا غير
  قابل للجلب والتحقق.
- يرفع فتح PUT قبل أول request، أو وجود `MANUAL`، أو رصد `DIFFERENT`، الأرضية إلى
  `MAPPING_AWARE_REQUIRED` بلا خفض لاحق. عندها يرجع كل consumer إلى last-known-good
  mapping-aware ويوقف `ACCOUNTING_DEFAULT_MAPPING_WRITES_ENABLED` خلال التبديل؛ لا
  يجوز Binary يتجاهل rows ولا resolver ثم lookup قديم عند missing.
- إذا غاب artifact المثبت أو لم يطابق compatibility gate، لا ينشر القديم: يبقى
  الإصدار الآمن الجاري إن أمكن، وتفشل أوامر consumers المتأثرة مغلقًا بخطأ
  readiness/configuration مع بقاء GET/diagnostic الإداري، ومن دون fallback صامت.
- تبقى كل mapping rows/versions وAudit؛ لا DDL rollback ولا retagging ولا إعادة كتابة
  أطراف أو مستندات. يقرأها الأثر mapping-aware، ويسجل الفرق ويعاد 13/13 ثم diagnostic
  قبل forward retry.
- rollback لكل مستهلك منفصل؛ لا يعطل Sales لأن Inventory فشل إذا كانت حدوده مستقلة،
  لكنه لا يمزج المصدرين داخل أمر واحد.
- لا يسقط `Account.version` بعد cutover ولا يعاد تشغيل Binary لا يرسل
  `expectedVersion`. rollback اضطراري لهذا العقد يوقف كتابات Account أولًا ويحتاج
  قفلًا متشائمًا مكافئًا موثقًا، ولا يغير الحسابات أو التاريخ.

## 12. مصفوفة الاختبار

### Unit

- كل key يقبل الفئة/control الصحيحة ويرفض inactive/non-posting/parent/wrong class.
- candidate order للقوالب الأربعة، بما فيها legacy.
- عدم اختيار raw/WIP/finished تلقائيًا.
- completeness لا تصبح authoritative إلا عند 13/13، ولا يحسب diagnostic مرشحًا.
- بعد البوابة لا يستدعي FX resolver إذا كان الفرق صفرًا، وإن استدعاه مفتاحًا فلا
  يقبل missing row.
- explicit override precedence.
- تطبيع `reason` وحدود 10/500 وتساوي fingerprint للقيمة المنقحة واختلافه عند تغيرها.
- `AccountUsageGuard` يجمع كل Adapter ويعامل أي تاريخ مانعًا للتعطيل/الحذف.
- Composition يفشل بلا Reporting adapter، وخطأ Reporting Port لا يتحول إلى usage
  فارغ ولا يسمح بـAccount mutation.

### API والعقد

- GET missing/configured/invalid والفلاتر.
- GET قبل البوابة `PREVIEW_ONLY/readiness=null` وبعد 13/13
  `READ_ONLY_AUTHORITATIVE`; لا توجد حالة legacy تعوض صفًا مفقودًا في العقد.
- PUT create/update/replay/mismatch/version conflict.
- CSRF و`view/manage` واستحقاق `CORE_ACCOUNTING`.
- Account responses تعرض version، وupdate/deactivate/delete ترفض missing/stale
  `expectedVersion` وتقبل النسخة الحالية فقط.
- role يملك mapping view وحدها يستطيع GET، وmanage وحدها يستطيع PUT فقط وفق المنح
  الصريحة؛ لا اختبار يعتمد implication. منتقي الحساب يحتاج `accounts.view`.
- parity لبادئة `accounting_default_mappings.` بين capability API وWeb/fixtures.
- BIGINT strings وstrict request وroute parity وresponse validator وRedocly.
- cross-company forged key/account يعيد 404/رفضًا غير كاشف.
- `Cache-Control:no-store` للنجاح والخطأ و429.

### Integration

- إنشاء عميل/مورد/ملف جديد بلا default وبـdefault وبـoverride.
- تغيير default لا يغير الكيان السابق.
- Sales/Purchase invoice وPOST/REVERSE تحفظ الحساب التاريخي.
- كل أنواع حركة Inventory وinvoice stock/return/reverse.
- Receipt/Payment FX gain/loss وreverse.
- annual close/readiness وعدم بحث `3300`؛ لقطة `ANNUAL` توجب key/accountId/version
  بلا `null`، وتبديل id أو version يغير hash ويعيد `CHECKLIST_CHANGED` في
  approve/close.
- monthly/non-annual close يحفظ `{kind:"NON_ANNUAL"}` فقط؛ يرفض parser/OpenAPI خلط
  الفرعين أو حقولًا زائدة، ولا يستدعي retained resolver. تغيير/غياب/بطلان retained
  لا يغير hash أو الموافقة ولا يمنع الإقفال غير السنوي، مع بقاء 13/13 بوابة rollout.
- missing row في أي consumer يعيد config/readiness error ولو وجد legacy diagnostic
  candidate؛ لا ينشأ كيان أو قيد.
- Account deactivate/delete/reclassify مقابل mapping update، وكل استعمال من
  Customer/Supplier/SellingProfile/Tax/Treasury/Invoices/Inventory/Reporting/Journal/history.
- `CashFlowAccountMapping` يمنع deactivate/delete حتى يعاد إسناده بأمر Reporting،
  وغياب/رمي `ReportingAccountUsageQueryPort` يفشل الأمر ويرجع Audit/mutation كاملًا.
- إعادة إسناد مرجع جار عبر command مالكه لا تمس snapshot؛ وجود أي snapshot يبقي
  الحساب نشطًا، والعكس legacy يستخدم الحساب المعطل الأصلي فقط.
- فشل Audit/Idempotency يسبب rollback كاملًا.
- لا كتابة مباشرة من سياق مستهلك إلى جدول mapping عبر architecture guard.

### Concurrency على قاعدة فعلية

تشغل المصفوفة على MariaDB 10.11 وMySQL 8.4، لا mocks:

- PUTان للـkey نفسه والنسخة نفسها: نجاح واحد وConflict واحد.
- replay بالمفتاح نفسه: نتيجة واحدة وAudit واحد.
- mapping create مقابل Account deactivate.
- mapping replace مقابل Account reclassify.
- Customer/Supplier/Selling Profile create بلا override مقابل mapping replace، ومقابل
  Account deactivate: نتيجة كاملة أو Conflict بلا كيان جزئي.
- create بoverride وTax/Treasury/reference snapshot مقابل Account deactivate يثبت
  handshake قفل Account ولا يسمح بمرجع جديد إلى حساب معطل.
- Reporting cash-flow mapping create/replace مقابل Account deactivate يتسلسل عبر
  Account lock وUsage Port بلا استعمال مفقود أو deadlock.
- inventory post مقابل تبديل `INVENTORY_ASSET` أو `INVENTORY_COGS`.
- FX settlement مقابل تبديل gain/loss.
- annual close مقابل تبديل retained earnings.
- شركتان تغيران المفتاح نفسه بلا قفل متبادل.
- deadlock مصطنع يعاد ضمن deadline أو يعيد exhausted بلا أثر جزئي.

### Migration والمحركات

- empty/upgrade/rollback guard لكل محرك.
- composite FK والتفرد وEnum parity.
- `Account.version` backfill=0 وCAS/rollback guard.
- explain لفهرس `(companyId,key)` ومرجع الحساب.
- نتائج backfill متطابقة على المحركين.

### الواجهة واللغات

- ar/en/hi/ur، واتجاه RTL/LTR.
- 390/768/1440/1920.
- لوحة مفاتيح وقارئ شاشة وfocus deep-link والحوار.
- مستخدم mapping view-only، وmanage-only، وaccounts.view-only، والتركيبات الصريحة
  بلا أي implication مفترض.
- mapping-only يفتح Settings إلى قسمه ولا يركب/يطلب Company/Currencies/Compliance؛
  يعود إلى أول section مصرح أو Home عند رابط غير مسموح.
- لا تركيب/طلب للصفحة غير المصرح بها.
- رسالة «العمليات الجديدة فقط» ظاهرة ولا توحي بتحديث التاريخ.

### Barcode/POS regression

- scan لصنف يملك Selling Profile لا يتغير بتبديل default.
- إنشاء ملف جديد من رحلة مسموحة يأخذ default بعد resolve الصنف.
- لا barcode يحمل mapping key أو يفتح deep link أو يتجاوز تأكيد المستخدم.

## 13. حواجز معمارية دائمة

تضاف اختبارات source scanning تمنع:

- كتابة `companyAccountingDefaultMapping` خارج `apps/api/src/accounts` وMigration.
- بحث Inventory أو FX عن `sourceTemplateCode/sourceTemplateKey` بعد ADM-6.
- بحث Financial Close عن `code: "3300"`.
- استدعاء `LegacyMappingDiagnosticPort` من resolver/consumer/close أو إدخال نتيجته
  في readiness/hash.
- استيراد Prisma mapping model في Sales/Purchases/Inventory/Projects.
- relation-count مباشر من `AccountService` إلى Customer/Supplier/Tax/Treasury/
  Inventory/Reporting؛ يجب المرور عبر AccountUsage Ports.
- استيراد `CashFlowAccountMapping` أو Prisma Reporting model داخل Core Accounting.
- حفظ أي Account FK جديد من دون Account lock/eligibility handshake وUsage Port.
- مفتاح Mapping نصي غير موجود في Registry/OpenAPI.
- route كتابة بلا permission/CSRF/Idempotency.
- تعديل يدوي للملف المولد.

## 14. خارج النطاق

- إعادة حساب أو تحديث العملاء والموردين والأصناف والفواتير والحركات القائمة.
- نقل حسابات TaxRate أو CashBankAccount أو counter accounts إلى المركز.
- حسابات مخزون حسب صنف/مستودع أو raw/WIP/finished قبل نموذج Inventory مستقل.
- Payroll وFixed Assets وEmployee Expenses posting.
- تصميم دليل حسابات جديد أو تغيير أرقام الحسابات.
- Event Broker أو Microservice أو cache موزع.
- نشر أو push أو PR ضمن مهمة التوثيق.

## 15. تعريف التسليم لكل ADM

يوثق تقرير الشريحة:

- SHA والملفات المنفذة.
- ما اختبر فعليًا على MariaDB وMySQL وما لم يختبر.
- أعداد backfill/completeness ونتائج legacy diagnostic المنقحة.
- نتيجة OpenAPI/Typecheck/Build/Unit/Integration/Visual/A11y.
- وضع feature flags والـrollback drill.
- المتبقي بمالك وخطة إزالة، بلا نسبة تقدم تقديرية.

نجاح محلي أو Staging لا يعني دمجًا أو نشرًا. لا push أو PR أو merge أو deploy دون
إذن المستخدم المناسب، ولا ينتقل إذن جولة سابقة إلى هذه الشرائح.
