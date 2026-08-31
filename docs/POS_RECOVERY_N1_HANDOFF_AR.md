# تسليم N1 — استرجاع نتيجة POS بعد ضياع الاستجابة وإعادة التحميل

التاريخ: 2026-08-31. المنسق: `01a04cc6-7aae-70b2-adb9-e037386d06a2`.
النسخة: `D:/CodexWorktrees/pos-durable-recovery`، الفرع `feat/pos-durable-recovery`.
الأساس: `39c1de87b45e481ccdfe66a18a33336d8f32b8f9`، وكان نظيفًا عند البدء.

## النتيجة

نُفذت شريحة معزولة فعلية للسياسات والخدمة والمكوّن والاختبارات. تؤكد النتيجة من
الخادم أو تبقى UNKNOWN؛ لا missing/expiry/401/403/404 أو تغيير سياق يفتح قفلها.
يحفظ المتصفح marker غير مالي قبل الإرسال، ويرفض الإرسال عند تعذر حفظه، ويستعيده
بعد reload للقراءة فقط. لا يحفظ جسم البيع أو النتيجة أو كلمة مرور/اعتماد.

اعتمد المنسق اتجاه بلا schema، وPort القراءة، وWeb Locks مع الفشل المغلق عند
غيابها. لم يُركب endpoint أو يعدل PosPage. التنفيذ جاهز للتركيب عند مالك الملفات
المشتركة، ولا يدعي أن رحلة التطبيق الحالية أصبحت تسترجع البيع بالفعل.

## commits المحلية بالترتيب

| commit | المحتوى |
|---|---|
| `164e97b` | Port وخدمة POS والتحقق من النتيجة،32 اختبار سياسة API،ADR وفحص NodeNext |
| `5538a0f` | marker/controller وbrowser adapter وحراسة التبويبات،اختبارات الحالة وإعداد فحص معزول |
| `4c2d3a8` | PosRecoveryPanel وقاموس مستقل بأربع لغات وCSS واختبارات SSR |
| `5d2bc81` | اختبار إضافي يمنع إلحاق نتيجة قديمة بالبيع التالي بعد التأكيد والبدء الصريح |

أي commit توثيقي لاحق يضيف هذا التسليم دون تغيير أساس الشيفرة أعلاه.

## الملفات ونقاط الربط

| الملفات | مسؤوليتها |
|---|---|
| `apps/api/src/pos/recovery-types.ts` | DTO داخلي وPosRecoveryQueryPort، attemptKey في حد الإدخال فقط |
| `apps/api/src/pos/recovery-result.ts` | إسقاط دفاعي محدود لنتيجة الأمر الأصلية؛ Decimal نصي وبلا تسريب حقول إضافية |
| `apps/api/src/pos/recovery-service.ts` | authorization قبل/بعد القراءة،عزل المستخدم والشركة والعملية،رفض الدليل المنتهي أو الناقص |
| `apps/web/src/pos-recovery-model.ts` | marker محدود256 محرفًا وحالات الواجهة وقبول الإقرار |
| `apps/web/src/pos-recovery-controller.ts` | حجز علامة قبل callback إرسال واحد،refresh/read/late-result/new-sale وقفل unknown |
| `apps/web/src/pos-recovery-browser.ts` | localStorage وWeb Locks وstorage-event بدون endpoint خاص |
| `apps/web/src/PosRecoveryPanel.tsx` | عرض فقط،إخفاء النتيجة عند فقد الصلاحية وحراسة pending للباركود عند بيع جديد |
| `apps/web/src/pos-recovery-styles.css` | مقاسان16/20px عبر rem،اتجاه ولغات ولمس،دون خط زخرفي |
| `apps/web/src/i18n/locales/pos-recovery.ts` | قاموس مستقل ar/en/hi/ur دون تعديل القاموس المجمع |
| `apps/web/src/pos-recovery-{controller,browser,panel}.test.*` و`pos-recovery-test-fixtures.ts` | اختبارات المتصفح المحاكى والحالة والعرض فقط |
| `apps/api/tests/pos-recovery-service.test.ts` | اختبارات خدمة القراءة ومنع التسريب والتفويض،دون DB |
| `pos-recovery-{tsconfig,api-tsconfig}.json` و`pos-recovery-vitest.config.ts` | فحص محدود بلا تغيير package/lockfiles أو إعدادات عامة |
| `docs/architecture/POS_RECOVERY_N1_ADR_AR.md` | العقد المعتمد ومخطط الربط والأمان وBarcode Impact وحدود الترحيل |

تفاصيل التركيب الملزمة في ADR. أهمها:

1. ينفذ المنسق Infrastructure adapter لـfind عبر SHA256 وunique المركب
   `companyId_userId_operation_keyHash`، وليس company+key؛ المصدر الأصلي يثبت وجود
   userId في lookup الطبيعي وتسوية P2002. لا Prisma مباشرة من POS إلى سجل البنية.
2. يضيف المنسق OpenAPI/hashes/guards وrouter لـPOST recovery بجسم UUIDv4 وحده،
   pos.checkout وCSRF وentitlement وno-store والحدود الحالية. ينفذ authorize callback
   الخادمي الحالي مرتين كما يطلب recover، ولا يحقنه كدالة ثابتة تعيد السياق بلا تفويض.
3. يطابق المنسق projection الحالي بالـvalidator المولد لنتيجة Checkout عند الربط؛
   لا schema طلب Zod بديل ولا ملف مولد معدل يدويًا في هذه الشريحة.
4. يربط controller داخل تجربة PosPage المعزولة بالهوية والنشاط؛ يعطل الإدخال والمسح
   والبيع ما لم تكن ready، ويراعي legacy attempt الموجودة. لا مساري إرسال متوازيين.
5. ينتظر FIFO وprofile requests قبل begin وnewSale؛ لا يمسح السلة أو يعيد تركيز
   scanner إلا بعد أن يعيد newSale true. التحقق من النتيجة لا يعيد مسح الباركود أو
   بناء السلة/السعر. جميع البنود والأموال تبقى عند مالكيها الحاليين.

## الأدلة المحلية

الجولة النهائية على أساس الشيفرة المذكور: **102/102 ناجحة، صفر failed، صفر skipped**،
في7 ملفات و1.78 ثانية، pool threads وعامل واحد دون توازٍ بين الملفات:

| المجموعة | العدد |
|---|---:|
| controller/state/refresh/storage/scope |46|
| خدمة API وإسقاط النتيجة |32|
| المكوّن بأربع لغات وRTL/LTR وحجب العرض |6|
| browser-port wiring بمحاكاة window/navigator |2|
| regressions الحالية لسلامة POS |8|
| سجل uncertainty الحالي لملف البيع |5|
| سلة POS الحالية |3|

التغطية الجديدة تشمل: ضياع الاستجابة ثم reload بلا replay،هوية المفتاح الأصلية،
23h/24h/ساعة راجعة،رفض401/403/404/409/422/500 مع بقاء القفل،JSON تالف أو زائد الحقول،
quota/storage unavailable/discarded write،اختفاء marker قبل الإرسال،تبويبين وضغط مزدوج،
Web Locks غير المدعومة،storage-event لا يفتح ولا يؤكد،late result بعد logout أو
تبديل المستخدم/النشاط أو الصلاحية،رفض foreign evidence،النتيجة التاريخية،وDecimal
الكبير دون Number. حراسة التبويبات هنا اختبار عقد serialization بمحاكاة، وليست
دليل تنفيذ Web Locks في Chrome فعلي.

نجح فحص TypeScript المحدود للواجهة والسياسات/tests ونجح فحص API مستقل NodeNext.
المحاولة الأولى للأنواع وجدت نقص `vite/client` في config الجديد لتعريف استيراد CSS؛
أضيفت الأنواع في config المعزول ثم نجحت إعادة الفحص. لم يُضعف strict أو أي فحص.
نجح `git diff --check`،وكل تغييرات الشيفرة18 ملفًا **جديدًا** داخل ملكية N1؛ لم يتغير
ملف قائم. يضيف هذا التسليم ملفًا توثيقيًا19.

الأوامر من جذر نسخة D، باستعمال Node المثبت دون تنزيل:

```powershell
$env:TEMP='D:/CodexWorktrees/pos-durable-recovery/tmp/agent/temp'
$env:TMP=$env:TEMP
$env:GOMAXPROCS='2'
$env:GOMEMLIMIT='1536MiB'
$taskNode='C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $taskNode node_modules/typescript/bin/tsc -p pos-recovery-tsconfig.json --noEmit
& $taskNode node_modules/typescript/bin/tsc -p pos-recovery-api-tsconfig.json --noEmit
& $taskNode node_modules/vitest/vitest.mjs run --config pos-recovery-vitest.config.ts --configLoader runner --reporter=default --reporter=json --outputFile=tmp/agent/pos-recovery-tests.json
git diff --check
```

التقرير: `tmp/agent/pos-recovery-tests.json`، SHA256:
`7D65463AC753C428F2B7AFB880C17872E39DBCAD510D9C1CE114ED022AAAC152`.
سجلا الأنواع: `tmp/agent/pos-recovery-typecheck.log` و
`tmp/agent/pos-recovery-api-typecheck.log`، فارغان لأن النتيجة exit0 بلا أخطاء.
cache في `tmp/agent/pos-recovery-vite` وTEMP في D فقط، artifacts غير مدخلة إلى Git.

## الحدود والمخاطر المفتوحة

- لا HTTP API adapter أو integration route أو تركيب App/PosPage/server، ولا
  OpenAPI/Prisma/migration/composition/CI تغيّر هنا. إغلاقها مسؤولية المنسق.
- لا DB ولا بوابتا MariaDB10.11/MySQL8.4 أو fresh+upgrade أو DB E2E؛ لا Prisma
  generate أو عميل غير مطابق أو install/ci/download. لم تكتب أدوات الفحص إلى
  node_modules المشتركة؛ استخدم configLoader runner وكاش D مستقلًا.
- لا متصفح فعلي أو screenshots أو عرض390/768/1440 أو اختبار أجهزة. اللغات الأربع
  وRTL/LTR فُحصت عبر SSR فقط؛ لا ادعاء visual QA. لم تُفتح المنافذ3150/4200 ولم
  تبدأ خدمة أو توقف عملية. لا full suite.
- لا استرجاع بعد expiry الخادمي أو تنظيف سجل Idempotency. PosSale correlation
  دائم مؤجل إلى ADR مستقل، ولا تُستخدم المبيعات الحديثة لتخمين النتيجة.
- العلامة لا تنجو من مسح بيانات الموقع/تلف التخزين/فقد الجهاز، ولا تحمي تبويب
  إصدار سابق لا يشارك الحراسة. انتقال الإصدار والتبويبات القديمة مطلوب قبل الإتاحة.
- جميع نتائج الإرسال غير المؤكدة بعد حجز marker تبقى مقفلة، حتى أول business
  rejection، لأن العقد الثنائي لا يثبت FAILED. يتطلب ذلك مراجعة مسؤول، ولا يقدم
  المسار زر تجاوز أو workflow تسوية خادميًا غير معتمد.
- باركود Inventory وFIFO لم يتغيرا. اختبار حراسة props لا يغني عن اختبار الربط
  الحقيقي وعدم إدخال مسحة إلى البيع التالي؛ لا كاميرا/طابعة/قارئ/درج نقد مختبر.
- لا Push/PR/Merge/Deploy،ولا تعديل source في C أو ملفات مسار آخر. لا اعتماد على
  تشغيل PR45 أو تعطيله بهذه الشريحة.
