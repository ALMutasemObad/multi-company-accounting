# تسليم W1: فصل سياسة بدء النشاط عن grandfathering

التاريخ: 31 أغسطس 2026. العمل محلي فقط في
`D:/CodexWorktrees/wave1-onboarding-policy`، الفرع `fix/wave1-onboarding-policy`،
والأساس `c7ffc99306a180387bb1a618d0d2750f762bf48b`.

## العقد المنفذ

- يملك Platform Subscriptions السياسة والكتابة. Company provisioning يمرر عبر
  `provisionNewCompanyAccess` معرف الشركة وعملتها وتاريخ إنشائها داخل معاملة التجهيز
  نفسها، فقط عند `tenant.created`. لا كتابة اشتراك مباشرة لدى التسجيل أو Tenant.
- مصدر الاختيار `PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID` في بيئة الخادم؛ معرف
  إصدار unsigned BIGINT نصي صريح، بلا default أو تحويل Number. يلتقطه composition
  عند إنشاء الخدمة. تغيير الإعداد يحتاج إعادة إنشاء الخدمة/تشغيلها. ليس حقل API أو
  خيارًا من المتصفح؛ `planId` الإضافي مرفوض في مدخل provisioning الصارم.
- **الإعداد التجاري الفعلي متروك فارغًا.** لم تعتمد باقة أو سعر أو حصص أو مدة تجربة،
  ولم تعدّل env أو seed أو حسابات. جميع قيم الاختبارات fixtures محلية فقط.
- يعاد التحقق داخل transaction: الإصدار موجود، منشور قبل بدء الشركة، خطته نشطة،
  effectiveFrom وصل، retiredAt فارغ، كوده ليس Legacy، وسياسة `IMMEDIATE_FREE`.
  الرسم الأساسي وأسعار الاستهلاك الثلاثة Decimal صفر صريح؛ null سعر غير مهيأ
  يرفض كما يرفض الرسم الموجب، ولا يحول null إلى صفر. هذا يحافظ على اكتمال لقطة
  الفوترة بدل السماح بسقوطها إلى أسعار PlatformBillingAccount القديمة.
  العملة تطابق عملة الشركة؛ الإعداد الواحد لا يقدم تلقائيًا خطة لعملات أخرى.
- الحصص الثلاث يجب أن تكون مهيأة وصحيحة كما يشترط النشر. لا overrides أو قيم بديلة:
  الاشتراك يشير إلى الإصدار immutable نفسه فتظل حصصه وأيام تجربته هي المصدر.
  `trialDays=0` ينشئ ACTIVE؛ الأيام المعتمدة في الإصدار تنشئ TRIALING وtrialEndsAt
  محسوبًا منها. لا تجربة لخطة مدفوعة ولا خطة لاحقة أو تحويل مدفوع تلقائي.
- تمنح INCLUDED فقط، مع التحقق من نشاط الموديولات وأكوادها وإغلاق اعتمادياتها
  وخلوها من الدورات. لا optional، ولو مجانيًا؛ الحزمة الفارغة تبقى فارغة.
- المصدر `PLAN` للاستحقاقات، والتغيير `APPROVED / PLATFORM_OPERATOR` بمعنى
  **إعداد الخادم الذي يديره المشغل**، لا إجراء شخص بشري أو طلب مالك نشاط. لا فاعل
  مصطنع: requestedById/decidedById فارغان. السبب المثبت:
  `Server-configured new-company start policy`.

## الفشل والقديم والرجوع

- غياب/فساد الإعداد أو عدم أهلية الإصدار يرمي `SubscriptionStartPolicyError` داخليًا
  بلا Legacy fallback. لا إنشاء خطة أو نشرها تلقائيًا.
- التسجيل يحافظ على start/resend الموحدين بغض النظر عن وجود الهوية؛ لم يضف فحصًا
  يعتمد على وجود الحساب. verify يترجم الخطأ إلى `503 PROVISIONING_FAILED` العام
  القائم، ويعيد الطلب إلى EMAIL_VERIFIED بعد rollback؛ لا يسرب سبب الإعداد أو الحساب.
- فشل السياسة أو أثر completion لاحق يلغي الشركة والهوية والدليل والاشتراك
  والاستحقاقات والتغيير داخل معاملة provisioning نفسها. يحتفظ claim/سجل فشل التسجيل
  بدورته الحالية المنفصلة. يمكن إعادة token غير المنتهي بعد إصلاح الإعداد.
- COMPLETED replay يعيد النتيجة السابقة دون قراءة السياسة. الشركة الموجودة لا
  تستدعي منفذ البدء؛ adapter كذلك لا يمس اشتراكًا موجودًا عند replay. لا إعادة تصنيف
  أو سحب حق أو تعديل Legacy/GRANDFATHERED/MIGRATION تاريخي.
- grandfathering بقي بتنفيذه السابق خلف منفذ منفصل `PlatformSubscriptionGrandfatheringPort`
  للاستخدام الصريح في migration/seed القديم فقط؛ لا يُحقن في التجهيز التشغيلي.
- تظل حماية التزامن لدى المعاملة Serializable والتفرد القائم للشركة/الاشتراك؛
  registration يستخدم TransactionExecutor وإعادة المعاملة المصنفة والمحدودة.
  adapter لا يبتلع P2002 ولا يضيف retry داخليًا. CLI provisioning يحتفظ بسلوكه السابق
  (Serializable دون إضافة آلية retry جديدة).
- الرجوع الآمن: تعطيل استقبال التسجيلات الجديدة أو إبقاء الإعداد غير مهيأ، مع بقاء
  حقوق الموجودين؛ أو تصحيح معرف إصدار معتمد للمحاولات المقبلة. لا تعتمد إعادة كود
  Legacy للجديد كـrollback. لا DDL مطلوب ولا حذف تاريخ أو تحديث جماعي للحسابات.

## الملفات والاختبارات المكتوبة

ملفات المصدر: `platform-subscriptions/new-company-start-policy.ts` و
`prisma-new-company-subscription-provisioning-adapter.ts`، ومنافذ
`platform-entitlement-ports.ts`، وتغيير واجهة adapter القديم فقط، وربط
`platform/company-provisioning-service.ts` و`composition/create-company-provisioning-service.ts`.

الاختبارات: `new-company-start-policy.test.ts`، وتوسعة
`company-provisioning.test.ts` و`registration-service.test.ts`، وتحديث
`company-provisioning.integration.test.ts` و`self-registration.integration.test.ts`
مع `subscription-start-plan-fixture.ts`. cleanup لا يفترض ملكية خطة مشتركة لكل شركة؛
يحذف legacy الخاصة فقط ثم fixture الاختبار التي يملكها.

تشمل الحالات: إعداد غائب/فاسد، BIGINT، سعر أساسي/متغير موجب، العملة، التاريخ،
الحصص، الاعتماديات، optional، replay، حماية القديم، التسجيل الجديد، concurrent
verification، rollback قبل وبعد إنشاء الاشتراك، وإعادة المحاولة بعد إصلاح السياسة.
أضيفت ست حالات مكتوبة لرفض null في كل سعر استهلاك: ثلاث عند policy وثلاث عند
adapter تثبت الرفض قبل جميع الكتابات وعدم تحويل القيمة المفقودة إلى صفر.
أصبحت fixtures المقبولة تحدد الأصفار الثلاثة صراحة، دون اعتماد خطة فعلية.
أضيف كذلك اختبار مكتوب يستدعي قارئ لقطة الفوترة الحقيقي بعد provision وهمي مقبول،
ويثبت عدم رجوع اللقطة null واحتفاظها بمعرف الإصدار والحصص والأصفار الأربعة؛ لا تعديل
لمالك الفوترة أو fallback، وهذا دليل اختبار مكتوب لم ينفذ تحت قيد الموارد.

## الأدلة الفعلية والحدود

- قراءة AGENTS ومراجعه السبعة ثم START ووثائق المسار تمت؛ مراجعة مستقلة كشفت حصص
  null غير المتوافقة مع publish، وأصلحت دون اختراع حدود.
- مراجعة المنسق اللاحقة أثبتت أن غياب سعر استهلاك يبطل
  `PrismaPlatformBillingSubscriptionSnapshotAdapter` ويسمح بمسار account pricing
  في الفوترة. أُغلق ذلك في سياسة البدء فقط باشتراط الأصفار الصريحة؛ لم يعدل billing
  fallback أو حساب فوترة أو مصدر/سعر تجاري، ولم تشغل اختبارات بعد هذا التصحيح.
- `git diff --check`: ناجح وقت المراجعة؛ تحذيرات LF/CRLF فقط.
- `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.test.json --pretty false`:
  exit1؛ 11 خطأ في المصدر/اختبارات Sales بسبب Prisma Client المشترك القديم الذي
  لا يملك `salesItemSellingProfile`. لا خطأ مسجل حينها في ملفات W1. لم يُنفذ generate.
  تمت إضافات اختبارات لاحقة؛ هذه ليست شهادة نجاح typecheck للرأس النهائي.
- unit والحواجز واختبارات DB: لم تنفذ بعد بسبب وقف المنسق العمل الثقيل تحت ضغط C.
  توجد إعدادات Vitest مع cache على D وconfigLoader=native؛ لا حاجة للكتابة في junction.
- استكشفنا XAMPP binary10.4.32 فقط، دون خدمة مستخدم عاملة. بموافقة المنسق
  أُنشئ datadir اختبار جديد على D وشُغلت عملية خاصة PID11064 مع --no-defaults،
  bind127.0.0.1:3317، buffer64MiB/maxConnections12. حارس هوية الاتصال رفض قبل CREATE
  DATABASE (قيمة port تحتاج تطبيع نوع bigint)؛ لم تطبق migrations أو seed أو DB tests.
- بعد قيد الموارد أغلقنا العملية graceful عبر SHUTDOWN بعد مطابقة @@datadir/port؛
  ثبت version10.4.32، وأصبح3317 بلا listener. لم نمس خدمة أو بيانات XAMPP القديمة.
  datadir/logs محفوظة على D بلا حذف. لا قاعدة jawar منشأة بعد.
- يلزم لاحقًا تشغيل بوابتي MariaDB10.11/MySQL8.4؛ نجاح10.4 إن نفذ لا يستبدلهما.
  كما يلزم إعادة types بعد توفير generated client مطابق بمعزل عن junction.

أوامر الجولة المحدودة المعدة (تنفذ فقط بعد تخصيص الموارد):

```powershell
. ./tmp/coordination/check-env.ps1
& $env:CODEX_MCP_NODE_PATH node_modules/vitest/vitest.mjs run --config tmp/coordination/vitest.config.mjs --configLoader native --maxWorkers 1 --no-file-parallelism tests/new-company-start-policy.test.ts tests/company-provisioning.test.ts tests/registration-service.test.ts tests/registration-router.test.ts tests/platform-subscription-foundation.test.ts tests/architecture-guardrails.test.ts
```

TEMP/TMP/npm cache/Node cache/Vite cache/logs كلها داخل `tmp/coordination` على D؛
GOMAXPROCS=2 وGOMEMLIMIT=1536MiB وعامل اختبار1. لا npm install/ci، ولا generate،
ولا كتابة ضمن node_modules. لا بريد حقيقي، دفع، طباعة، اتصال إنتاج أو workflow خارجي.

## فجوة DB E2E ومقترح الربط المشترك — لم ينفذ

فحص قراءة فقط أثبت أن `playwright.config.ts` ينسخ env في الأسطر8–10، ثم يشغل
`apps/api/dist/server.js` عند36 ويفعّل التسجيل عند50 دون تهيئة إصدار البداية.
`reuseExistingServer` عند39 قد يعيد استخدام خادم بإعداد سابق.
`tests/e2e/onboarding-and-first-document.spec.ts` يسجل YER عند76 وينتظر النجاح
عند90؛ بقية الرحلة عند136–153 تحتاج DATA_IMPORT وSALES وCORE_ACCOUNTING.
fixture API ذات CORE_ACCOUNTING وحده لا تكفي لهذه الرحلة.

النداءان المتأثران في `.github/workflows/ci.yml` هما `npm run e2e` في
hosting-compatibility/MariaDB10.11 عند89–90، وverify/MySQL8.4 عند279–280.
يسبقهما seed/build القائمان؛ لا يعني وجود seed القديم أنه يهيئ سياسة النشاط الجديد.
اختبارات API DB تستخدم fixtureAPI التي تمرر معرف الإصدار مباشرة ولا تحتاج env عامًّا.

الاقتراح المرسل للمنسق، قبل تخصيص الملفات المشتركة:

1. إضافة wrapper اختبار فقط `scripts/e2e/run-db-e2e.mjs`، وربطه في
   `package.json` بدل أمر `e2e` الحالي. تبقى نداءات CI الحالية `npm run e2e` إن
   اعتمد هذا الخيار؛ لا حاجة لتغيير app.ts/server.ts أو root composition آخر.
2. قبل تحميل Playwright config/تشغيل الخادم: يتحقق wrapper صراحة من localhost
   وقاعدة اختبار disposable ومن عدم استهداف بيانات مستخدم/بيئة إنتاج، ثم ينشئ
   fixture جديدة ذات code UUID ومعرف إصدار مولد من DB في transaction واحدة.
3. fixture YER منشورة وIMMEDIATE_FREE بأسعار أربعة صفرية صريحة وحصص اختبار
   صريحة وتواريخ صالحة، وبحزمة INCLUDED تضم CORE_ACCOUNTING وSALES وDATA_IMPORT
   واعتمادياتها النشطة المتعدية من الكتالوج. لا optional، لا Legacy، لا اعتماديات
   مفقودة أو صامتة. لا يعاد استخدام خطة تجارية أو معرف ثابت أو seed إنتاج.
4. يمرر wrapper معرف الإصدار كنص في
   `PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID` إلى بيئة child Playwright قبل
   تحميل config، ثم ينتظر child وينقل exit code. لا تكفي تهيئة beforeAll أو
   globalSetup متأخرة لتعديل بيئة خادم بدأ فعلًا.
5. يغيّر مالك الربط `playwright.config.ts` لمنع reuseExistingServer لهذه البوابة؛
   الخادم والـDB وfixture والـenv يجب أن تخص الجولة نفسها. تبقى عملية المتصفح ضمن
   نافذة الموارد المخصصة، وملفاتها على D في التشغيل المحلي.
6. توثيق واختبار حارس wrapper قراءة/وحدة مستقلة قبل تشغيل DB. لا حذف fixture
   المشار إليها من اشتراك/تاريخ جديد عند cleanup؛ التخلص من قاعدة ephemeral شأن
   مالك بوابة CI فقط، دون reset/drop لقاعدة مستخدم.

**لم تعدّل ملفات package/Playwright/CI أو تضف wrapper بعد؛ هذا مقترح ينتظر تخصيص
الملكية. لا توجد نتائج DB E2E معتمدة لهذه الدفعة.**

## قائمة المراجعة والقبول المتبقي

- الملكية/ACID/العزل/Decimal محفوظة؛ لا تغيير RBAC/CSRF أو endpoint/OpenAPI/schema.
- لا أحداث أو Outbox جديدة بلا مستهلك، ولا تعديل Ledger أو جداول سياق آخر.
- Barcode Impact: N/A؛ لا تغيير إدخال/اختيار صنف أو POS أو طباعة/إخراج مستند.
- لم تتغير docs عامة مشتركة أو App/PosPage/Printing أو root server wiring.
- لا push أو PR أو merge أو deploy. بسبب ضغط Git metadata على C، التسليم الحالي
  ملفات محفوظة وpatch على D، بلا commit حتى يخصص المنسق نافذة آمنة.
- نسخة patch السابقة محفوظة دون تغيير باسم
  `tmp/coordination/W1_ONBOARDING_POLICY.v1-599f553c.patch` وبصمة
  `599f553c181207b9942dcbd16bc988c8c7b1519e858ccc55516d1735c1d8499d`؛
  patch الحالي وmanifest محدثان في `tmp/coordination` بعد تصحيح الأسعار المفقودة.
- لا إطلاق قبل القرار التجاري لإصدار البداية وتوفير الإعداد وإغلاق بوابات الاختبار.
