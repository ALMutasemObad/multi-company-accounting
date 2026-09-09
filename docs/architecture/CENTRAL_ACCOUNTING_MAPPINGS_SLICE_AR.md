---
title: "خطة شرائح مركز تعيين الحسابات الافتراضية"
status: "planned; documentation only"
version: "1.0"
date: "2026-09-09"
related:
  - "ADR-023-central-accounting-mappings.md"
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "OPENAPI_EXECUTABLE_CONTRACTS_AR.md"
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
| `InventoryMovement.offsetAccountId` | يحفظ بعد حل سياسة الحركة | يبقى لقطة للحركة |
| Inventory runtime | مفاتيح `inventory/purchases/misc-*/retained-earnings` | ينقل عبر Port |
| FX runtime | `realized-fx-gain/loss` مقيدان بالقالب القديم | ينقل عبر Port |
| Annual close runtime | بحث مباشر عن `code=3300` | يزال في ADM-4 |

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

- Enum المفاتيح الثلاثة عشر المعتمدة في ADR-023.
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

### 3.3 أوامر المجال

#### `SetAccountingDefaultMapping`

```text
companyId
key
accountId
expectedVersion: number | null
idempotencyKey
actorUserId
```

- `expectedVersion=null` يعني «أنشئ إذا كان مفقودًا» فقط.
- الرقم يعني «استبدل هذه النسخة فقط».
- إرسال الحساب الحالي بنسخة صحيحة no-op يعيد التمثيل الحالي بلا زيادة نسخة أو Audit؛
  أما replay بالمفتاح نفسه فيعيد النتيجة المحفوظة كذلك.
- لا يقبل `source` أو `accountClass` أو `companyId` من الجسم.

#### `SeedMissingAccountingDefaultMappings`

أمر Setup داخلي فقط، داخل معاملة تجهيز الشركة أو تطبيق القالب. ينشئ المفاتيح
المفقودة من `templateCode` والمرشحين الذين أعادهم تطبيق القالب. لا يستبدل صفًا
موجودًا ولا يحتاج HTTP. يحمل الفاعل إن توفر؛ وإلا يضع مصدرًا نظاميًا واضحًا ضمن
تدقيق تجهيز الشركة.

#### `ResolveAccountingDefaultMappings`

Query داخل المعاملة. يأخذ مجموعة Enum، يرتبها، ويعيد Map كاملة أو خطأ يذكر المفاتيح
المفقودة/غير الصالحة. لا يكتب backfill ضمن أمر مالي، حتى لا يخلط migration بPosting.

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
  "readiness": {
    "annualClose": "READY",
    "inventory": "ACTION_REQUIRED",
    "realizedFx": "READY"
  }
}
```

BIGINT نص. لا يعيد أسماء/معرفات من شركة أخرى، ولا يعيد تفاصيل Audit في القائمة.
تستخدم الاستجابة `no-store`.

### 4.2 الكتابة

```http
PUT /api/v1/accounting/default-mappings/{mappingKey}
Idempotency-Key: ...
X-CSRF-Token: ...

{
  "accountId": "42",
  "expectedVersion": 0
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
| مفتاح Idempotency بجسم مختلف | `409 IDEMPOTENCY_MISMATCH` |
| الأمر ما زال قيد التنفيذ | `409 IDEMPOTENCY_IN_PROGRESS` |
| استنفاد retry | `503 CONCURRENCY_RETRY_EXHAUSTED` |
| انتهاء deadline | `504 REQUEST_DEADLINE_EXCEEDED` |

يعلن OpenAPI `x-permission` و`additionalProperties:false`، ويولد حارس الجسم. لا
ينشئ Router مخطط Zod موازيًا. تختبر الاستجابة الفعلية بالحارس المولد.

### 4.3 أخطاء المستهلكين

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

- `manage -> view` و`view -> accounts.view` في permission implications.
- كلاهما ضمن `CORE_ACCOUNTING` في company capability service.
- لا implies من `settings.manage` ولا من `accounts.update` إلى `manage`.
- يمكن منح مدير الشركة الصلاحيتين في Migration صريحة؛ الأدوار المخصصة لا توسع
  تلقائيًا.
- مستهلك داخلي لا يفحص صلاحية المستخدم الخاصة بالإعدادات؛ يفحص صلاحية أمره ثم
  يستهلك Port الموثوق. لا يصبح غياب `mapping.view` مانعًا للفاتورة المصرح بها.

## 6. واجهة الإعدادات والروابط العميقة

### 6.1 موضع الواجهة

قسم `accounting-default-mappings` داخل `CompanySettingsPage` أو مساحة إعدادات
محاسبية مستقلة، وليس بطاقة في شاشة العميل/المورد/الفاتورة/POS. تظهر الرحلات اليومية
default المطبق أو زر «اختيار مختلف» فقط عند صلاحية العقد؛ لا تعرض لوحة الإدارة.

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
- `CONFIGURED/LEGACY_FALLBACK/UNMAPPED/INVALID` نصًا وأيقونة، لا لونًا فقط.
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
- `authorizedPageRoute` يفحص module و`accounting_default_mappings.view`.
- إذا لم يملك المستخدم الصلاحية لا يركب React section ولا يرسل GET.
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
3. تعديل `schema.prisma` وOpenAPI و`default-chart-template.ts` في مهمة واحدة فقط.

لا يصبح Company Profile prerequisite دائمًا. إذا لم يصل، يدعم ADM الشركات القديمة
والقالب legacy أولًا، ثم يضيف Adapter للقوالب الجديدة في integration follow-up.

بوابة القبول:

- لا file overlap نشط.
- تحديث جرد الاستعمال الفعلي.
- قرار صريح لأي مفتاح جديد أو مستبعد.

### ADM-1 — الأساس، backfill وread-only settings

النطاق التنفيذي المقترح:

- Prisma enum/table/composite FK والـMigration والـrollback guard.
- Registry وEligibility policy وQuery/Setup Ports.
- الصلاحيات وOpenAPI GET وقراءة settings فقط.
- backfill حتمي وreadiness.
- Account lifecycle guard لكل mapping.

لا ينقل أي مستهلك ولا يفتح PUT في هذه الشريحة. يعمل النظام القديم كما كان، ويحسب
Shadow الفرق بين النتيجتين.

بوابة القبول:

- كل مفتاح يملك class/control rule واختبارًا سلبيًا.
- mapping من شركة A إلى Account شركة B مرفوض في الخدمة وFK.
- إعادة Migration/Seed لا تغير صفًا يدويًا ولا تكرر Permission.
- Account deactivate/delete/type/allowsPosting/control changes مرفوضة إذا أبطلته.
- GET يعرض missing keys ولا يحتاج CompanyProfile.
- Shadow لا يغير Posting أو source records.

### ADM-2 — defaults الجديدة للأطراف والمحتوى التجاري

ينقل فقط defaults غير الحاكمة للتاريخ:

- `CustomerInput.receivableAccountId` و`SupplierInput.payableAccountId` يصبحان
  اختياريين في create فقط؛ update يبقى override صريحًا.
- عند غياب الحقل يحل Sales/Purchases mapping داخل معاملة الإنشاء ويحفظ accountId.
- الاستيراد يظل يقبل `receivable_account_code/payable_account_code` كoverride؛ عند
  غياب العمود يستخدم default بعد preview واضح.
- ملف بيع الصنف والخدمة/الفوترة المهنية وبند المشتريات غير المخزني يستخدم default
  للتهيئة فقط، ثم يحفظ المرجع في كيان المالك.

لا تعدل هذه الشريحة العملاء أو الموردين أو الملفات أو الفواتير الموجودة.

بوابة القبول:

- create بلا override يستخدم default ويحفظه.
- override صالح ينتصر، وغير الصالح يرفض ولا يغير mapping.
- تغيير mapping ثم إنشاء كيانين يثبت أن الأول بقي على القديم والثاني أخذ الجديد.
- replay لا ينشئ طرفًا/ملفًا ثانيًا.
- preview الاستيراد يعلن مصدر الحساب قبل commit، وcommit يستخدم snapshot قرار
  preview أو يعيد Conflict إذا تغيرت النسخة، لا يغير بصمت.

### ADM-3 — Inventory authoritative consumer

يستبدل البحثين في `inventory-movement-service.ts` بمنفذ واحد:

- invoice stock: `INVENTORY_ASSET + INVENTORY_COGS`.
- opening balance: `INVENTORY_ASSET + INVENTORY_OPENING_EQUITY`.
- adjustment/receipt in: `INVENTORY_ASSET + INVENTORY_GAIN`.
- adjustment out: `INVENTORY_ASSET + INVENTORY_LOSS`.

يحل الحسابات بعد أقفال الفترة/المستند المطلوبة وقبل بناء Posting Plan وفق ترتيب
Posting Engine. تحفظ الحركة `offsetAccountId`، ويحفظ Ledger الحسابين المستخدمين.
العكس يعتمد المستند/الحركة الأصلية ولا يحل mapping جديدًا.

بوابة القبول:

- parity مع الحسابات القديمة لكل نوع حركة في SHADOW.
- تغيير mapping لا يغير عكس حركة سابقة.
- missing/invalid يفشل قبل إنشاء حركة أو مستند أو حجز رقم دائم.
- سباق mapping update مع post ينتج قيدًا كاملًا على نسخة واحدة أو Conflict، لا
  أسطرًا من حسابين.
- اختبارات Invoice POST/REVERSE وmanual movement على المحركين.

### ADM-4 — FX والإقفال وإزالة `3300`

يصبح `RealizedFxAccountService` مستهلك Registry/Port بدل الاستعلام عن القالب، وتحل
Receipt/Payment حسابي FX في معاملتهما القائمة. يستخدم الإقفال السنوي
`RETAINED_EARNINGS` في readiness وفي إنشاء مستند الإقفال.

يمنع بعد الشريحة وجود Runtime query في `apps/api/src` يحمل:

```text
sourceTemplateCode: "SMALL_BUSINESS_GENERAL"
sourceTemplateKey: "realized-fx-*"
code: "3300" داخل FinancialCloseService
```

يجوز بقاء هذه القيم في القالب وMigration/backfill والاختبارات التاريخية فقط.

بوابة القبول:

- FX صفر لا يطلب حساب gain/loss بلا حاجة.
- فرق موجب/سالب يستخدم المفتاح الصحيح ويوازن القيد Decimal.
- Receipt/Payment reverse يستخدم القيد الأصلي.
- readiness السنوي وclose command يحلان الحساب نفسه والنسخة نفسها داخل المعاملة.
- شهر غير نهاية سنة لا يتطلب `RETAINED_EARNINGS`.
- `rg` architecture guard يمنع عودة `3300` والبحث المباشر في الخدمات المحددة.

### ADM-5 — فتح PUT والإدارة

يفعل command وواجهة الاستبدال فقط بعد اكتمال Binary الرجوع الواعي بالمركز.

بوابة القبول:

- RBAC/CSRF/Idempotency/CAS/Audit كاملة.
- account lifecycle races على MariaDB/MySQL.
- لا تحديث لكيانات قائمة أو source template tags.
- deep links وRTL/LTR/الأحجام والإتاحة.
- source يتحول إلى `MANUAL`، ولا يعيد template apply الكتابة فوقه.

### ADM-6 — إزالة fallback

لا تبدأ بالموعد، بل بعد تحقيق شروط ADR. تجعل resolver صف mapping هو المصدر الوحيد
للعمليات المنقولة، وتزيل dual-read والـflags المؤقتة مع إبقاء تقرير readiness.

بوابة القبول:

- كل شركة/قدرة مفعلة جاهزة أو مستثناة بقرار أعمال مسجل.
- صفر fallback metrics خلال النافذة المعتمدة.
- لا query بالقالب داخل مستهلك تشغيلي.
- rollback/read-only drill ناجح.

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
Idempotency scope
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

```text
Idempotency عند وجوده
-> lock Account
-> lock mappings referencing it ordered by key
-> evaluate requested account change against every key
-> reject with keys, or update account
-> Audit
```

إذا بدأ mapping create في الوقت نفسه يقفل الحساب أولًا أيضًا؛ إما يرى حسابًا صالحًا
ويكمل قبل التعطيل، أو يرى التعطيل ويرفض. لا يبقى mapping جديد إلى حساب معطل.

### 9.3 الاستهلاك المالي

لا يحتاج resolver إلى قفل طويل لمجرد شاشة قراءة، لكن الأمر المالي يجب أن يثبت أنه
استخدم مرجعًا صالحًا في نفس المعاملة. للحفاظ على ترتيب Account ثم mapping المستخدم
في أوامر الإدارة، يقرأ الأمر `(accountId,version)` قراءة تمهيدية، ثم:

```text
أقفال source الأعلى مثل الفترة والمستند
-> Account ids المحلولة بترتيب تصاعدي
-> mapping keys بترتيب معجمي
-> إعادة قراءة accountId/version والأهلية
-> بناء Posting Plan ثم أقفال Ledger
```

إذا تغير الحساب أو النسخة بين القراءتين يعاد Conflict آمن أو تعاد قراءة الأمر وفق
سياسة العملية؛ لا يستمر بقائمة أقفال ناقصة. لا يقفل أي مسار mapping ثم Account كي
لا يعكس ترتيب أمر التعديل أو Account lifecycle. يوثق الترتيب النهائي في سياسة
التزامن عند التنفيذ ويختبر post-vs-mapping-change. لا يخلط الأمر حسابين من نسختين
مختلفتين.

## 10. Audit والرصد والـOutbox

### Audit

`ACCOUNTING_DEFAULT_MAPPING_SET` يحمل فقط:

- key.
- old/new account IDs كنصوص عند السماح وفق سياسة التدقيق.
- old/new version.
- source.
- سبب منقح اختياري.

لا يحمل أسماء حسابات أو مبلغًا أو Payload الطلب. Seed في تجهيز الشركة يدخل ضمن
Audit التجهيز مع قائمة keys لا بيانات الحساب التفصيلية. Migration backfill يوثق
بـprovenance ودليل الإصدار، لا ينتحل مستخدمًا في `AuditLog` الإلزامي الفاعل.

### Metrics

- `accounting_default_mapping_resolution_total{key,status}`.
- `accounting_default_mapping_fallback_total{key}`.
- `accounting_default_mapping_conflict_total{key}`.
- `accounting_default_mapping_update_total{key,result}`.
- transaction retry/deadline metrics القائمة.

لا توضع `companyId` كـPrometheus label عالي الكثافة؛ يمكن وضعها في structured log
المقيد. لا account name/id أو payload مالي في metrics.

### Outbox

لا Outbox في ADM-1..5 لعدم وجود مستهلك لاحق. إذا اعتمد event، تضاف Migration وعقد
versioned وhandler duplicate test في شريحة مستقلة؛ لا يستخدم Audit ناقلًا.

## 11. forward migration والـrollback

### Forward

1. إنشاء Enum/table/FK/indexes والصلاحيات.
2. Seed permissions/idempotent implications.
3. backfill exact candidates فقط.
4. نشر GET/readiness وSHADOW؛ لا PUT.
5. نقل المستهلكين تدريجيًا.
6. نشر Binary رجوع واعٍ ثم فتح PUT.
7. إغلاق fallback.

اختبارات Migration:

- قاعدة فارغة.
- ترقية baseline مع قالب كامل.
- ترقية دليل مخصص بلا tags.
- شركة لكل قالب من الثلاثة.
- حسابات tags مكررة عبر codes تؤدي Conflict لا اختيارًا تخمينيًا.
- حساب `3300` مؤهل وغير مؤهل ومتعدد.
- إعادة seed ومقاطعة migration/إعادتها وفق دعم الأداة.

### Rollback

- قبل PUT/الاستهلاك authoritative: يعود التطبيق ويترك الجدول؛ لا DDL مدمر مطلوب.
- rollback DDL مسموح فقط إذا لا صفوف ولا Audit/استعمال authoritative، ويتحقق script
  ويفشل مغلقًا خلاف ذلك.
- بعد التفعيل: `ACCOUNTING_DEFAULT_MAPPING_WRITES_ENABLED=false`، وإخفاء الأفعال مع
  بقاء GET والتاريخ. يستخدم Binary واعيًا بالمركز أو توقف أوامر القدرة المتأثرة
  برسالة read-only؛ لا يرجع إلى تخمين القالب.
- لا يحذف mapping أو Audit، ولا يعاد tagging للحسابات، ولا تعاد كتابة الأطراف أو
  المستندات.
- rollback لكل مستهلك منفصل؛ لا يعطل Sales لأن Inventory فشل إذا كانت حدوده مستقلة.

## 12. مصفوفة الاختبار

### Unit

- كل key يقبل الفئة/control الصحيحة ويرفض inactive/non-posting/parent/wrong class.
- candidate order للقوالب الأربعة، بما فيها legacy.
- عدم اختيار raw/WIP/finished تلقائيًا.
- readiness feature-sensitive وعدم طلب FX إذا كان الفرق صفرًا.
- explicit override precedence.

### API والعقد

- GET missing/configured/invalid والفلاتر.
- PUT create/update/replay/mismatch/version conflict.
- CSRF و`view/manage` واستحقاق `CORE_ACCOUNTING`.
- BIGINT strings وstrict request وroute parity وresponse validator وRedocly.
- cross-company forged key/account يعيد 404/رفضًا غير كاشف.
- `Cache-Control:no-store` للنجاح والخطأ و429.

### Integration

- إنشاء عميل/مورد/ملف جديد بلا default وبـdefault وبـoverride.
- تغيير default لا يغير الكيان السابق.
- Sales/Purchase invoice وPOST/REVERSE تحفظ الحساب التاريخي.
- كل أنواع حركة Inventory وinvoice stock/return/reverse.
- Receipt/Payment FX gain/loss وreverse.
- annual close/readiness وعدم بحث `3300`.
- Account deactivate/delete/reclassify مقابل mapping update.
- فشل Audit/Idempotency يسبب rollback كاملًا.
- لا كتابة مباشرة من سياق مستهلك إلى جدول mapping عبر architecture guard.

### Concurrency على قاعدة فعلية

تشغل المصفوفة على MariaDB 10.11 وMySQL 8.4، لا mocks:

- PUTان للـkey نفسه والنسخة نفسها: نجاح واحد وConflict واحد.
- replay بالمفتاح نفسه: نتيجة واحدة وAudit واحد.
- mapping create مقابل Account deactivate.
- mapping replace مقابل Account reclassify.
- inventory post مقابل تبديل `INVENTORY_ASSET` أو `INVENTORY_COGS`.
- FX settlement مقابل تبديل gain/loss.
- annual close مقابل تبديل retained earnings.
- شركتان تغيران المفتاح نفسه بلا قفل متبادل.
- deadlock مصطنع يعاد ضمن deadline أو يعيد exhausted بلا أثر جزئي.

### Migration والمحركات

- empty/upgrade/rollback guard لكل محرك.
- composite FK والتفرد وEnum parity.
- explain لفهرس `(companyId,key)` ومرجع الحساب.
- نتائج backfill متطابقة على المحركين.

### الواجهة واللغات

- ar/en/hi/ur، واتجاه RTL/LTR.
- 390/768/1440/1920.
- لوحة مفاتيح وقارئ شاشة وfocus deep-link والحوار.
- مستخدم view-only، manage، accounts.view بلا mapping.view، وعكسها حسب implications.
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
- استيراد Prisma mapping model في Sales/Purchases/Inventory/Projects.
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
- أعداد backfill المنقحة وfallback/conflict.
- نتيجة OpenAPI/Typecheck/Build/Unit/Integration/Visual/A11y.
- وضع feature flags والـrollback drill.
- المتبقي بمالك وخطة إزالة، بلا نسبة تقدم تقديرية.

نجاح محلي أو Staging لا يعني دمجًا أو نشرًا. لا push أو PR أو merge أو deploy دون
إذن المستخدم المناسب، ولا ينتقل إذن جولة سابقة إلى هذه الشرائح.
