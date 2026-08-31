# تسليم W1: بوابة DB E2E لسياسة بدء النشاط

31 أغسطس 2026. العمل محلي في `D:/CodexWorktrees/wave1-onboarding-policy`،
الفرع `fix/wave1-onboarding-policy`، والأساس
`c7ffc99306a180387bb1a618d0d2750f762bf48b`. لا commit أو نشر.

هذه حزمة مستقلة عن patch المجال E90D؛ يجب مراجعة الحزمتين وتطبيقهما معًا قبل
قبول بوابة التسجيل. بقي `W1_ONBOARDING_POLICY.patch` بلا تغيير وببصمة
`e90d21b9eab131d3912aa48f1401bdfa7e0d3484772b97fee1c61b3b08663092`، وكذلك
الأرشيف 599F. فقرة «مقترح الربط — لم ينفذ» داخل تسليم المجال تؤرخ لحالته وقت
إنتاج E90D؛ هذه الوثيقة تسجل تنفيذ الربط بعد تخصيصه، دون تعديل الوثيقة المؤرشفة.

## نطاق الملفات

- `scripts/e2e/run-db-e2e.mjs`: wrapper التحضير والتشغيل للبوابة الأصلية فقط.
- `scripts/tests/onboarding-e2e-wrapper.test.mjs`: اختبارات حارس مكتوبة بحقن
  اتصال وعملية وهميين؛ لا تحتاج DB أو تشغيل Playwright عند تنفيذها لاحقًا.
- `package.json`: سطر `e2e` فقط؛ `e2e:list` وبقية بوابات HTTP fixtures بلا تغيير.
- `playwright.config.ts`: `reuseExistingServer: false` فقط.
- `.github/workflows/ci.yml`: إقرار `E2E_DISPOSABLE_DATABASE: test_mcap_finance`
  في خطوتَي `npm run e2e` لـMariaDB/MySQL فقط، دون jobs أو secrets أو permissions.
- هذه الوثيقة. لا app/server جديد أو schema أو OpenAPI أو lockfile أو dependencies
  أو compiled output أو تعديل لملفات سياسة المجال.

## عقد السلامة والتحضير

قبل استيراد عميل DB، يرفض wrapper بيئة production أو URL غير MySQL أو غير محلي،
وquery/fragment أو مسار قاعدة ملتبس. يقبل loopback الصريح فقط؛ يحول localhost إلى
127.0.0.1 حتى لا يغير hosts file وجهة الاتصال. يلزم اسم قاعدة اختبار مطابق تمامًا
للإقرار `E2E_DISPOSABLE_DATABASE`؛ CI=true أو loopback وحدهما لا يكفيان.
الأسماء المسموحة `test_*` أو `*_test` بأحرف صغيرة وأرقام وunderscore،
حتى64 حرفًا، دون token باسم prod/production. هذا الإقرار مسؤولية مشغّل بوابة
الاختبار؛ لا يجعل قاعدة تطوير مستخدم disposable بمجرد إعادة تسميتها.

يتحقق كذلك من أصل E2E محلي http فقط، دون credentials أو path إضافي أو query.
يرفض https قبل التحضير؛ خادم البوابة القائم HTTP فقط، دون تعديل TLS أو server.
الافتراضي `http://127.0.0.1:3200`. بعد فتح الاتصال يتحقق داخل transaction من
`DATABASE()` و`@@port` ومطابقتهما للهدف المقر به **قبل قراءة الكتالوج أو أي كتابة**.
يطبع فشلًا ثابتًا فقط، دون URL أو credentials أو message/cause/stack من driver.
مخرجات child الاعتيادية تبقى مخرجات Playwright؛ لا يطبع wrapper بيئته أو إعداداته.

لا ينشئ wrapper قاعدة أو migrations أو seed عامًا، ولا يحدث أو يحذف تاريخًا
أو خطة موجودة. يحتاج قاعدة اختبار جاهزة، وكتالوجًا وYER نشطة سبق أن جهزتهما
بوابة الاختبار القائمة. يستورد `apps/api/dist/database.js` الموجود بعد الحارس
فقط؛ غياب build أو migrations أو الكتالوج يفشل صراحة، بلا install/generate/fallback.

داخل Serializable واحدة وبحد زمني15 ثانية ينتج خطة اختبار ذات code UUID، ثم
إصدارًا YER منشورًا، غير معروض للعامة، IMMEDIATE_FREE، MONTHLY، trialDays=0،
والرسم الأساسي وأسعار الاستهلاك الثلاثة كلها Decimal نصي `0` صريح.
حدود workload الاختبار:10 مستخدمين،10 موظفين،100 مستند مرحل؛ taxRate=0 وpaymentTermsDays=0.
هذه fixtures فقط، وليست قرار باقة أو سعر أو حصص أو تجربة للأنشطة الحقيقية.
effectiveFrom وpublishedAt من ساعة DB قبل الكتابة؛ لا actor بشري مصطنع.

الحزمة INCLUDED تضم CORE_ACCOUNTING وSALES وDATA_IMPORT واعتمادياتها المتعدية
من الكتالوج الفعلي. تتحقق من النشاط وإغلاق الاعتماديات والدورات؛ القراءة محدودة
بـ256 موديول و4096 علاقة، مع صف زائد لكشف التجاوز. لا منح optional أو وحدات غير
مرتبطة. additionalRecurringFee للموديول INCLUDED يبقى null كما يشترط عقد المجال؛
هذا يختلف عن أسعار الاستهلاك الثلاثة التي يجب أن تكون صفرًا صريحًا.

يغلق `$disconnect()` في finally عند النجاح أو فشل transaction. لا يبدأ child
إذا فشل التحضير أو الإغلاق، ولا توجد إعادة محاولة آلية أو إنشاء fixture ثانية.
بعد الإغلاق فقط يمرر معرف الإصدار المولد كنص BIGINT دقيق في
`PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID` إلى child، قبل تحميل config/server.
لا يستعمل معرفًا ثابتًا أو قيمة البدء الموروثة أو Legacy.

تشغيل child بواسطة spawn لـNode/Playwright مباشرة، shell=false وwindowsHide=true.
ينقل exit code؛ SIGINT/SIGTERM يرسلها إلى child الذي يملكه فقط، ويرجع128+signal
حتى عند خروج child بنجاح بعد الإلغاء. لا taskkill أو إيقاف خدمة أخرى. يفحص الإلغاء
قبل الاتصال والكتابة وتشغيل child، ويغلق اتصال التحضير. إن تم commit قبل إلغاء
أو فشل إغلاق/تشغيل child، تبقى fixture في قاعدة الاختبار ولا تحذف؛ التخلص من
القاعدة disposable وتاريخها يظل عمل مالك البوابة المنفصل، لا wrapper.

## أوامر الاستكشاف

`npm run e2e -- --list` و`--help`/`-h` و`--version`/`-V` تمر إلى Playwright دون
استيراد DB أو تحضير fixture. لا ينشئ --list خادم التطبيق أو global setup وفق
مسار قائمة Playwright1.62.1 المقروء محليًا؛ تحميل config وتجميع الاختبارات والتقارير
يبقى سلوك Playwright المعتاد. `npm run e2e:list` القائم محفوظ دون تغيير.

الحارس يراعي arity و`--`، ولا يبحث عن substring: `--grep --list` يستهلك --list
كقيمة، وملفات باسم help/list/version ليست أوامر استكشاف؛ هذه تحتاج مسار التحضير
المحروس كأي تشغيل. `--list` بعد `--` ليس خيارًا. يرفض قبل التحضير الخيارات
المجهولة، boolean=value، الحزم المختصرة الملتبسة، وقيم الخيارات المفقودة.
يقبل الخيارات القصيرة ذات القيم مثل `-gpattern` وفق الاستهلاك نفسه.

يرفض override لـconfig لأن wrapper مخصص للبوابة الأصلية. ويرفض --list مع
--ui/--ui-host/--ui-port أو PWTEST_WATCH، لأن Playwright قد يبدأ واجهة بدل القائمة.
يرفض override لـreporter مع --list، وكذلك PW_TEST_REPORTER الموروث، لمنع plugin/HTML من فتح خادم، ويثبت
PLAYWRIGHT_HTML_OPEN=never في child القائمة دون تعديل بيئة الأب. help/version
الحقيقيان يظلان بلا DB. لا تعدّل هذه القيود أوامر بوابات HTTP fixtures الأخرى.

## التحقق والحدود

لم يُشغّل أي test أو typecheck أو build أو DB أو Playwright لهذه الحزمة تحت تجميد
الموارد، ولا توجد نتيجة DB جديدة. المراجعة نصية للـschema وعقد createDatabase
وPlaywright1.62.1 وCommander المحليين والربط وملفات الاختبار فقط.
نجاح اختبارات الحارس لاحقًا لا يثبت rollback فعليًا؛ transaction وهمية فيها تثبت
رفض callback وإغلاق الاتصال فقط. يلزم تنفيذ بوابتي MariaDB10.11 وMySQL8.4 لاحقًا
بعد دمج patch المجال وهذا harness وتوفير العميل المولد المطابق بمعزل عن junction.
MariaDB10.4 السابقة ليست بديلًا؛ العملية الخاصة السابقة مغلقة ولا نافذة DB نشطة.

قيد Windows: Node يرسل الإشارة إلى PID الـchild المباشر؛ الإنهاء على Windows
قد لا يتيح لـPlaywright تنظيف عمليات API/المتصفح التابعة. اختبارات الإشارات الوهمية
تثبت النقل وexit status فقط، ولا تثبت تحرر شجرة العمليات. لم يضف wrapper أمر قتل
عامًا أو taskkill؛ يلزم تحقق ملكية/تنظيف الشجرة في نافذة Windows معزولة قبل اعتماد
الإلغاء هناك. لا يفترض هذا التسليم أن مجرد انتهاء wrapper يثبت غياب descendants.

حالات الحارس المكتوبة: رفض البيئة قبل اتصال/كتابة، هوية DB الفعلية والـport،
صيغ argv واستهلاك القيم، غياب الكتالوج/العملة/الساعة، dependency closure والدورات
والحدود، الأسعار والحصص، ID الدقيق وتوقيت env، فشل plan/version/disconnect،
عدم تسريب أخطاء driver/spawn، code/signals ومنع child عند الإلغاء. لا تنفذ عمليات
خارجية؛ اتصال DB وعملية child محقونان بوهميات في هذه الاختبارات.

الأوامر التالية **معدة ولم تنفذ**؛ يلزم تخصيص الموارد أولًا، وكل المخرجات على D:

```powershell
. ./tmp/coordination/check-env.ps1
& $env:CODEX_MCP_NODE_PATH --test --test-concurrency=1 scripts/tests/onboarding-e2e-wrapper.test.mjs
& $env:CODEX_MCP_NODE_PATH scripts/e2e/run-db-e2e.mjs --help
& $env:CODEX_MCP_NODE_PATH scripts/e2e/run-db-e2e.mjs --list
```

للتشغيل الحقيقي لاحقًا: يجهز مالك البوابة قاعدة الاختبار المعزولة وbuild أولًا،
ويضبط DATABASE_URL عبر بيئة محلية آمنة دون طباعتها. يضبط E2E_DISPOSABLE_DATABASE
بالاسم الحقيقي نفسه، وE2E_BASE_URL المحلي، ثم `npm run e2e -- --workers=1`.
لا ينشئ هذا التسليم قاعدة الاختبار المحلية المقترحة ولا يجيز reset/drop/seed
لقاعدة موجودة. تبقى TEMP/TMP/cache/logs ضمن tmp/coordination على D، GOMAXPROCS=2
وGOMEMLIMIT=1536MiB، ولا install أو Prisma generate أو كتابة في الاعتماديات المشتركة.

## التسليم والرجوع

الحزمة `tmp/coordination/W1_ONBOARDING_E2E_HARNESS.patch` وmanifest منفصل،
مع git diff/check/stat بقراءة فقط وGIT_OPTIONAL_LOCKS=0؛ لا كتابة index/objects/refs.
الرجوع عن harness يعيد أمر البوابة وconfig/إقرار CI فقط، دون تنظيف بيانات أو تاريخ
fixtures. لا يجعل التراجع التسجيل ناجحًا دون سياسة بدء؛ يحتفظ المجال بالفشل الآمن.
الإعداد التجاري الحقيقي متروك فارغًا، ولا اعتماد إطلاق أو خطة فعلية أو نشر.
