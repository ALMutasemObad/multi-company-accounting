# تسليم S1: عرض الاشتراك والخطط والترقية الموثقة

التاريخ: 2026-08-31. المسار الوحيد للعمل:
`D:/CodexWorktrees/subscription-upgrade-experience`، الفرع
`feat/subscription-upgrade-experience`.

الأساس `9f98ddf` **مرشح PR45 غير المنشور، وليس main**. هذه شريحة منفصلة
قابلة للتركيب، ولا تدخل PR45 أو تؤخر بواباته. لم تُدمج أو تُنشر، ولم تنفذ
Push/PR/Merge/Deploy.

## ما نُفّذ

- `d590f97`: سياسة عرض، adapters لنتائج القراءات الحالية، عقد حقن حقائق المالك،
  منافذ تنقل يدوي، وإغلاق دعوة داخل الذاكرة، مع اختبارات السياسة.
- `d501859`: `SubscriptionUpgradeCard` و`SubscriptionUpgradeBanner`، قاموس
  ar/en/hi/ur مستقل، CSS واختبارات التصيير، وإعداد بناء مستقل.
- التوثيق في commit منفصل بعدهما؛ سجل الفرع يحدد معرفه.

الملكية المنطقية للحقائق لدى Platform Subscriptions & Entitlements. لا مالك
جديد للكتابة، ولا تغيير مجال/معاملة/استحقاق/RBAC. كل ملفات التنفيذ جديدة من
عائلة `SubscriptionUpgrade*` أو `subscription-upgrade-*`، ولم تُعدّل
App/CompanySubscriptionPage/SystemHomePage/PublicPlansPage أو الترجمات المجمعة
أو API/OpenAPI/generated/Prisma/reference data/package/lockfiles/CI.

## العقد والسلوك

العقد في `apps/web/src/subscription-upgrade-contract.ts`، والسياسة في
`apps/web/src/subscription-upgrade-policy.ts`، والتنقل في
`apps/web/src/subscription-upgrade-actions.ts`.

| حقيقة المدخل | النتيجة |
|---|---|
| لا نشاط محدد | لا مكوّن |
| فقدان view أو manage، بما فيه الموظف بصلاحية view فقط | إرشاد عام للتواصل مع المالك؛ لا حالة أو اسم خطة أو فوترة أو CTA إدارة |
| loading/error/unavailable أو فقدان الصف | لا ادعاء عدم اشتراك ولا دعوة شراء؛ شريط المنزل مخفي |
| `confirmed-absent` مثبت صراحة من المالك وفي نطاق الممثل والنشاط نفسه | زر «اشترك» يرسل نية فتح الكتالوج فقط |
| ACTIVE/TRIALING من اللقطة الحالية | اسم الخطة والحالة الفعليان ودعوة «عرض الخطط» المحايدة |
| PAST_DUE/SUSPENDED/CANCELED | الحالة الفعلية ومدخل مراجعة الاشتراك؛ لا عروض ترقية |
| pending/scheduled/cancelAtPeriodEnd | رسائل مستقلة عن الحالة؛ مراجعة الاشتراك وإيقاف الدعوة لترقية جديدة |
| رسم أساسي دوري صفري | وصف الرسم الصفري فقط، لا «مجاني بالكامل» أو «أساسي» |
| استحقاق GRANDFATHERED | وصول محفوظ لا يحدد مستوى الخطة؛ لا تغييرات للاستحقاق |
| لا علاقة ترقية موثقة/علاقة قديمة/هدف غائب من الصفحة | عرض خطط محايد؛ لا اختيار أول خطة أو بديل تلقائي |

لا تُستنتج الحالة من انتهاء تاريخ محلي، أو الاسم، أو planCode، أو السعر، أو
versionNumber، أو ترتيب صفحات الكتالوج، أو فراغ modules. الحالة تبقى إحدى
TRIALING/ACTIVE/PAST_DUE/SUSPENDED/CANCELED كما أعادها الخادم.

كل عرض ترقية يتطلب علاقة مالك صريحة من `fromPlanVersionId` إلى معرف الهدف،
ومطابقة `subscriptionVersion` و`generatedAt` ونطاق الممثل/النشاط و`readBatchId`.
تُعرض الأهداف الموجودة فعلًا في الصفحة المتاحة فقط، مع تنبيه pagination؛ لا
تُعد النتيجة الجزئية دليلًا على أن خطة معينة أعلى/الأعلى أو مفقودة من الكتالوج.
تُرفض الخطة غير المنشورة أو المؤرخة مستقبلًا أو المتقاعدة أو المعطلة للخدمة الذاتية.

المقارنة تعرض زيادة موثقة واحدة على الأقل، لكنها تعرض أيضًا التخفيضات والموديولات
غير المدرجة/الاختيارية. الموديول المعلن كمضمن يجب أن يكون نشطًا واعتمادياته
نشطة ومضمنة؛ لا وعود من مجرد code. null ليس صفرًا أو unlimited، ولا تقارن
حصة المستندات عبر دورات مختلفة. الرسوم لا تُحسب أو تُجمع في الشريحة، ولا توجد
حسابات مالية بـNumber؛ مقارنة الأعداد تخص الحصص فقط. الفروق المسجلة ليست
تفعيلًا أو ضمان صلاحية أو سعرًا نهائيًا.

## تركيب المكونات عند المنسق

1. مقترح البطاقة: داخل CompanySubscriptionPage بالقرب من عرض الخطة الحالية،
   قبل الدخول إلى اختيار/مراجعة تغيير الخطة. لا overlay أو إعادة ترتيب مسار التأكيد.
2. مقترح الشريط: موضع واحد في SystemHomePage، لا POS/الكاشير ولا كل شاشة أو فعل.
3. مرر `locale` من سياق اللغة الحالي، و`access` من تفويض النشاط المحدد، و`navigation`
   من منافذ التنقل الحالية. القاموس مستقل ولا يحتاج تعديل registry أو ar/en/hi/ur.
4. أنشئ `createSubscriptionUpgradeDismissals()` مرة واحدة لكل جلسة دخول، وأعد
   استخدامه عند remount. الإغلاق مقيد بالممثل والنشاط، ولا يعود بتغيير اللقطة أو
   اللغة؛ تخلص من المخزن عند الخروج. لا localStorage/sessionStorage أو مؤقتات.
5. لا تقرأ APIs الاشتراك أو الفوترة من أجل دعوة الموظف. الشريحة نفسها لا تعمل
   fetch ولا مؤثرات تحميل/كتابة.

الـadapters الحالية تستهلك **نجاح القراءة الفعلي** من `/subscription` و
`/subscription/catalog`. احتفظ بنطاق بدء الطلب، ولا تستبدله بالنشاط المحدد عند
اكتمال الطلب. مثال تركيب عقدي، مع نتائج API حقيقية فقط:

```ts
// Capture at the start of one combined, bounded, abortable read.
const scope = { actorId: user.id, companyId: selectedCompany.id };
const readBatchId = crypto.randomUUID();
// rawSnapshot/rawCatalog below must come from that successful read, not fixtures.
const subscription = subscriptionUpgradeFromSnapshot(scope, rawSnapshot, readBatchId);
const catalog = subscriptionUpgradeFromCatalog(scope, rawCatalog, observedAt, readBatchId);
const relationships = { state: 'unavailable' } as const;
```

جدّد `readBatchId` في كل تحميل مشترك ولا تلصقه على بيانات قديمة. تحديث صفحة
كتالوج بدون تحديث اللقطة لا يعيد استعمال جيل سابق لإظهار عروض جديدة. على المنسق
إلغاء/تجاهل القراءات المتأخرة عند تبديل النشاط أو التفويض، والتخلص من الحقائق
القديمة أثناء reload. فشل أحد الجزأين يبقى error/unavailable لا قائمة مصطنعة.

`openCatalog('compare')` و`openSubscription()` يفتحان المسار المحايد/المراجعة
الحالي. `reviewUpgrade({ targetPlanVersionId, subscriptionVersion })` لا يرسل
أمر تغيير: يثبت اختيار المستخدم للمراجعة القائمة، ويعيد جلب/فحص الإصدار قبل
التأكيد. عند غياب الاختيار لا يُختار بديل تلقائي، وتبقى optional modules اختيارًا
يدويًا؛ لا توصل المنفذ مباشرة إلى POST أو دفع. فحص التفويض في الواجهة ليس بديلًا
عن RBAC/CSRF/Idempotency/Version في الخادم.

## الفجوتان المعتمدتان: لا fixtures للإنتاج

**الـadapter الحالي يتيح View plans/مراجعة محايدة فقط؛ لا ينتج confirmed-absent
أو علاقة ترقية.** هاتان حقيقتان تحتاجان عقدًا حقيقيًا من مالك الاشتراكات ومسار
بدء اشتراك حقيقي قبل استخدامهما بالإنتاج. تعريف union محلي ليس endpoint جديدًا
ولا إثباتًا من الخادم. fixtures محصورة في ملفات الاختبار ولا تُستورد من التنفيذ.

- غياب صف الاشتراك يرمي NOT_FOUND في
  `apps/api/src/platform-subscriptions/platform-subscription-service.ts:697`.
  الكتالوج يشترط الصف عند السطر756، وأمر تغيير الخطة عند السطر805.
  لذلك لا يُحوّل HTTP404 أو null أو error إلى «غير مشترك».
- لا tier/rank في `apps/api/prisma/schema.prisma:3053` أو
  `apps/web/src/types.ts:154`. ترتيب ownerCatalog هو effectiveFrom/id عند
  `platform-subscription-service.ts:770`. قوالب FREE/TRIAL/BASIC في
  `apps/api/prisma/migrations/20260830150000_platform_subscription_lifecycle/migration.sql:150`
  drafts معطلة وغير منشورة، وBASIC بلا سعر؛ ليست تعريف ترتيب تجاري جاهز.

## إثبات فجوة تجهيز النشاط الجديد

**التسجيل الجديد يحصل حاليًا على Legacy full access أيضًا؛ ليس الأمر مقصورًا
على المهاجرين.** هذه فجوة تجهيز مستقلة، وثّقها المنسق مانع جاهزية قبل عميل
مدفوع إلى أن تُعتمد سياسة تجهيز وخطط وأسعار وعقودها. لم تعالجها S1 بإعلان أو
بتغيير استحقاقات Legacy، ولا تُدخلها هذه الشريحة في PR45.

سلسلة المصدر عند الأساس `9f98ddf`، كلها قُرئت دون تعديل:

| الخطوة | الدليل |
|---|---|
| إنشاء RegistrationService مع التجهيز الفعلي | `apps/api/src/server.ts:129`، وتمريره للتطبيق عند268 |
| تركيب مسار التسجيل والتحقق | `apps/api/src/app.ts:356`، `apps/api/src/registration/registration-router.ts:45` |
| تحقق التسجيل ينشئ نشاط MAIN تحت منظمة SELF | `apps/api/src/registration/registration-service.ts:274` يستدعي provisionPreparedInTransaction |
| حقن adapter اشتراك حقيقي | `apps/api/src/composition/create-company-provisioning-service.ts:17` |
| تطبيق الاشتراك عند tenant.created | `apps/api/src/platform/company-provisioning-service.ts:85` |
| created تعني عدم وجود الشركة قبل التجهيز | `apps/api/src/companies/company-provisioning-adapter.ts:51` |
| LEGACY_COMPANY_* وLegacy full access ورسم0 | `apps/api/src/platform-subscriptions/prisma-company-subscription-provisioning-adapter.ts:18` |
| ACTIVE وكل الموديولات النشطة GRANDFATHERED | الملف نفسه:36،49،59 |
| مصدر MIGRATION مسجل حتى في هذا المسار الجديد | الملف نفسه:70 |

الاختبار الموجود `apps/api/tests/company-provisioning.integration.test.ts:100`
يثبت ACTIVE وGRANDFATHERED للموديولات النشطة. اختبار التسجيل
`apps/api/tests/self-registration.integration.test.ts:131` يستعمل التركيب نفسه،
ويختبر إتمام التسجيل عند174 لكنه لا يؤكد حالة الاشتراك مباشرة. **لم تُشغّل
اختبارات DB هذه في S1**؛ هذا دليل مصدر وقراءة، واختبارات S1 الجديدة تثبت فقط
تفسير واجهة العرض لتلك الحقائق، مع حالتي new-business/legacy-migrated وحالة
missing-row، ولا تدّعي تشغيل تسجيل حقيقي.

## الأدلة التنفيذية وحدودها

كل الأوامر نُفذت في شجرة S1 على D، دون install/ci/Prisma generate أو كتابة
cache في junction الاعتماديات. TEMP/TMP وnpm cache وVite/build تحت
`tmp/subscription-upgrade` في الشجرة نفسها. GOMAXPROCS=2 وGOMEMLIMIT=1536MiB،
Vitest worker واحد وfileParallelism=false وcache معطل، وconfigLoader=native
لتجنب `.vite-temp` في الاعتماديات المشتركة.

| التحقق | النتيجة |
|---|---|
| اختبارات الشريحة + ارتداد subscription safety/usage/public plans/entitlements/authorization | **103/103**، سبعة ملفات؛ 53 للشريحة و50 ارتدادًا |
| كامل أنواع apps/web، noEmit وincremental=false | exit0 |
| Vite8.2 بناء library مستقل للمكونات والسياسة | exit0، عشرة modules؛ ملفات ESM وCSS تحت tmp/subscription-upgrade/build |
| i18n guard | نجح |
| UI guard | نجح: 27 page headers و67 table regions في المشروع |
| مراجعة مستقلة قراءةً | أغلقت خطري خلط أجيال القراءة وJSON الناقص؛ لا مانع جديد |
| git diff --check | نجح |

أوامر إعادة التحقق من جذر S1، مع Node المتاح محليًا دون تثبيت:

```powershell
$env:TEMP = 'D:/CodexWorktrees/subscription-upgrade-experience/tmp/subscription-upgrade/temp'
$env:TMP = $env:TEMP
$env:npm_config_cache = 'D:/CodexWorktrees/subscription-upgrade-experience/tmp/subscription-upgrade/npm-cache'
$env:GOMAXPROCS = '2'
$env:GOMEMLIMIT = '1536MiB'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$s1Node = 'C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $s1Node node_modules/vitest/vitest.mjs run --config subscription-upgrade-vitest.config.mjs --configLoader native --maxWorkers=1 --no-file-parallelism --no-cache
& $s1Node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false --pretty false
& $s1Node node_modules/vite/bin/vite.js build --config subscription-upgrade-build.config.mjs --configLoader native
& $s1Node scripts/check-web-i18n.mjs
& $s1Node scripts/check-web-ui.mjs
```

السجلات الفعلية المحلية: `tmp/subscription-upgrade/unit-regression.log` و
`typecheck.log` و`build.log` و`i18n.log` و`ui.log`؛ غير مضافة إلى Git.
البناء يتحقق من قابلية تحزيم الشريحة غير المربوطة، وليس بناء تطبيق مدمج أو دليل
ظهورها للمستخدم. اختبارات التصيير React SSR واختبارات الأفعال تثبت أن المنافذ
لا تُستدعى إلا يدويًا؛ ليست اختبار نقر/جهاز في المتصفح.

لا خادم أو متصفح أو لقطة بصرية أو DB E2E أو اختبارات MariaDB10.11/MySQL8.4
أو استضافة في S1. المنفذان3160/4210 لم يُشغّلا. نافذة المتصفح بقيت لـS2 حسب
المنسق. قبول RTL/LTR اللمسي والتخطيط بعد التركيب يحتاج نافذة متصفح لاحقة؛ CSS
يستخدم مقاسين فقط 1rem و1.25rem وأزرارًا بحد أدنى44px، دون عناوين ضخمة أو
خط زخرفي. بوابات DB تبقى عند المنسق عند إضافة عقد أو تجهيز أو كتابة ذات صلة؛
الاختبارات الوحدوية هنا لا تستبدلها.

## Barcode Impact ومراجعة الحدود

لا تغيير Inventory/Sales/Purchases/POS/Data Import/Printing/Export أو اختيار
صنف أو باركود أو مستند/لقطة طباعة. لا scanner أو codec جديد، ولا حجب كاشير،
ولا اختبار طباعة/جهاز مزعوم. المكونات محايدة القناة وتحفظ RTL/LTR ولا تنقل قواعد
الأعمال أو صلاحيات الخادم إلى المتصفح.

لا Prisma/SQL/Migration/Outbox أو حسابات Ledger أو تعديل CSRF/صلاحية/استحقاق،
ولا dependency جديدة أو موديول مفتوح المصدر جديد؛ استُخدم React/Vite/Vitest
الموجود. لا تغيير خريطة سياقات أو عقد JSON عام يستلزم توليدًا. الرجوع عن S1 هو
إزالة ملفاتها/ربطها لدى المنسق؛ لا ترحيل أو بيانات يحتاجان عكسًا.
