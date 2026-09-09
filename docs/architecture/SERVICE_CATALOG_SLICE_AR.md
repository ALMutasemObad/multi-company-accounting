---
title: "Service Catalog and Pricing Delivery Slices"
status: "planned; implementation not started"
version: "1.0"
date: "2026-09-09"
related:
  - "ADR-022-service-catalog-context.md"
  - "ADR-016-service-catalog-project-separation.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "MASTER_DATA_CODE_POLICY_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "OPENAPI_EXECUTABLE_CONTRACTS_AR.md"
  - "TAX_CONTEXT_OWNERSHIP_AR.md"
---

# خطة شرائح كتالوج الخدمات والتسعير

## 1. النتيجة والحدود الثابتة

تنفذ الخطة [ADR-022](ADR-022-service-catalog-context.md) بشرائح صغيرة يمكن دمجها
والرجوع التشغيلي عنها منفصلة. النتيجة النهائية هي أن تعد الشركة خدماتها وبدائلها
وتوفرها ودفاتر أسعارها في الإعدادات، ثم تختارها Sales وProfessional Projects وCRM
من دون أن يملك الكتالوج مستنداتهم.

الحدود التي لا تتغير بين الشرائح:

- لا `InventoryItem` للخدمة، ولا `UnitOfMeasure` أو Barcode أو حركة مخزون.
- لا نقل أو إعادة تسمية لـ`SalesItemSellingProfile`; يبقى افتراض بيع الصنف تحت Sales.
- لا نقل لـ`ProfessionalServiceContract/Rate`; يبقيان شروط مشروع وعضو.
- لا كتابة إلى `SalesInvoiceLine`, Customer, Opportunity, Project, ReceivableItem أو
  Ledger من وحدة الكتالوج.
- لا تبعية دائمة على `CompanyProfile` readiness، ولا Outbox بلا مستهلك معروف.
- لا تثبيت اعتماد جديد مطلوب؛ التنفيذ يستخدم Prisma/Express/React والبنية القائمة.

## 2. حقائق الأساس وبوابة البدء

قبل أول تغيير تنفيذي يعاد التحقق من `origin/main` لأن الجرد التالي يعود إلى أساس
`909932232223315ec7994fb12859d3b1b3f77ebf`:

| الحقيقة الحالية | أثرها في الخطة |
|---|---|
| `SERVICE_CATALOG` موجود لكنه `isActive = FALSE` | ينشر Schema/API أولًا مظلمًا، ثم يفعله مالك الاشتراكات صراحة |
| لا استحقاق Grandfathered له | لا نفترض أن تفعيل الصف يمنح الشركات القائمة |
| لا ربط `services.*` في capability policies | يجب إضافته خادميًا وفي الواجهة قبل كشف route |
| `sales_catalog.* -> SALES` | يبقى كما هو؛ لا alias ولا migration تحويل |
| `SalesInvoiceLine.inventoryItemId` nullable ولا يوجد مرجع خدمة | تكامل Sales يحتاج Migration لاحقة يملكها Sales |
| مشروع الوقت والمواد يفوتر بـ`ProfessionalServiceRate` | ربط الخدمة لا يغير مصدر السعر المهني |

بوابة البدء المشتركة:

1. تثبيت owner ونطاق الملفات وعدم فتح أكثر من Migration مشتركة في الوقت نفسه.
2. حجز اسم Migration بعد آخر `origin/main`، وتنسيق `schema.prisma` وOpenAPI والملف
   المولد مع أي عمل جارٍ على ملف الشركة؛ لا تجعل نتيجة ذلك العمل prerequisite دائمًا.
3. إضافة `SERVICE_OFFERING` وبادئة `SVC-` إلى سياسة الرموز في تغيير التنفيذ نفسه.
4. اعتماد أسماء الجداول والعمليات في OpenAPI قبل Router، وعدم تعديل الحارس المولد يدويًا.
5. تحديد سياسة منح الاستحقاق التجريبي من Platform Subscriptions؛ لا تكتب وحدة
   الكتالوج في جداول الاشتراك.

## 3. تسلسل الشرائح

| الشريحة | نتيجة مستخدم واحدة | المالك/المستهلك | تغييرات مشتركة | لا يدخل فيها |
|---|---|---|---|---|
| `SC-0` | ربط الموديول وقدرة مظلمة قابلة للإنفاذ | Subscriptions + Auth | module mapping وقرار rollout | Permission seed أو جداول خدمات أو واجهة عامة |
| `SC-1A` | إعداد عرض وبديل وتوفره | Service Catalog | Schema/OpenAPI وPermission seed مستقل | أسعار، Sales، Projects، CRM |
| `SC-1B` | إعداد دفتر وسعر مؤرخ واختياره | Service Catalog | Schema/OpenAPI إضافيان | فاتورة أو عقد مشروع |
| `SC-2` | اختيار خدمة في فاتورة Sales مع لقطة ثابتة | Sales مستهلكًا | SalesInvoiceLine/OpenAPI | إعادة تسعير تلقائي أو مخزون |
| `SC-3` | ربط خدمات بنطاق مشروع | Professional Projects مستهلكًا | Schema/OpenAPI لدى Projects | تغيير سعر العضو أو الفوترة |
| `SC-4` | إضافة خدمات إلى فرصة تجارية | CRM مستهلكًا | Schema/OpenAPI لدى CRM | إنشاء مشروع/فاتورة أو تجاوز F2 |

لا تدمج `SC-2/3/4` في PR واحد. ويمكن إطلاق `SC-1A/1B` لشركات تجريبية قبل المستهلكين
كي تنشئ بيانات إعداد فقط.

## 4. SC-0 — ربط الموديول والتركيب المظلم

هذه شريحة تنسيق صغيرة لدى ملاك Platform Subscriptions/Auth. تملك ربط الصلاحية
بالموديول وتفعيله ومنح استحقاقه فقط؛ لا تكتب Service Catalog في جداولهم، ولا تملك
SC-0 إنشاء Permission rows.

### التغيير

- ربط prefix `services.` بـ`SERVICE_CATALOG` في
  `CompanyCapabilityService` و`module-entitlements.ts` مع اختبارات التكافؤ.
- إبقاء `PlatformModule.isActive = false` حتى نجاح SC-1A وSC-1B.
- تفعيل صف الموديول ومنح الاستحقاق لاحقًا بMigration/أمر يملكه Platform
  Subscriptions بعد جاهزية SC-1A/SC-1B؛ لا Schema خدمة ولا Permission seed في SC-0.

### القبول

- RBAC خام بلا استحقاق يعيد `403` ولا يصل إلى خدمة المجال.
- الاستحقاق بلا RBAC لا يعرض route أو فعلًا.
- `sales_catalog.view/manage` ما زالا يتطلبان `SALES` فقط.
- لا يوجد تعريف مكرر لـ`services.*` في Migration أو Seed تابع لـSC-0؛ تملك SC-1A
  هذه الصفوف والمنح وحدها.
- لا تمنح الشركات القائمة أو الجديدة `SERVICE_CATALOG` تلقائيًا في هذه الخطوة.

## 5. SC-1A — تعريف الخدمة والبديل والتوفر

### 5.1 نتيجة الإغلاق

يستطيع مدير مخول من إعدادات الشركة إنشاء عرض برمز مولد، وإضافة بديل بوحدة تجارية
ومراجع افتراضية اختيارية، ثم تنشيطه أو إيقافه وتحديد نافذة توفره. يستطيع مستخدم عرض
البحث في البدائل المتاحة دون رؤية أي بيانات من شركة أخرى.

### 5.2 Migration الأولى

تنشئ Migration توسعية بأسماء مادية تعتمد عند التنفيذ:

- Enums الحالة ووحدة التسعير.
- `service_categories`.
- `service_offerings`.
- `service_offering_variants`.
- تسلسل `SERVICE_OFFERING` في `MasterDataCodeSequence` لكل شركة حالية، وتضيفه سياسة
  تجهيز الشركات الجديدة من Infrastructure من دون نقل ملكية العرض.
- فهارس `(company_id, status, code, id)`، والبحث بالأسماء، ونافذة التوفر.
- مفاتيح مركبة داخل الشركة، و`RESTRICT` لمراجع Account/Tax.

لا تنشئ Migration الجداول أي Permission rows. ينفذ SC-1A Artifact تهيئة مستقلًا
idempotent لصفوف `services.view/manage/prices.manage` ومنحها للدور النظامي الإداري؛
SC-1A/Service Catalog هي المالك الوحيد لهذا Permission seed، ولا تعيد SC-0 أو SC-1B
إنشاءه ولا تخلطه بـmodule mapping.

تستخدم الخدمة الاسمين الثابتين `ServiceCatalogRevenueAccountQueryPort` و
`ServiceCatalogOutputTaxQueryPort` للتحقق من المرجعين، إضافة إلى
`ServiceCatalogCurrencyQueryPort` عند الحاجة. لا تنشأ aliases أقصر بأسماء مختلفة في
الخدمة أو composition root.

لا تنشئ Migration أي صف خدمة من:

- `inventory_items` أو `sales_item_selling_profiles`.
- بنود فاتورة يدوية أو أصنافها.
- `professional_service_contracts/rates`.

### 5.3 أوامر وقراءات HTTP

كل JSON تحت `/api/v1/service-catalog`، وكل معرف عام UUID في URL. المقترح:

| العملية | الصلاحية | ملاحظات العقد |
|---|---|---|
| `GET /service-catalog/categories` | `services.view` | Pagination وبحث/حالة محدودان |
| `POST /service-catalog/categories` | `services.manage` | Idempotency-Key؛ لا code |
| `PATCH /service-catalog/categories/{categoryId}` | `services.manage` | `version` وIdempotency-Key |
| `POST /service-catalog/categories/{categoryId}/transition` | `services.manage` | الحالة والنسخة والسبب ومفتاح التكرار |
| `GET /service-catalog/offerings` | `services.view` | page 1..10000، pageSize 1..100، ترتيب code ثم id |
| `POST /service-catalog/offerings` | `services.manage` | ينشئ العرض وبديله الأول في معاملة واحدة |
| `GET /service-catalog/offerings/{offeringId}` | `services.view` | بدائل ومرجعيات منقحة، لا Prisma records |
| `PATCH /service-catalog/offerings/{offeringId}` | `services.manage` | `version`، ولا يقبل code |
| `POST /service-catalog/offerings/{offeringId}/transition` | `services.manage` | الحالة والنسخة والسبب ومفتاح التكرار |
| `POST /service-catalog/offerings/{offeringId}/variants` | `services.manage` | وحدة/نافذة/مراجع افتراضية |
| `PATCH /service-catalog/variants/{variantId}` | `services.manage` | `version`; تغيير الوحدة يمنع بعد أول تنشيط ويستعاض ببديل جديد |
| `POST /service-catalog/variants/{variantId}/transition` | `services.manage` | انتقال مسبب ومدقق |
| `GET /service-catalog/selection-options` | `services.view` | `asOf`, search, page، ويعيد التوفر وأسباب المرجعيات |

يأخذ الخادم `companyId` من الجلسة. Decimal غير موجود بعد في هذه الشريحة، لكن BigInt
إن خرج يبقى نصًا. التواريخ `YYYY-MM-DD` بنطاق نصف مفتوح. أجسام الأوامر
`additionalProperties: false` وتستخدم الحراس المولدة.

### 5.4 حالات الاستخدام والحواجز

- إنشاء العرض يحجز `SVC-` وينشئ الكيان والتدقيق وIdempotency في معاملة واحدة.
- لا يستطيع العميل إرسال الرمز أو تعديله.
- ينشأ التصنيف `ACTIVE`. يسمح بتعديل اسمه ووصفه في `ACTIVE/INACTIVE` بالنسخة، وتكون
  انتقالاته `ACTIVE → INACTIVE | RETIRED` و`INACTIVE → ACTIVE | RETIRED` فقط.
  كل انتقال يتطلب سببًا و`expectedVersion` وAudit ذريًا؛ `RETIRED` نهائي.
- تعطيل/تقاعد التصنيف يمنع إسناد عرض جديد أو نقله إليه، لكنه لا يعطل عرضًا تابعًا ولا
  يغير توفره أو لقطاته. لا Cascade ولا hard delete.
- تنشيط العرض يتطلب بديلًا واحدًا غير متقاعد على الأقل؛ لا يتطلب سعرًا أو ملف شركة
  مكتملًا، لأن Projects/CRM قد يستعملانه قبل البيع.
- تنشيط البديل يتطلب عرضًا غير متقاعد ونافذة صحيحة.
- لا يملك البديل `sequence` في SC-1A؛ ترتب بدائله حتميًا بـ`createdAt` ثم `id`، ولا
  يوجد أمر reorder أو حجز رقم متزامن خفي.
- تعطيل الحساب أو الضريبة لاحقًا لا يغير حالة البديل؛ تظهر جاهزية المرجع منفصلة.
- تقاعد العرض نهائي، ويحجب الاختيار الجديد ويحفظ الروابط التاريخية.
- لا hard delete لأي عرض/بديل بعد الإنشاء.

## 6. SC-1B — دفاتر الأسعار والأسعار المؤرخة

### 6.1 نتيجة الإغلاق

ينشئ مسؤول الأسعار دفترًا في عملة شركة، ويعينه افتراضيًا، وينشر سعرًا حاليًا أو
مستقبليًا لبديل. يعيد API سعرًا واحدًا حتميًا عند تاريخ وعملة، ولا يحول العملة أو
يستنتج سعرًا عند الغياب.

### 6.2 Migration الثانية

- `service_price_books` بعلاقة مركبة إلى `CompanyCurrency`.
- `service_default_price_books` بمفتاح `(company_id, currency_id)` ومرجع مركب إلى
  دفتر الشركة والعملة نفسيهما و`version`؛ هو مؤشر الافتراضي بدل Boolean متسابق.
- `service_prices` بعلاقات مركبة إلى الدفتر والبديل والشركة.
- `DECIMAL(19,4)` وChecks للمبلغ والتواريخ.
- فهارس بحث الفعالية
  `(company_id, price_book_id, service_variant_id, status, effective_from, effective_until)`.
- لا عمود `currentPrice` على العرض أو البديل، ولا Backfill من Sales.

### 6.3 API

| العملية | الصلاحية | قاعدة أساسية |
|---|---|---|
| `GET /service-catalog/price-books` | `services.view` | Pagination حسب العملة/الحالة |
| `POST /service-catalog/price-books` | `services.prices.manage` | دفتر `DRAFT` ومفتاح تكرار |
| `PATCH /service-catalog/price-books/{priceBookId}` | `services.prices.manage` | نسخة؛ عقد PATCH لا يقبل العملة لأنها immutable منذ الإنشاء |
| `POST /service-catalog/price-books/{priceBookId}/transition` | `services.prices.manage` | تفعيل/تعطيل/تقاعد مسبب |
| `POST /service-catalog/price-books/{priceBookId}/make-default` | `services.prices.manage` | CAS صريح على نسخة الدفتر والمؤشر المتوقع |
| `POST /service-catalog/price-books/{priceBookId}/prices` | `services.prices.manage` | سعر مسودة Decimal نصي |
| `PATCH /service-catalog/prices/{priceId}` | `services.prices.manage` | للمسودة فقط وبنسخة |
| `POST /service-catalog/prices/{priceId}/publish` | `services.prices.manage` | قفل وفحص تداخل وIdempotency |
| `POST /service-catalog/prices/{priceId}/end` | `services.prices.manage` | `REPLACE` بخلف ذري أو `LEAVE_GAP` مقصود، لا خلف اختياري مبهم |
| `POST /service-catalog/prices/{priceId}/cancel` | `services.prices.manage` | قبل بداية النفاذ فقط، بسبب |

كل مبلغ في النقل نص ثابت بأربع منازل. لا يقبل Number عائم، ولا `MAX()+1`، ولا query
غير محدودة لفحص التداخل.

عقد `make-default` يحمل `priceBookVersion`، ثم واحدًا من:

- `expectedDefault: {kind: "ABSENT"}` عندما يتوقع العميل عدم وجود مؤشر.
- `expectedDefault: {kind: "PRESENT", priceBookId, version}` عندما يستبدل مؤشرًا
  قرأه فعلًا.

يقفل الأمر الدفتر الهدف ويتحقق أنه `ACTIVE` ثم ينشئ/يحدث مؤشر
`(companyId, currencyId)` بالشرط المتوقع. يعيد الغياب/الوجود غير المتوقع، اختلاف
المعرف أو النسخة، وسباق unique الخطأ `409 DEFAULT_PRICE_BOOK_CONFLICT`. لا يعمل
blind overwrite. اختلاف `priceBookVersion` يعيد `409 VERSION_CONFLICT`، وتعيد
الاستجابة الناجحة معرف المؤشر ونسخته الجديدة. تعطيل أو تقاعد الدفتر الافتراضي يعيد
`409 SERVICE_PRICE_BOOK_IS_DEFAULT` حتى ينقل المؤشر بأمر CAS إلى دفتر `ACTIVE` آخر
من العملة نفسها. ولا يوجد مسار لتغيير عملة الدفتر، لذلك لا ينتقل مؤشر افتراضي بين
العملات ضمنيًا.

عقد `end` مميز بـ`mode`:

- `REPLACE`: يطلب `effectiveUntil`, `reason`, `version` وبيانات سعر خلف؛ يجب أن تكون
  بداية الخلف مساوية تمامًا للنهاية، ويغلق السابق وينشر الخلف داخل معاملة واحدة.
- `LEAVE_GAP`: يطلب `effectiveUntil`, `reason`, `version` و`allowGap: true`، ولا ينشئ
  خلفًا. الفجوة مسموحة ومقصودة في SC-1B، ويعيد الاختيار داخلها
  `SERVICE_PRICE_NOT_FOUND` بلا fallback.

يرفض الجسم الذي لا يحدد أحد النمطين، أو يرسل خلفًا مع `LEAVE_GAP`، أو يرسل
`REPLACE` بلا خلف. لا تعدل الحدود بأثر رجعي.

### 6.4 مصفوفة الفعالية

يفسر اختيار السعر دائمًا بالترتيب الآتي:

| التحقق | الفشل | هل توجد fallback؟ |
|---|---|---|
| الشركة والبديل | 404 موحد عند الغياب/شركة أخرى | لا |
| حالة العرض والبديل والنافذة | `SERVICE_NOT_AVAILABLE` | لا |
| عملة شركة فعالة | `SERVICE_CURRENCY_UNAVAILABLE` | لا تحويل |
| دفتر صريح أو افتراضي واحد | `SERVICE_PRICE_BOOK_REQUIRED` | لا اختيار اعتباطي |
| دفتر `ACTIVE` وعملته مطابقة | `SERVICE_PRICE_BOOK_UNAVAILABLE` | لا |
| سعر `PUBLISHED` يغطي `asOf` | `SERVICE_PRICE_NOT_FOUND` | لا آخر سعر ولا صفر ضمني |
| مرجع الحساب/الضريبة | يعاد warning/readiness منفصل | يقرر المستهلك اختيار مرجع صريح |

### 6.5 مصفوفة التزامن

| السباق | النتيجة المطلوبة |
|---|---|
| نشر سعرين متداخلين لنفس الدفتر/البديل | نجاح واحد؛ الآخر `409 SERVICE_PRICE_OVERLAP` |
| طلبا `make-default` يتوقعان `ABSENT` لدفترين | ينجح واحد؛ الآخر `409 DEFAULT_PRICE_BOOK_CONFLICT` ولا يكتب فوقه |
| استبدال المؤشر بنسخة متوقعة قديمة | `409 DEFAULT_PRICE_BOOK_CONFLICT` حتى لو كان الدفتر الهدف صالحًا |
| جعل دفتر هدف افتراضيًا بنسخة دفتر قديمة | `409 VERSION_CONFLICT`؛ لا يتغير المؤشر |
| تعديل عملة دفتر عادي أو افتراضي | يرفض العقد الحقل؛ ينشأ دفتر جديد ويبدل المؤشر بـCAS |
| `end/REPLACE` مقابل اختيار السعر | الاختيار يرى السابق أو الخلف عند الحد، ولا يرى فجوة جزئية |
| `end/LEAVE_GAP` مقابل اختيار السعر | يرى السعر قبل النهاية أو `SERVICE_PRICE_NOT_FOUND` بعدها؛ الفجوة مقصودة |
| تعديل مسودة من نسختين | نجاح نسخة واحدة، والأخرى `VERSION_CONFLICT` |
| نفس المفتاح والجسم للنشر | أثر واحد واستجابة قابلة للإعادة |
| المفتاح نفسه وجسم مختلف | `IDEMPOTENCY_MISMATCH` |
| شركتان تنشران السعر نفسه | لا قفل مشترك غير لازم ولا تسرب |
| Deadlock مصطنع | Retry كامل محدود أو `CONCURRENCY_RETRY_EXHAUSTED` بلا أثر مكرر |

تنفذ حالات الأقفال على MariaDB/MySQL فعلية، لا mock أو SQLite.

## 7. SC-2 — تكامل Sales واللقطة التاريخية

هذه الشريحة يملكها Sales مع Adapter إلى Port يعرّفه هو. لا تنقل ملكية بند الفاتورة.

### التغيير الأدنى

- يضيف Sales حقولًا nullable لمعرف العرض/البديل/السعر ولقطات رمز الخدمة واسمها واسم
  البديل ووحدة التسعير وسعر القائمة. يظل `unitPrice` السعر الفعلي الحاكم.
- يضيف Check يمنع اجتماع `inventoryItemId` و`serviceVariantId`، مع السماح ببند يدوي
  بلا الاثنين للتوافق.
- لا Backfill تخميني للبنود اليدوية القديمة.
- عند اختيار الخدمة، يعيد Sales التحقق عبر `SalesServiceCatalogPort` داخل معاملة
  حفظ المسودة، ثم يتحقق من Account ويحسب Tax عبر `TaxQuotePort`.
- لا يستدعي Catalog عند ترحيل فاتورة محفوظة لإعادة التسعير. يتحقق Sales من لقطة
  المسودة وقواعده المالية، وتبقى تغييرات الكتالوج اللاحقة بلا أثر رجعي.
- إنشاء/عكس المخزون لا يرى سطر الخدمة. الفاتورة المختلطة تمرر أسطر الأصناف فقط إلى
  `InventoryInvoiceStockPort`.

### Barcode Impact

التكامل يغير اختيار بند Sales، لذلك لا يستخدم `N/A`:

- مسار الخدمة لا يقبل باركودًا ولا يستدعي Inventory resolve.
- النقر/المسح الحاليان للصنف يبقيان في المسار نفسه ولا يحولان إلى خدمة باسم مشابه.
- نوع السطر أو مرجعه الصريح يمنع إنشاء حركة مخزون للخدمة.
- اختبارات الفاتورة المختلطة تثبت أن أسطر الصنف وحدها تولد الحركة، وأن طباعة/تصدير
  الفاتورة يحفظ لقطة الخدمة من دون الادعاء بباركود.

### قبول SC-2

- تغيير اسم/وحدة/سعر/ضريبة افتراضية بعد الحفظ لا يغير لقطة السطر.
- السعر الافتراضي المعروض لا يتجاوز سياسة Sales للخصم أو التعديل؛ الخادم يحسب الفعلي.
- فشل Catalog أو Account أو Tax يلغي تعديل المسودة كله، ولا يوجد بند جزئي.
- الترحيل ينشئ ذمة وقيدًا مرة واحدة عبر Sales/PostingEngine فقط.
- فاتورة شركة لا تستطيع ربط بديل شركة أخرى، حتى بمعرف عام صحيح.

## 8. SC-3 — ربط نطاق Professional Projects

هذه شريحة مستقلة يملكها Professional Projects:

- ينشئ المالك `ProfessionalProjectServiceScope` أو اسمًا يعتمد في Schema، يحمل
  `companyId/projectId/serviceVariantId` ولقطة رمز/اسم/وحدة وحالة ربط و`version`.
- يقرأ الخدمة عبر `ProjectServiceCatalogPort`، ولا يستورد خدمة Catalog الخرسانية.
- الربط يصنف نطاق التسليم فقط. لا ينشئ عقدًا أو سعر عضو أو وقتًا أو فاتورة.
- `ProfessionalServiceContract/Rate` يبقيان المصدر الحاكم لفوترة T&M. لا fallback من
  سعر الكتالوج عند غياب سعر العضو.
- تقاعد الخدمة يمنع ربطًا جديدًا ولا يحذف نطاق مشروع قائمًا. يعرض المشروع اللقطة مع
  إشارة أن المرجع لم يعد متاحًا للاختيار.
- أي فوترة مبلغ ثابت/مرحلة تعتمد على الربط تحتاج ADR لاحقًا للاستحقاق واللقطة، ولا
  تدخل SC-3.

القبول: عزل الشركة والجدار الأخلاقي الحالي كلاهما مطبقان؛ `services.view` لا يمنح
رؤية مشروع مقيد، و`professional_projects.view` لا يمنح إدارة الكتالوج.

## 9. SC-4 — بنود خدمة فرصة CRM

هذه شريحة مستقلة يملكها CRM بعد استقرار SC-1B:

- يضيف CRM بنود فرصة محدودة بمرجع البديل والكمية وسعر مقترح ولقطة المصدر/العملة.
- يقرأ `CrmServiceCatalogPort`; لا يكتب Service Catalog ولا Customer ولا Sales.
- السعر المقترح والقيمة المتوقعة حقائق CRM، لا مبلغ فاتورة ولا إيراد محاسبي.
- لا تجمع العملات، ولا تحولها، ولا تستنتج احتمال الفوز أو الخصم من دفتر السعر.
- تغير الكتالوج لا يعيد كتابة فرصة قائمة؛ إعادة التسعير فعل CRM صريح وبنسخة.
- الفوز لا ينشئ فاتورة أو مشروعًا. يبقى F2 شرطًا قبل إنشاء قضية قانونية، ولا تنسخ
  ملاحظات الفرصة إلى وصف قضية.

القبول: اختبارات Pipeline تبقى مجمعة لكل عملة، والبحث لا يكشف خدمات شركة أخرى، ولا
توجد كتابة أو صف جديد في Sales/Projects/Ledger.

## 10. واجهة الإعداد والاستخدام اليومي

### 10.1 الإعداد

توضع بطاقة `كتالوج الخدمات` في مجموعة إعدادات/إدارة الشركة، وتفتح route مستقلًا
`#services` بوصفه عقد الـhash canonical المطابق لـADR-016. لا ينشأ
`#serviceCatalog` كوجهة ثانية؛ وإذا سبق أن وصل إلى بناء تجريبي، يبقى alias مؤقتًا
يعيد التوجيه أحادي الاتجاه إلى `#services` ولا يملك سياسة صلاحيات أو صفحة مستقلة.
لا يحشر الكتالوج في نموذج `CompanySettingsPage` الطويل؛ الانتماء
للإعدادات هو موضع التنقل والمسؤولية، بينما الصفحة مستقلة وقابلة للرابط المباشر.

ترتيب الصفحة:

1. عنوان ووصف مختصر وإجراء إنشاء لمن يملك `services.manage`.
2. بحث وفلاتر وعروض/بدائل مع حالة التوفر.
3. مساحة دفاتر الأسعار تظهر لمن يملك العرض، وأفعالها فقط لمن يملك
   `services.prices.manage`.
4. سجل التاريخ/الحالة والمرجعيات بأسماء مقروءة، لا IDs خام.

لا يظهر زر إدارة بناء على اسم الدور. عدم اكتمال Account/Tax يظهر كتحذير قابل للإصلاح
برابط مسموح فقط، ولا يمنح `services.manage` صلاحيات الحسابات أو الضرائب.

### 10.2 الاستخدام اليومي

يظهر selector صغير في صفحة المستهلك، لا نسخة كاملة من شاشة الإعداد:

| الرحلة | ما يعرض | من يملك الحفظ |
|---|---|---|
| Sales | الخدمة/البديل والوحدة والسعر المقترح وأسباب الجاهزية | SalesInvoice |
| Projects | الخدمة/البديل والتوفر المرجعي فقط | Project scope |
| CRM | الخدمة/البديل والسعر المقترح لكل عملة | Opportunity |

التحميل متأخر ومحدود، ويلغى الطلب السابق عند البحث أو تبديل الشركة. لا يحفظ السعر أو
بيانات الشركة في `localStorage/sessionStorage`. الخطأ أو 403 لا يستبدلان البيانات
الحالية بنتيجة شركة أخرى.

## 11. الاختبارات المطلوبة

### 11.1 Domain وAPI

- جميع انتقالات العرض والبديل والدفتر والسعر الصحيحة والمرفوضة.
- دورة التصنيف كاملة: يبدأ `ACTIVE`، تعديل `ACTIVE/INACTIVE`، الأسباب والتدقيق، منع
  تعديل/إسناد `RETIRED`، وبقاء توفر العرض مستقلًا عن حالة تصنيفه.
- نافذة نصف مفتوحة عند البداية والنهاية، والتاريخ قبل/داخل/بعد النافذة.
- صفر صريح، عدد موجب، سالب مرفوض، ودقة أكثر من أربع منازل حسب OpenAPI.
- عدم تداخل السعر، وعدم fallback لدفتر/عملة/سعر مفقود.
- `end/REPLACE` يثبت تلاصق الحد وذرية الخلف، و`end/LEAVE_GAP` يتطلب `allowGap: true`
  ويعيد `SERVICE_PRICE_NOT_FOUND` داخل الفجوة؛ كل الأجسام الملتبسة ترفض.
- حساب/ضريبة/عملة من شركة أخرى أو معطلة، وغياب المرجع الاختياري.
- Pagination/search/filter bounded وترتيب حتمي بلا N+1.
- UUID/BigInt/Decimal/date serialization، وأكواد أخطاء معلنة ومدققة.
- CSRF وRBAC والاستحقاق و`Cache-Control: no-store` على نجاح وخطأ و429.

### 11.2 العزل والتزامن والمعاملة

- عزل شركتين في القوائم والتفاصيل والبحث والمرجعيات ومنافذ المستهلك.
- روابط مركبة ترفض Category/Account/Tax/Currency/Variant من شركة أخرى.
- 20 إنشاء عرض متزامنًا بلا رمز مكرر، مع السماح بفجوات rollback حسب السياسة.
- ثبات ترتيب البدائل بـ`createdAt,id` تحت إنشاء متزامن، وعدم وجود `sequence` أو أمر
  reorder أو سباق حجز خاص بها.
- سباقات النشر وCAS الدفتر الافتراضي بنوعي `ABSENT/PRESENT`، والنسخة القديمة، ومنع
  تغيير العملة والتعديل/التعطيل كما في مصفوفة SC-1B.
- Idempotency replay/mismatch/in-progress، وrollback عند فشل Audit أو مرجع خارجي.
- Retry deadlock والـdeadline والـtransaction timeout من الغلاف المركزي.
- عند وجود مستهلك Outbox لاحقًا فقط: duplicate delivery وlease/retry/dead-letter.

### 11.3 حواجز المعمارية

- منع Prisma writes من `service-catalog` إلى Inventory, Sales, CRM, Projects, Tax,
  Accounts, AR أو Ledger.
- منع استيراد خدمات خرسانية للمستهلكين أو `PostingEngine`.
- قصر كتابة جداول الكتالوج على وحدته، وقصر ربط Sales/Projects/CRM على Adapters المعلنة.
- تثبيت اسمي `ServiceCatalogRevenueAccountQueryPort` و
  `ServiceCatalogOutputTaxQueryPort` في العقود والتركيب ومنع alias مكرر.
- إثبات أن `sales_catalog.*` لم ينتقل من `SALES` وأن `services.*` يتطلب
  `SERVICE_CATALOG`.
- إثبات أن Permission seed المستقل في SC-1A وحده ينشئ الصفوف ومنح الدور، وأن Migration
  الجداول لا تنشئها، وأن SC-0 يملك module mapping/activation فقط ولا يكرر الـSeed.
- منع `InventoryItem` و`ProfessionalServiceRate` و`SalesInvoiceLine` من الظهور في DTO
  الكتالوج الدائم.

### 11.4 OpenAPI والبناء

- تعديل OpenAPI ثم إعادة التوليد؛ `contracts:check` وRedocly وroute parity وoperation
  guards كلها ناجحة.
- اختبارات طلب واستجابة إيجابية وسلبية لكل جسم وحالة JSON.
- TypeScript لكل API/Web، وحزم Unit/Integration ذات الصلة، وبناء الإنتاج.
- لا نجاح مبني على fixture وحده؛ تختبر الصفحة الموصولة وعقد `/auth/me` الفعلي.

### 11.5 MariaDB وMySQL

تنفذ على MariaDB 10.11 وMySQL 8.4:

- جميع Migrations من قاعدة فارغة مع Seed.
- ترقية نسخة من Schema أساس الإنتاج مع بيانات Inventory/Sales/Projects حقيقية تثبت
  عدم تحويلها أو تغيير عددها.
- القيود المركبة وChecks والفهارس وخطة استعلام القائمة والاختيار.
- اختبارات التزامن والـdeadlock وتداخل المدى والدفتر الافتراضي.
- rollback على قاعدة فارغة/غير مستخدمة، ورفضه بعد عرض أو سعر أو رابط مستهلك.

### 11.6 RTL والإتاحة والمصفوفة المرئية

- تكافؤ مفاتيح العربية والإنجليزية والهندية والأردية، ولا نص مرئي صلب في JSX.
- RTL للعربية/الأردية وLTR للإنجليزية/الهندية، من دون انقلاب الأرقام أو أكواد الخدمة.
- 390 و768 و1440 و1920 بلا تمرير أفقي للصفحة؛ تتحول الجداول إلى بطاقات/قائمة واضحة
  على الهاتف.
- تنقل كامل بلوحة المفاتيح، focus ظاهر، إغلاق Modal يعيد التركيز، وlabels وdescriptions
  مرتبطة بالمدخلات.
- قارئ الشاشة يعلن التحميل والنجاح والخطأ والتعارض، والحالة لا تعتمد على اللون وحده.
- تباين وأهداف لمس مناسبة، ومقاسان أساسيان متسقان للخط بلا عناوين ضخمة أو نص صغير.
- رابط hash مباشر غير مصرح به يعيد إلى وجهة مسموحة قبل تركيب الصفحة.

## 12. بوابات Migration والرجوع والإطلاق

| المرحلة | الرجوع البنيوي المسموح | الرجوع التشغيلي بعد الاستخدام |
|---|---|---|
| SC-0 | عكس policy مع الواجهة في Artifact واحد قبل المنح | تعطيل الموديول مع إبقاء الاستحقاقات المؤرخة؛ لا حذف |
| SC-1A | إسقاط الجداول/التسلسل وعكس Permission seed المستقل إذا كانت كلها غير مستخدمة | تعطيل routes والموديول، إبقاء التعريف والصلاحيات والتدقيق |
| SC-1B | إسقاط جداول السعر إذا خلت ولم توجد مراجع | إبقاء الأسعار والدفاتر، تعطيل الكتابة والاختيار |
| SC-2 | إزالة أعمدة nullable فقط قبل أي لقطة خدمة | نشر Binary متوافق يخفي الاختيار ويحفظ لقطة الفاتورة |
| SC-3 | إزالة جدول الربط فقط قبل أي سجل | إخفاء الفعل مع حفظ نطاق المشروع |
| SC-4 | إزالة جدول البنود فقط قبل أي سجل | إخفاء الفعل مع حفظ لقطة الفرصة |

قبل كل rollback تتحقق أعداد الصفوف وسجلات Idempotency/Audit والمراجع من اتصال قاعدة
البيانات نفسه. لا تحذف بيانات لتجاوز الحاجز. بعد أول استخدام يكون الإصلاح forward.

الإطلاق:

1. نشر Schema/API مظلمين مع `SERVICE_CATALOG` غير نشط.
2. تشغيل اختبارات العقد وقاعدتي البيانات والواجهة.
3. تفعيل الموديول ومنحه لشركة تجريبية من Platform Subscriptions.
4. مراقبة 403/409 والـdeadlocks وزمن query وفشل المرجعيات، من دون payload أسعار.
5. توسيع الاستحقاق بقرار منتج. لا يعني نجاح Staging نشرًا أو منحًا عامًا.

## 13. مخاطر مؤجلة بمالك واضح

| المؤجل | سبب التأجيل | المالك قبل التنفيذ |
|---|---|---|
| أسعار عميل/شريحة/قناة وخصومات كمية | تحتاج قواعد أولوية ومنع تعارض وعلاقة Customer | ADR مشترك Service Catalog + Sales |
| تحويل العملات | الكتالوج لا يملك أسعار الصرف ولا توقيت المستند | Tenant/Sales policy |
| باقات خدمات مركبة | تحتاج كمية واعتماديات وتسعير bundle | Service Catalog ADR لاحق |
| حجز جلسة أو سعة موارد | التوفر الحالي تجاري لا Calendar/Capacity | Projects/HR/Calendar owner |
| فوترة ثابتة أو مراحل من خدمة | تحتاج حقيقة استحقاق مشروع ولقطة | Professional Projects + Sales |
| إنشاء قضية من فرصة | يحتاج Conflict Check F2 | Legal intake/Professional Projects |
| مزامنة بحث أو إشعارات | لا مستهلك موثوق حاليًا | يضاف Outbox عند وجود المستهلك |
| اشتراط readiness نظامي حسب الدولة | لا يخص تعريف كل خدمة | Tenant policy + Sales/Tax عند القدرة المنظمة |

## 14. تعريف الإنجاز

توثق كل شريحة ما نُفذ وما اختبر وما لم يختبر والمتبقي، من دون نسبة تقدم. ولا توصف
منتهية أو قابلة للإطلاق قبل:

- اكتمال نتيجة المستخدم الخاصة بها فقط، لا مجرد Schema أو mock UI.
- نجاح بوابات ownership/RBAC/entitlement/isolation/concurrency/Audit/OpenAPI.
- نجاح MariaDB وMySQL وfresh/upgrade والرجوع المحروس المناسبين.
- نجاح RTL/LTR والهاتف والإتاحة للواجهة الفعلية.
- شجرة نظيفة وCommit محدد وCI عند طلب الدمج.

لا Push أو PR أو دمج أو نشر أو منح استحقاق إنتاجي من هذه الخطة دون إذن صريح.
