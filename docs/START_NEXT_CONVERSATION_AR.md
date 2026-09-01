# ابدأ المحادثة الجديدة من هنا

> تحديث موثوق بعد النشر — 31 أغسطس 2026،19:53 الرياض: دُمج PR46 ونُشر الإصدار0.1.0-e3d6ba03aec8،main=e3d6ba03aec8ceabd42428d67855fad2683968a6،CI33414229344 ناجح كاملًا. /ready والواجهة الجديدة تحققا فعليًا. انظر RELEASE46_RESULT_AR.md ولوحة COORDINATION_BOARD.json. استؤنف الإسناد بطلب المستخدم؛ المتابعة كل10 دقائق فعالة. لا إذن تلقائي بنشر الدفعة التالية. التفاصيل الأقدم أدناه سجل تاريخي ولا تتقدم على هذا التحديث.


آخر تحديث: 31 أغسطس 2026، بعد نجاح النشر وفحص صفحة الخطط العامة.
هذا ملف تسليم عملي، وليس ادعاء اكتمال كل الميزات.

## النتيجة المختصرة

- **دُمج الإصدار45 ونُشر على الاستضافة فعلًا.** الرأس المنشور `89ba49b`،
  والإصدار `0.1.0-89ba49b8b232`، والتشغيل `33382817632` ناجح كاملًا.
- صفحة الخطط متاحة الآن على https://accounting.doralashab.com/plans؛ فُتحت
  فعليًا في المتصفح وظهرت الصفحة الجديدة. لا عروض منشورة بعد، فتظهر رسالة التجهيز.
- **لم تُدمج كل المسارات التالية فيmain.** ربطS1/S2 محفوظ في فرع التجميع التالي؛
  N1/N2/N3/Z1 ما زالت أساسات مستقلة غير مفعلة. جميع الفروع محفوظة علىorigin.
- لا تعِد من الصفر، ولا تنسب نجاح بوابات الإصدار45 إلى الكود اللاحق.
- امتلاءC خطر محلي قائم: آخر قياس58667008 بايت (نحو56MiB) فقط. أُوقف العمل
  المحلي الثقيل دون حذف أي ملفات. النشر الخارجي اكتمل ولا ينتظر هذا القرص.

## ملخص المستخدم والسلطة

الأولوية تشغيل أول بقالة مع الحفاظ على Modular Monolith وملكية الكتابة وACID
وعزل الأنشطة/الشركات وDecimal وOpenAPI. الاشتراكات ووضوح الخطط مهمان، والباركود
متطلب عاجل على القديم والجديد؛ تطبيقات الهاتف هدف مستقبلي. لا توسعة مطاعم أو
صيدليات أوCRM الآن على حساب إغلاق البقالات.

أذن المستخدم صراحة بالرفع والدمج إلىmain والنشر على الاستضافة الحالية، ثم طلب
إغلاق العمل وتوثيق كل المسارات للمحادثة الجديدة وعدم نسيان دمجها ونشرها.
الإذن يشمل المسارات المطلوبة، لكنه لا يلغي بوابات الإصدار أو يحوّل ملفات غير
مربوطة إلى قدرة تشغيلية. أُرسل سؤال عن جمع الأساسات غير المفعلة ولم يصل رد؛
لا تعتمد عليه بوصفه المانع الوحيد: نقص الربط والقبول موثق أدناه ويجب إغلاقه.
لا تمنح قراءة هذا الملف إذنًا لطباعة على جهاز، أو اعتماد أسعار/خطة تجارية،
أو قبولEULA نيابة عن المستخدم.

## الحالة المثبتة اليوم

1. **PR45 دُمج فعلًا** عند89ba49b8b232043fd83a6d098c257fe3b124f954 بعد
   نجاحCI33381104640 علىالرأسbc7b653 وبقاءالأصلfcae1e1 دونتغيير.
2. **CI main33382817632 والنشر99463754681 نجحا بالكامل**. أُخذت نسخة
   احتياطية مشفرة، ونجحت الترحيلات والتفعيل؛ أصبح الإصدار جاهزًا في13:56:12
   بتوقيت الرياض. التفاصيل والبصمة في `RELEASE_45_ACCEPTANCE_2026-08-31_AR.md`.
   فحص المتصفح العام أثبت الصفحة الجديدة بالعربية عند1280px فقط؛ ما زالت
   مصفوفة smoke على الاستضافة768/1024/1440 وقبول المستخدم المسجل غير مغلقين.
3. **S1/S2 رُبطا محليًا في الفرع التالي** عند611691fd8c959f79b9d0d33f8b5edf42819371a7؛
  138وحدة و10اختبارات رحلة نهائية والأنواع والبناء وحراس الواجهة ناجحة.
   لم يُفتح PR له ولم يُدمج أو يُنشر. لا تورث نجاح CI45 إلى هذا الفرع.
4. **N1/N2/N3/Z1 غير مربوطين بالمنتج**؛ كود تأسيسي واختبارات معزولة علىفروعهم.
   لا تُظهر أزرارًا تعد بقدراتهم قبل ربط العقود وإتمام القبول.
5. جميع الفروع السبعة أدناه **دُفعت إلىorigin بنجاح** للنسخ الآمن؛ لا تخلط
   push معmerge أوdeploy. شجرات المسارات الستة كانت نظيفة عند الفحص الأخير.

الاستضافة الحالية: https://accounting.doralashab.com/، بيئة تطوير/Staging بحسب
المستخدم، وليست إطلاق عميل Production. اسم Environment القديم production نطاق
أسرار تاريخي فقط. لا تعديل هدف آخر أو مخزون/فاتورة عميل حقيقي في QA.

## نسخ العمل ومراجع الاستئناف

| المسار | نسخةD/الفرع | الرأس/التسليم |
|---|---|---|
| الإصدار45 | `D:/CodexWorktrees/grocery-launch-coordinator`،`feat/grocery-launch-coordination` | HEADbc7b653؛origin/main89ba49b؛فرق الشيفرة فارغ،الدمج منشور فيGitHub |
| التجميعالتالي | `D:/CodexWorktrees/grocery-next-wave-coordinator`،`feat/grocery-next-wave-coordination` | شيفرة611691f،ثمcommitوثائق التسليم؛افحصHEADالحالي |
| N1 استرجاع البيع | `D:/CodexWorktrees/pos-durable-recovery`،`feat/pos-durable-recovery` |6d7f522c9c0bfce626074ce3ac9cfd7c93ba48dd |
| N2 سياق الكاشير | `D:/CodexWorktrees/cashier-context-experience`،`feat/cashier-context-experience` |1dad9986eb469eb43465a8b8dcdccfd9a63e53ee |
| N3 الإيصال | `D:/CodexWorktrees/retail-receipt-output`،`feat/retail-receipt-output` |0038cc95711b962c08d778ce6b4f47deab3c4955 |
| S1 الاشتراك | `D:/CodexWorktrees/subscription-upgrade-experience`،`feat/subscription-upgrade-experience` |ba25c4df4748629612d4ba806dded6b5d3443dec؛مستوردفيالتالي |
| S2 الخططالعامة | `D:/CodexWorktrees/plans-discoverability`،`feat/plans-discoverability` |8d5644aeb5314a1da2655cc25151b152985c2789؛مستوردفيالتالي |
| Z1 Zebra | `D:/CodexWorktrees/zebra-label-workflow`،`feat/zebra-label-workflow` |c52cf1b4e61743ecc7dc9ec2de79659b013f30c0 |

**لا تعمل في شجرةC الأصلية المتسخة ولا تحذفها أو تنظفها.** common Git metadata
يشير إلىC حتى لنسخD؛ لذلك امتلاءC مهم. آخر قياس56MiB فقط؛أُبلغ المستخدم وأوقفت
اختبارات محلية إضافية. لا حذف ملفات المستخدم/نسخ الوكلاء دون حسم ملكية وإذن.
node_modules junction للقراءة فقط؛لاinstall/ci أوPrisma generate داخله.
TEMP/cache/build/tests علىD،عامل واحد وGOMAXPROCS2/GOMEMLIMIT1536MiB.

## S1/S2: ما رُبط وما بقي

راجع `docs/SUBSCRIPTION_DISCOVERY_INTEGRATION_AR.md` أولًا.

- S1 d590f97/d501859/ba25c4d استوردت كـ8479a68/348dda9/e89c2b4.
- S2 1f0582c/8d5644a استوردت كـ0b4a102/c8a58b7. لا تعاود cherry-pick.
- R0 commit611691f يربط Banner فيالرئيسية فقط،وصلاحياته وقراءة snapshot
  محدودةpageSize1/10s/no retry؛الموظف لا يبدأ قراءة تجارية. الإغلاقذاكري في
  نسخةApp عبرتنقلالصفحات؛ليساحتفاظًادائمًاعبرreload.
- روابطاختيارالخطة أصبحت/#login?plan= و/#register?plan= ثم/#subscription?plan=،
  بمعرفBIGINTنصي فقط،دونtoken/redirect/activate. تعملعندحجبsessionStorage وتبويبين
  والرجوع/التقدم. السعر/الأهليةمنالخادم،لاautoPOST أوfallback إلىأولخطةغائبة.
- S2 يعرضأعمدةميزاتمحدودةبالصفحةحتىعندعرضواحد،ومساريالزائر/الحسابالحالي.
- SubscriptionUpgradeCard جاهزغيرمركب؛المركبBanner فقط. لاrank/tierفيAPI،
  فالزر محايدViewplans/مراجعة،لا «ترقيةللأعلى»مختلقة.
- تبقىمصفوفةالقبولالبصريالكاملةوالهوية/النشاط/التفويضالمتغيرعبرالمتصفح وفحوص
  النسخةالشاملةوالعقودومحركيDB قبلPR/merge/deploy مستقلة.

الدليل:138/138وحدة،Web/E2Etypes،i18n/UI27/67،Webbuild162modules،10/10Playwright
في51.3ثبلاretryعلىالتطبيقمعHTTPfixtures. ليستتسجيلًا/بريدًا/دفعًا/DBحقيقيةولا
قبولًاكاملاًلكلمقاس. المنافذ3163/4213كانتلمشغلالاختبارفقطوانتهتجولته.

## N1/N2/N3/Z1: العقود وحدود الدمج

| المسار | commitsبالترتيب | الوثيقةوالأدلة/المتبقي |
|---|---|---|
| N1 |164e97b،5538a0f،4c2d3a8،5d2bc81،6d7f522 |`docs/POS_RECOVERY_N1_HANDOFF_AR.md`و`docs/architecture/POS_RECOVERY_N1_ADR_AR.md`فيشجرته؛102/102وtypes؛لاDB/browser/WebLocksفعلي |
| N2 |33ba21e،10d0ed8،1dad998 |`docs/cashier-context-contract-N2_AR.md`و`docs/cashier-context-handoff-N2_AR.md`؛24API+38Webبجولتين؛لاbrowser/DB |
| N3 |e566abe،2825fe3،0038cc9 |`docs/retail-receipt-N3-handoff-ar.md`؛43unit،24DOM+11تفاعل؛صورغيركافيةلقبولبصري،لاPDF/device/DB |
| Z1 |823d905،b1e1d20،c52cf1b |`docs/zebra-label-workflow-handoff-ar.md`؛62Web+99API،types/build؛لاbrowser/SDK/device/DB/route |

- **N1**: POSTrecoveryمقترح{attemptKeyUUIDv4}بـpos.checkout/CSRF/POS؛
  CONFIRMEDoriginalresultأوUNKNOWNفقط. Infrastructureيقرأunique
  (company,user,operation,keyHash)بـSHA256،والـPOSserviceيعيدauthقبل/بعد.
  يلزمOpenAPI/generatedvalidatorوcomposition/routerوPosPage. marker فقطفي
  storageلاbody/result/credentials؛WebLocksfailclosed؛لاfinancialPOSTبعدreload.
  لا ضمانبعدretention24h/مسحstorage/تبويبإصدارقديم. **حتى422أوليبعدحجزmarker
  يبقىمقفلاً**؛لافعّلللكاشيرقبلحل/اعتمادUXالرفض،ولاتضفforce-clearلـUNKNOWN.
- **N2**:CoreAccountingtake2لحلالفترةبالتاريخخادميًا(advisory)،بلاschema/Posting
  تغيير. APIالمقترحGET/pos/context/period?documentDate=،يلزمهربطroot. exact-id
  للعملةوطريقةالدفعمازالغيرمتوفر؛لاGETشامل/أولصفحةكدليلكمال. خمسةحقولسياق؛
  NewSaleالسابقكان يحتفظبهافعلًا؛لاادعاءتوفير5اختياراتفيكلبيع. تذكرصريحذاكري،
  freshness5دقائقواجهةفقط،ومراجعةبعدتغيرالمصدر/التاريخ،وقفلتسلسلالمسح/unknown.
- **N3**:قراءةأرشيفSALES_INVOICEالقائم/hashفقط؛58/80mm**معاينةفقط**،PDFالمالك
  الحاليA4بإجراءصريح. يلزمPrintinglocator/readExistingوHTTP/OpenAPI/RBAC
  sales_invoices.print/SALES/POS،والربطresult.invoice.idلالمعرفالمحاسبي.
  PrintSnapshotv1لايحملباركودتاريخي؛لاlookupحي/QRمختلق. كشفعيبNumberفيA4
  pdf-rendererيمسدقةDecimal؛الدليلنصيلاPDFفعلي،**لميُصلح**؛مانعقبولإخراجمالي.
- **Z1**:خدمةPrintingتحضرمنInventorybarcodeIDsوrendererPNGالقائم203فقط.
  كلحقولالموديل/الاتصال/mm/DPI/الكميةفارغة؛لاافتراضطابعة203. authوالمصدرقبل/
  بعدالرسموالإرسال،actor/authorizationRevisionمحليان،ساعةfinite/no rollback،
  معاينةone-shotوunknownيقفلالجلسة،sent/queuedليسprinted. defaultportsunavailable،
  لاSDKأوendpointأومونتInventoryPage. يلزمAPI/generatedtransport،bridgeمراجع
  version/hash/EULA/HTTPSومقاسbytesالمرمزنهائيًاوموديلوقبولملصقفعلي/فكباركوده.
  المستخدملميرسلبعدمعلوماتالموديل/USBأوشبكة/عرضوارتفاعالملصق؛لاطباعةاختباريةتلقائية.

## فجوات لا تضيع عند الاستئناف

1. تسجيلنشاطجديديستدعيprovisionGrandfatheredAccess أيضًا؛ينشئACTIVE/Legacy
   fullaccess/GRANDFATHEREDبرسم0ومصدرMIGRATION. لايسمىغيرمشتركأوBASICأوTRIAL.
   أصلحالسياسةعندمالكPlatformSubscriptionsبعقدخطةبدءمهيأةدونسحبحقوقالقدامى.
2. publiclyListed=falseافتراضيًا. عرض/إعلانالعروضقرارمشغلصريح؛لاتملأمنfixtures
   أوLegacy. المستخدملميعتمدبعدأسعارًاأومدةتجربة/حصصًا؛لااخترعهالإغلاقUI.
3. قياساتحملممثلومعايرةSLO/PoolوحادثةTCP/TLSللولوجمازالتغيرمغلقة. نجاحCI
   وفحص/readinessليسقياساستجابةللمستخدمأوضمانسرعةالاستضافة.
4. لاادعاءجاهزيةأولعميلقبلقبولالمسح/الطابعةوالإخراجالدقيقواستعادةالنتيجة
   والتجهيزالتجاري. لاOffline/فروع/ورديات/ميزان/صلاحيةدواءكميزاتلهذهالدفعة.

## ترتيب الاستئناف المقترح

1. اقرأAGENTSومراجعهالسبعةوووثائقالتنسيقفيشجرةD،ثمGitstatus/fetch؛لاتفترضأن
   HEADأوالاستضافةمازالاعندمعرفهذهالوثيقة.
2. تحقق من بقاء الاستضافة على الإصدار المنشور، وأكمل smoke768/1024/1440
   بالعربية والإنجليزية. لا تعِد النشر أوseed أوmigration لمجرد بدء محادثة جديدة.
3. بعدتوفيرالمساحة،أغلققبولS1/S2المرتبطينثمPR/بواباتالمحركين/دمج/نشرمستقل.
4. اربطN1ثمN2ثمN3وفقاعتمادالعقود،أوأعدالتقسيممعملكيةواضحة؛لاتجمعملفات
   unmountedوتصفهاكقدراتتشغيلية. لكلشريحةبواباتفعليّةوحواجزعزلوDecimal.
5. Z1بعدمعلوماتالطابعةوقرارالجسر،ومنثمقبولالمقاسوالكميةوالورقوالقارئفعليًا.

مراجعالتنسيق: `GROCERY_NEXT_WAVE_COORDINATION_AR.md`،
`SUBSCRIPTION_DISCOVERY_ZEBRA_COORDINATION_AR.md`،
`SUBSCRIPTION_DISCOVERY_INTEGRATION_AR.md`،`RELEASE_45_ACCEPTANCE_2026-08-31_AR.md`.

## حالة الحفظ والتشغيل عند الإغلاق

- شيفرة ربطS1/S2: `611691fd8c959f79b9d0d33f8b5edf42819371a7`، ثم
  `555dcf8` لوثيقة التسليم، ثم commit إلحاق نجاح النشر. افحصHEAD ولا تفترض ثباته.
- مرجع النسخة البعيدة: `origin/feat/grocery-next-wave-coordination`.
  لم يُفتح PR لهذا الفرع ولم يُدمج أو يُنشر. ملفات التسليم فيه لا فيmain الحالي.
- انتهت جولة الاختبارات الأخيرة؛ فحص listeners أكد خلو3163/4213.
  لم تُوقف عمليات الآخرين أو تُنظف شجراتهم أو تُحذف أي ملفات مستخدم.
- صفحة الخطط العامة المفتوحة للفحص قراءة فقط؛ لم يُرسل تسجيل أو دخول أو
  اشتراك أو دفع أو بيع أو أمر طباعة على الاستضافة أثناء هذا التحقق.

روابط النتيجة الحالية:

- [صفحة الخطط العامة](https://accounting.doralashab.com/plans).
- [اشتراك النشاط بعد الدخول](https://accounting.doralashab.com/#subscription).
- [إدارة إعلان الخطط للمشغل المخول](https://accounting.doralashab.com/#platformSubscriptions).
- [PR45 المدمج](https://github.com/ALMutasemObad/multi-company-accounting/pull/45).
- [سجل الفحص والنشر الناجح](https://github.com/ALMutasemObad/multi-company-accounting/actions/runs/33382817632).

## رسالة مختصرة للمحادثة الجديدة

> اقرأ D:/CodexWorktrees/grocery-next-wave-coordinator/docs/START_NEXT_CONVERSATION_AR.md
> كاملًا،ثمAGENTSوالحواجز. تحققGitوالنشرولا تبدأمنالصفر. الأولويةإغلاقربطالاشتراكات
> والبقالاتواستكمالالمساراتالموثقة،بلاخلطpush/merge/deployوبلامساسشجرةCالمتسخة.
