# تسليم قبول S1/S2 — W1

التاريخ: 31 أغسطس 2026. النسخة الوحيدة المستخدمة:
`D:/CodexWorktrees/wave1-subscription-acceptance`، الفرع
`test/wave1-subscription-acceptance`، HEAD دون تغيير:
`c7ffc99306a180387bb1a618d0d2750f762bf48b`.

**الحالة: قبول غير مغلق.** الجولة الآلية الأولى 18 ناجحًا و8 فاشلة من26.
اثنان عيبا منتج مثبتان، وستة إخفاقات harness صُححت في المصدر دون إعادة تشغيل.
كشفت مراجعة PNG عيبين بصريين إضافيين عند1024. الفحص التفاعلي بمهارة Browser
مؤجل بأمر المنسق بسبب الموارد. لا commit أو push أو PR أو دمج أو نشر.
المنسق طلب صراحة حفظ الملفات وpatch علىD دون commit حاليًا.

## النطاق والملكية

- قُرئ AGENTS والمراجع السبعة وSTART_NEXT وSUBSCRIPTION_DISCOVERY_INTEGRATION
  وADR-019. الربط611691f موجود فيbaseline؛ لم نعد استيرادS1/S2 أو بناءهما.
- لا ملفات منتج أو OpenAPI أو Prisma أو migrations أو بيانات تجارية معدلة.
- ملفات التغيير: `scripts/visual-qa-server.mjs` للاختبارات فقط؛ صار يصدر
  `responseFor` وتبدأ استماعته فقط عند تشغيله مباشرة. المسار السابق يحتفظ بسلوكه.
- harness الجديد كله في `tests/subscription-discovery/wave1/`:
  `server.mjs`, `vite.config.mjs`, `vitest.config.mjs`, `api-guards.config.mjs`,
  `playwright.config.ts`, `run.ps1`, `acceptance.spec.ts`, `defects.spec.ts`.
- خادم3166 fixtures ذاكرية فقط؛ سياق الشركة المشترك فيه محاكاة للاختبار،
  لاSession حقيقية ولاDB.3166 لا يتصل بموفر أو خدمة خارجية ويمنع أوامر الأعمال
  غيرGET؛login/logout/context استجابات مصطنعة فقط. Vite على4216.
- لم تُرسل عملية تسجيل أو بريد أو دفع أو طباعة حقيقية. لم يُستخدم موقع الاستضافة.
  لاinstall/ci أوPrisma generate أو تنزيلbrowser. لا حذف/تنظيف ملفات مستخدم.
- Barcode Impact: لا صنف أو barcode أو طباعة؛ N/A. لا تغيير للـModular Monolith
  أوملكيةالكتابة أوACID أوDecimal أوRBAC/CSRF/idempotency/version.

## التشغيل الذي تم فعليًا

المجلد المرجعي لكل الأدلة:
`tmp/coordination/subscription-acceptance/` داخل هذه النسخة علىD.

| البوابة | النتيجة الأولية وحدودها |
|---|---|
| وحداتS1/S2 |138/138 في8ملفات،13.98ث،عامل1؛`logs/unit.log` |
| Web types وE2E types | نجح تنفيذtsc دون تشخيص قبل اكتمال إضافات/تصحيحات الاختبارات؛ لاstdout ولذلك لم ينشئTee القديم ملفيtypes. ليست مصادقة على المصدر النهائي |
| i18n/UI |نجاح؛27page headers و67table regions؛`logs/i18n.log`,`logs/ui.log` |
| contracts:check |نجاح169request bodies و2138response bodies؛`logs/contracts.log` |
| Web build |نجاح162modules،3.06ث؛`logs/build.log`،المخرجات`build/` |
| Playwright |26،18pass،8fail،0skipped،0flaky،0retries،worker1؛211.715ث من11:40:36.685Z |
| API architecture/public-catalog guards الإضافية |كُتبconfig لها ولم تُشغّل بعد التجميد |
| محركاDB والبوابات الشاملة/Redocly |لم تُشغّل في هذه المهمة |
| Browser skill تفاعلي |قُرئت المهارة واتصلruntime فقط؛ لا تبويب أُنشئ/claim ولا تنقل أولقطة منه. مؤجل |

أوامر التشغيل الأولية هي `run.ps1 unit/types/guards/build/e2e`؛ صار المشغّل
النهائي يسجلexit code حتى للنجاح الصامت، ويستخدمVitest configLoader runner
وVite native،ويضعTEMP/TMP/cache/logs/build/نتائج الاختبار علىD ويثبت
GOMAXPROCS=2 وGOMEMLIMIT=1536MiB وworkers1. هذه التحسينات **لم يُعد تشغيلها**.

قبل الجولة الفعلية فشل بدءٌ قصير بسببcwd النسبي للخوادم داخلconfig الاختبار؛
صُحح ولم تبدأ فيه اختبارات. JSON reporter كتب نتيجة الجولة في مجلدconfig
علىD، ثم نُسخ دون حذف الأصل إلى المسار المرجعي أعلاه، وصُحح مساره المطلق
في المصدر النهائي. لا نخفي هذه العثرات بوصفها عيوب منتج.

## نتيجة26اختبارًا ومصفوفة القبول

| الحالات | النتيجة |
|---|---|
|10اختبارات الربط السابقة: أربع لغات،sessionStorage محجوب،login/register/back/forward،تبويب جديد،BIGINT نصي مفقود،منعصلاحية،شريطالمنزل/الإغلاقوالخطأ/الموظف |10/10 |
|العربية والإنجليزية ×768/1024/1440؛plans→register→login→subscription(missing)→home |6/6،30PNG،دونPOST؛المصادقةfixture وليست تسجيلًا حقيقيًا |
|catalog مصادق مقسم؛الخطةالمفقودة لا تُختار تلقائيًا عند ظهورها فيصفحةتالية |نجاح |
|catalog مصادق empty/error |نجاح،لاخطةمصطنعة ولاcommand |
|public empty/error/retry/limited |توقف فيassertion خاطئ قبل استكمالlimited؛لم يغلق |
|تغيرcompany/permission/modules أثناءreadمعلق |3فشل harness قبلالتبديل؛لم يغلق |
|logout ثمهويةأخرى أثناءreadمعلق |فشل harness قبلlogout؛لم يغلق |
|D1 تبديلplan فيURL داخلصفحةالاشتراك |فشلمنتج مثبت |
|D2 حجبlocalStorage وsessionStorage |فشلمنتج مثبت |
|D3 تبديلشركة من تبويبين |فشلlocator قبلrefresh؛فرضيةغيرمثبتة |

لا تغطي الجولة view-only وعدموجودشركة بالكامل،ولا استمرارهوية/تفويض متغير
علىخادم حقيقي. نجاحsessionStorage ليس نجاححجبكلالتخزين. نجاحالروابطفي
تبويبين ليس قبولتبديلسياقالشركة عبرتبويبين. لا تنسب نتائجfixtures إلىDB
أوCSRF/RBAC خادمي أوتسجيل/بريد/دفعحقيقي.

## العيوب وخطوات التكرار للمنسق

### W1-D1 — نيةURL الجديدة لا تنعكس في الاختيار

- الاختبار: `wave1/defects.spec.ts`،
  `W1-D1: changing the subscription plan URL must update the displayed review choice`.
- جهزcatalog fixture بخطتين2101/2102،وافتح`/#subscription?plan=2101`.
  تحققأنselect=2101. انتقل داخلنفسdocument إلى`/#subscription?plan=2102`.
  URL يصبح2102لكنselectيبقى2101بعدالانتظار؛لم يُرسلأمرمالي.
- المسؤول: `apps/web/src/CompanySubscriptionPage.tsx:81`؛
  `selectionInitialized` يفضلselectionRef بعدالتحميلالأول،ولايتابعhashchange.
  يلزمأيإصلاح الحفاظ علىرفضالاختيارالمفقود وعدمautoPOST وإبطالمراجعةقديمة.
- الدليل: `e2e/wave1-defects-W1-D1-changi-7e24d-the-displayed-review-choice/`
  وفيه`error-context.md`و`test-failed-1.png`؛expected2102/received2101.
- back/forward بينالخطتين موجودان بعدassertionالفاشل،ولم يصلا للتنفيذ.

### W1-D2 — حجبlocalStorage يوقفbootstrap

- الاختبار: `W1-D2: blocking localStorage and sessionStorage must still render public plans`.
- يحجبinit script الوصول إلىlocalStorage وsessionStorage برميخطأ،ثميفتح`/plans`.
  rootيبقىفارغًا،0cards بدل3،وظهر`application_bootstrap_failed Error`.
- المسؤول: `apps/web/src/main.tsx:38`،قراءةlocalStorage قبلrender وخارجtry؛
  catchالنهائي:59يسجل فقط. هذاعيبقائم فيبدءالتطبيق،ولا يتطلبتغييرعقدالتسجيل.
- الدليل: `e2e/wave1-defects-W1-D2-blocki-39a8e-t-still-render-public-plans/`
  مع`error-context.md`و`test-failed-1.png`،وكذلك`logs/e2e.log`.
- لا يعد نجاح اختباراتsessionStorageالسابقة إثباتًا لمعالجةهذاالعطل.

### W1-D3 — فرضيةسياق تبويبين،غيرمثبتة

Session تحفظselectedCompanyIdمشتركًا؛api.tsيرسلcookie ولاشركةمتوقعة.
`platform-subscription-service.ts` فيownerCompany يحذفcompany منsnapshot؛
`subscription-upgrade-contract.ts:56` يختمالردبالنطاقالمحليالملتقط.
قديقرأتبويبA اشتراكBبعدتبديلالسياق منتبويبB ويعرضه تحتاسمA.

اختبار`W1-D3: tab A must reject company B subscription after tab B changes shared context`
فتحA ثمB ونجح تبديلB؛توقف قبلrefresh بسبب`.page-header` الخاطئ.
صُحح إلى`.page-heading` معانتظارالردوانتهاءتحميلrefresh،دونrerun.
المجلد`e2e/wave1-defects-W1-D3-tab-A--f3b66-ab-B-changes-shared-context/`
ليس دليل تسرب. يُسند تحقيق/قبول مستقل؛لا تعديلمنتج هنا.

### W1-V1/V2 — عيوبمرئية منPNG عند1024

راجعتالمهمة ومراجعقراءةمستقل الصور30كلها،دونتشغيلمتصفحجديد:

- V1: فيالإنجليزية1024،Recorded allowance=100تنقسم إلى`10`ثمسطر`0`؛
  **125سليمة**. المسؤول`subscription-usage.css:18–20`،flex و
  `overflow-wrap:anywhere` معثلاثةأعمدة وbreakpoint1000في:25؛عرضالقيمة
  `CompanySubscriptionUsagePanel.tsx:69`.
- V2: فيالعربيةوالإنجليزية1024،أزرارContinue checkout/Cancel attempt
  مقصوصة عندحافةبطاقةPayment attempts وتتداخل معوقتالحالة. ليستداخلجدول
  invoicesالقابلللتمرير. المسؤول`SubscriptionBillingCenter.tsx:71`و
  `styles.css:1455,1461,1465,1488,1538`: بطاقةنصفعرض،حدودأعمدة150/130،
  overflow:hidden،والتحولالضيقلايحدثحتى600.
- الدليلان: `e2e/wave1-acceptance-en-1024-p-e587e-subscription-and-owner-home/subscription-missing.png`
  و`e2e/wave1-acceptance-ar-1024-p-6fe77-subscription-and-owner-home/subscription-missing.png`.
- لم ننفذ دفعًا أوتفاعلًا معالأزرار. هذهعيوبعرضمثبتةبالصورة،لااختبارعملياتدفع.

لا قص/تداخلظاهر فيlogin/registerأوالتنبيهوالاختيارالفارغوزرreviewالمعطل
ببقيةالصور. plans/homeبلاعيبتخطيطمانعظاهر؛عند768توزيعالبطاقات2+1يترك
مساحةفارغة. أسهمOpen system/Next reviewبالإنجليزيةتشيريسارًا؛ملاحظةثانوية.
جدولالمقارنة768وجدولالفواتيرلهماحاوياتتمرير؛فعاليةالتمرير/لوحةالمفاتيح
لمتُقبلتفاعليًا. العناوينمعتدلةومتسقةوبلاتسطيرزخرفيقصير؛لاقياسDOM
لعددأحجامالخط منالصور. أسماءfixturesالعربيةفيالكتالوجالإنجليزيليست
ترجمةتجاريةمخترعة.

## تصحيحاتharness الستة بعدالجولة — لمتُشغّل

1. يميّزاختبارpublicحالةemptyبـ`.plans-empty[role="status"]`؛فالخطأيستخدم
   classنفسه لكنrole=alert.
2. الحالاتالثلاثcompany/permission/modulesتحبسكلطلباتالنطاقالقديم ثم
   تفصلfreshReads؛لا تفترضrequestواحدًا معReactStrictMode.
3. logout/identityيطبقالمبدأذاته؛حُذفادعاءاختبارdismissalmemoryمنالعنوان
   لأنهذهالحالةلمتفحصه.
4. D3صححselectorRefreshوانتظارالتحميلكماسبق.

تحسيناتإضافيةغيرمشغلة: metadataصحيحةلسيناريوlimitedفيالخادم،مسارreporter
مطلق،logsللنجاحالصامت،configحراسAPI. لاskipأوtest.fail لإخفاءالعيوب؛
اختباراD1/D2يظلانassertionsللسلوكالمطلوبحتىإصلاحالمنتج.

## جردCURRENT_STATEللمُنسق فقط

لم نعدل`docs/CURRENT_STATE_AND_NEXT_STEPS_AR.md`:

| الموضع | التناقض معbaseline |
|---|---|
|13–20 و48–55 |لا يزالplans/SUB-4غيرمنشور؛تسليمالإصدار45يثبت89ba49b المنشور.أرقام1.43/314/65و1.44/66قديمة؛baseline1.46.2و322operationIdو67migration |
|229–233 |المنشورd7cd687 قديم،ولا يعكسPR45 |
|252 |توجيهالبدءمنSUB-3ووصفالدفعغيرمنفذيخلطوجودأساسالدفع/محاكيالتطوير معغيابموفرتجاري |
|الجردالعام |يلزمتفصيلS1/S2محلي611691f غيرمنشور؛Bannerمركب،Cardغيرمركب،والقبولالحاليغيرمغلق |

المصدر:baselineنفسه،`START_NEXT_CONVERSATION_AR.md`و
`RELEASE_45_ACCEPTANCE_2026-08-31_AR.md`وOpenAPI؛لم نعدفحصالاستضافة.

## الأدلة والحفظ والاستئناف

- `e2e-results.json`،`logs/e2e.log`،`e2e/.last-run.json`: نتائجالجولةالأولى،
  محفوظةبفشلهاالأصلي. `run1-source/` يحفظacceptance/defects/server/config
  كماكانتقبلتصحيحاتمابعدالجولة؛الاختبارات10السابقةفيbaseline.
- `evidence-manifest.json`: جردصور/سجلاتوبصماتها،و`wave1-subscription-acceptance.patch`
  فيالمجلدالمرجعي: تسليمالتغييراتبلاGitmetadatawrite.
- تأكدخلو3166/4216بـGet-NetTCPConnectionبعدانتهاءالجولة؛انتهتعمليتا
  الخادمين13720و12392. لاعمليةمعلقةمملوكةلهذهالمهمة. أُبلغالمنسق
  وتحررتملكيةالمتصفحوالخوادم؛لاtabأوviewportoverrideمملوك.
- بدأالتجميدعندCنحو104MiB. لا تشغيلجديد أوrerun أوcommitبعدالتجميد.
- الخطوةالتاليةعندنافذةالمنسق: إصلاحD1/D2 وعيوب1024عندمالكيالمنتج،
  إعادةtypes/حراس/وحدات/بناء/جولة26علىالمصدرالجديد،إثباتD3والتحولات
  المؤجلة،ثمBrowserskillتفاعلي للمقاساتوالحالاتوالتمريروالkeyboard.
  تظلDB/العقودالشاملةوبواباتالإصدارمستقلة. **لا قبولنهائيS1/S2قبلذلك.**
