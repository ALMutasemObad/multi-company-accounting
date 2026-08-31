# تسليم R2 — ملف بيع الصنف وكتالوج البيع

الحالة: تنفيذ محلي للفحص والربط، **ليس جاهزًا للدمج/الإصدار بعد**.
الفرع `feat/grocery-sales-catalog`، النسخة `D:/CodexWorktrees/grocery-sales-catalog`.
لا نشر/Push/PR/Merge أو اتصال بقاعدة تطوير أو استضافة أو تحصيل حقيقي.

commits التنفيذ بالترتيب: `a0e2031` (policy/ports/service)، `b8305c5`
(persistence/API/migration/contracts)، `01ea4c1` (editor/unknown safety).
يلحقها commit وثيقة التسليم هذه. لا تضمّن `3860c6e` في النقل لأنه ربط R0 الموجود لديه.

## العقد والتركيب لدى R0

العقد المعتمد: `docs/architecture/SALES_ITEM_SELLING_PROFILE_R2_AR.md`.

الخادم:

```ts
const sellingProfiles = createSellingProfileService(prisma);
app.use(apiPrefix, createSellingProfileRouter(auth, sellingProfiles));
```

تصدير التركيب من `apps/api/src/composition/create-selling-profile-service.ts`،
والـRouter من `apps/api/src/sales/selling-profile-router.ts`. لم يعدل R2 app/server.
R0 يربط الاستحقاق SALES وصلاحيات `sales_catalog.view/manage` وHTTP no-store/
مدقق الاستجابة المركزي. commit ربط الاستحقاق المركزي `ff742eb` استورد محليًا
بـ`3860c6e` للفحص فقط؛ **لا تعاد إضافته من تسليم R2**.

صفحة GET محدودة1..100 عنصر، page<=10000، search trimmed<=100 بلا تحكم، ترتيب
code/id، وقراءة مفردة بالـinventoryItemId. لا بحث باركود خارج Inventory ولا N+1.
`isReady` جاهزية المراجع فقط، لا رصيد مخزون أو فترة أو نتيجة Checkout. ملف مفقود
ليس سعر صفر؛ اختلاف عملة السلة لا يحوّل السعر تلقائيًا ولا يفرض سياسة override جديدة.

المحرر `apps/web/src/ItemSellingProfileEditor.tsx` يركبه R0 على الصنف المختار في
تبويب أصناف Inventory. لا تعديل InventoryPage/PosPage/App أو locale registry.
تعريفات props تصدّر من الملف، والأنواع المالية من `selling-profile-editor-model.ts`:

- `scopeKey`: هوية المستخدم والشركة معًا؛ `itemId`, `itemName`, `profile` أوnull.
- `locale`: ar/en/hi/ur، `canManage` من effective permissions والاستحقاق المركزي.
- `currencies/accounts/taxes`: كل خيار `{id:string,label:string,isAvailable:boolean}`.
  يحمل المرجع الحالي حتى إن تعطل؛ غيابه يظهر هويته غير المتاحة ولا يختار بديلًا.
  وجود عملة وحساب صالحين شرط للحفظ، والضريبة اختيارية. تعطيل ملف قديم دون تغيير
  افتراضاته مسموح حتى لو تعطلت مراجعها.
- `onSave(command,idempotencyKey)` يرسل POST/ PATCH للمسار المعتمد. command يحمل
  `{kind:'create'|'update',itemId,body}`؛ body الإنشاء price/currency/revenue/tax،
  وbody التعديل يضيف version/isActive. السعر fixed4 نصي، دون Number.
- النتيجة `saved` مع profile مطابق للعقد، أو `rejected` مع أحد
  VERSION_CONFLICT/REFERENCE_INVALID/FORBIDDEN/VALIDATION_ERROR، أو `unknown`.
  على R0 التحقق من DTO/scope قبل إرجاع saved. Network/timeout/5xx ونتيجة غير متحققة
  ليست rejected مؤكدة؛ يعيد unknown. التعارض المؤكد لا يعاد تلقائيًا.
- `onReload()` قراءة فقط. **GET لا يثبت نتيجة محاولة الكتابة**.

`selling-profile-attempts.ts` يحتفظ بسجل أوامر مؤقت في ذاكرة الصفحة بحد16 ومفتاح
user/company/item. يبقى الجسم والمفتاح مجمدين خلال unmount/تغيير version/تحديث GET،
والنقر المتكرر أثناء الإرسال لا يرسل طلبًا ثانيًا. المحاولة غير المحسومة لا تطرد
عند امتلاء السجل؛ يفشل طلب جديد مغلقًا. إعادة المحاولة الصريحة تستخدم الجسم والمفتاح
نفسيهما وتسمح لنتيجة متأخرة بالتحديث داخل نطاقها الأصلي فقط. لا localStorage أو
sessionStorage أو cache مالي. beforeunload يحذّر ما دامت هناك محاولة غير محسومة؛
إغلاق العملية قسرًا أو تجاهل التحذير يفقد الذاكرة، ولا يُدّعى دعم استرداد دائم/Offline.
بعد فقد العملية يلزم تحقق تشغيلي من Audit/Idempotency قبل إعادة تنفيذ تعديل مجهول.

## الترحيل وملكية البيانات

`20260831110000_sales_item_selling_profiles`: جدول Sales واحد، سعرDecimal(19,4)،
CHECK>=0، version>=1، تفرد company/item، و5FK Restrict للشركة ومراجعها. لا backfill
لسعر مخترع، ولا hard delete. rollback تشغيلي غير هدّام: تعطيل Router/UI والإبقاء
على ملفات البيع والتدقيق. إضافة الصلاحيتين للأدوار النظامية ADMINISTRATOR فقط.

المحولات الجديدة في Inventory/Accounts/Tax/Companies تقرأ جداول مالكها فقط؛
Tax OUTPUT readiness يعاد استخدامه، ولا حاسبة ضريبة أخرى. الكتابة والنسخة وAudit
وIdempotency في المعاملة نفسها. لا Ledger أو Outbox أو شبكة ضمن المعاملة.

## ما تم التحقق منه محليًا

- 45 اختبار API مخصص ناجح: سياسة، خدمة، Router، عقد، محولات وبوابات معمارية.
- 6 اختبارات DB موجودة لكنها skipped صراحة لعدم إعداد بيئة معزولة للمحركين.
- 10 اختبارات Web ناجحة: دقة الصفر/الحد الأقصى، المراجع المفقودة، تعطيل القديم،
  تطابق اللغات، unknown/نفس المفتاح والجسم، refresh/remount/late outcome والعزل والحد.
- TypeScript API source + API test وWeb ناجحة مع GOMAXPROCS=2 وGOMEMLIMIT=1536MiB.
  المحاولة غير المحدودة الأولى تعثرت بسبب Windows commit memory؛ لا اعتبرت نجاحًا.
- `contracts:check` ناجح:169 request bodies و2132 response bodies.
- route parity ناجح. guardrails نجح50/51 أولًا؛ أذن المنسق بمزامنة سطري الصلاحية
  في seed فقط، وأعيد الحارس المتأثر منفردًا ونجح1/1 بعد الإصلاح؛ بقية50 تخطيت في هذه
  الإعادة المستهدفة فقط، وكانت ناجحة في الجولة السابقة.
- Prisma7.9.1 تولد بالمساعد المعزول المعتمد داخل apps/api/node_modules/.prisma/client
  الحقيقي على D. لم يجر توليد أو تثبيت داخل junction الاعتماديات المشترك.
- `git diff --check` ناجح. لم تجر جولة اختبار شاملة إضافية احترامًا للموارد المشتركة.

أوامر الاختبار المخصصة من apps/api وapps/web على الترتيب:

```text
node ../../node_modules/vitest/vitest.mjs run --config vitest.track-r2.config.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

## بوابات لم تنفذ ولا يجوز تخطيها

1. MariaDB10.11 وMySQL8.4: fresh migration، وترقية baseline مأهولة، وDB E2E
   وFK/rollback/تزامن/Idempotency والبيع الحقيقي بعد ربط R0/R1.
   الموجود محليًا MariaDB10.4 ليس بديلًا ولم يتصل به R2.
2. اختبارات R2 الفعلية لا تستخدم DATABASE_URL العام. يتطلب تشغيلها
   `RUN_R2_DB_TESTS=true` و`R2_DATABASE_URL` لقاعدة مؤقتة يبدأ اسمها test_ أوr2_test_
   و`R2_DB_MIGRATION_MODE=fresh|upgrade`. ترفض إصدار محرك غير المطلوب.
   في upgrade أنشئ مسبقًا InventoryItem fixture باسم `R2 upgrade sentinel` قبل
   migration الجديدة ومرر معرفه `R2_UPGRADE_SENTINEL_ITEM_ID`؛ يثبت بقاءه وعدم
   توليد سعر له. بقية fixtures جديدة ومقصورة على قاعدة CI ولا تنظف بيانات عامة.
3. Redocly غير متوفر في نسخة R2؛ لم يُنزّل. لدى R0 نسخة offline وسيشغله بعد التجميع.
4. build/الحزمة الشاملة وUI E2E للتركيب الفعلي و390/768/1440 والأجهزة الفعلية
   عند R0. لم ينفذ R2 فحص متصفح حي للمحرر المستقل؛ اختبارات حالة/نوع ليست دليلًا بصريًا.
5. Barcode Impact: R1 يحل الرمز عبر scanner الحالي ثم GET بالمعرف، ويمنع Checkout
   خلال القراءات ويحمي تعديل الكاشير والاستجابة القديمة. قبول قارئ/طابعة فعلية ما زال
   بوابة إطلاق، وليس نجاح fixture أو محاكاة.

## قائمة المراجعة

الملكية/Ports/العزل/Decimal/نسخة/Idempotency/Audit وعقد مولد: منفذة ومختبرة محليًا.
Migration: توسعية ومفحوصة بنيويًا فقط؛ الاختبار الفعلي أعلاه إلزامي قبل الدمج.
Ledger/التسوية/الرمز البشري/الأحداث/إعادة كلمة المرور: لا تغيير. لا dependency جديدة
أو اعتماد مكتبة يحتاج تقييمًا. مصدر الخريطة وBarcode Impact والعقد محدثة. أذونات
النشر أو تشغيل CI عبر رفع PR ليست ضمن هذا التسليم.

## متابعة الربط: خيارات العملات المسموحة بصفحات

commit التنفيذ المستقل: `97d8931f305855733917264307ac4971de5dab3e`.
أضيف `GET /currencies/options` داخل Companies فقط، بالـoperationId
`listEnabledCurrencyOptions` و`CompanyService.listEnabledCurrencyOptions`.
يفرض Router صلاحية `currencies.view` قبل التحقق من query أو فتح استعلام بيانات.
مسار `/currencies` القديم وعقده لم يتغيرا.

- query صارم بلا مفاتيح إضافية: page افتراضي1 وحد1..10000، pageSize افتراضي20
  وحد1..100، search نص اختياري يقص الفراغات وحد100 بعد القص ويرفض محارف التحكم.
- DTO: `{data:[{id:string,code:string,nameAr:string,decimals:integer}],meta}`؛
  meta يحمل page/pageSize/total/totalPages. المعرف نص دون تحويله إلى Number.
- العضوية محصورة بشركة الجلسة وcompanyCurrency.isActive؛ العملة نفسها فعالة،
  وإما GLOBAL بمالكnull أو COMPANY بمالك شركة الجلسة. لا أسعار صرف أو بيانات شركة.
- count وfindMany يستخدمان where نفسه داخل معاملة قراءة محدودة، والصفحة تنفذ
  في DB بـskip/take وترتيب currency.code ثم currencyId؛ لا تحميل شامل ثم قص بالذاكرة.
- OpenAPI1.46.1 ومدقق الاستجابات المولد محدثان، بما فيهما رفض حقول تسريب إضافية
  وحد100 للنتائج، والأخطاء400/401/403/500/504. تحررت ملكية العقد للمنسق بعد التسليم.

نجح34 اختبارًا في4ملفات: currency-options/company-service/company-router-guards/
openapi-route-parity. تشمل ترتيب auth، فلاتر العزل والتفعيل، count/page/select،
الحدود والأخطاء، ومدقق الاستجابة الفعلي داخل التطبيق لا التحقق اليدوي وحده.
نجح TypeScript لمصدر API واختباراته، و`contracts:check` بـ169 request bodies
و2138 response bodies، و`git diff --check`.

أوامر إعادة الفحص المحدود، مع TEMP/TMP داخل نسخةD وGOMAXPROCS=2 وGOMEMLIMIT=1536MiB:

```text
# من apps/api، worker1 وتسلسلي
node ../../node_modules/vitest/vitest.mjs run --config vitest.track-r2-currency-options.config.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.test.json --pretty false
# من جذر النسخة
node scripts/generate-openapi-guards.mjs --check
```

اختبارات الاستعلامات هنا fixture/mocks وليست إثبات تنفيذ على المحركين الفعليين.
لم يتغير schema أو seed أو صلاحيات أو app/server أو الواجهة، ولم يجر Prisma generate
أو اتصالDB أو تنزيل أو جولةاختبار شاملة. تبقى بوابات DB fresh/upgrade/E2E والإصدار
المذكورة أعلاه كما هي، ولا يعتبر هذا التسليم إذنًا أو دليلًا للنشر.
