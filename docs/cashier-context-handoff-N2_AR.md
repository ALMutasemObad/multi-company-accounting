# تسليم N2 — سياق الكاشير

التاريخ: 2026-08-31. النسخة `D:/CodexWorktrees/cashier-context-experience`،
الفرع `feat/cashier-context-experience`، الأساس `39c1de87b45e481ccdfe66a18a33336d8f32b8f9`.
تسليم معزول للمنسق، وليس ميزة مركبة أو منشورة في POS.

## commits المحلية

- `33ba21e` — منفذ وسياسة وQuery Adapter لحل الفترة عند Core Accounting، و24 اختبار unit.
- `10d0ed8` — سياسة/controller/Panel/CSS وقاموس مستقل بأربع لغات واختبارات وإعدادات تحقق معزولة.
- commit التوثيق الذي يحمل هذه الوثيقة والعقد لا يغير الشيفرة السابقة.

كل ملفات التغيير جديدة وضمن الملكية. لم تتغير PosPage/App/shared أو fiscal-service/
Posting أو schema/OpenAPI/generated أو package/lockfiles أو CI. لا Push/PR/Merge/Deploy.
أُجريت أوامر Git من نسخة D المعينة؛ ملف .git لهذه الـworktree المنشأة من المنسق يشير
إداريًا إلى مستودع Git المشترك تحت نسخة C الأصلية. اقتصرت كتاباته على metadata المعتادة
لـindex/objects/commits؛ لم أعدل شجرة المصدر أو إعدادات Git أو ملفات المشروع في C.

## ما أصبح قابلًا للتركيب

- `apps/api/src/core-accounting/cashier-context-period-{port,policy,adapter}.ts`:
  يوم ISO حقيقي، company من Actor، take2 مع جميع الحالات، ونتائج MISSING/CLOSED/
  AMBIGUOUS/RESOLVED. لا lookup موازٍ في الواجهة ولا قفل/ترحيل في advisory.
- `apps/web/src/cashier-context-model.ts` و`cashier-context-controller.ts`:
  أولوية مسودة صريحة، تذكر جلسة بقرار الكاشير، ثم إعداد شركة موثق؛ التحقق exact-id
  عبر Port. null الصريح أو المرجع غير المتاح لا يستبدل بافتراض أدنى.
- `apps/web/src/CashierContextPanel.tsx` و`cashier-context-panel.css`:
  القيم والمصدر وحالة التحقق والفترة الخادمية، مع حفظ مسودة صريح وتذكر اختياري؛
  slot اختيار مراجع للمالك، ولا إرسال Checkout أو حفظ مالي.
- `apps/web/src/i18n/locales/cashier-context.ts`: ar/en/hi/ur مستقل دون تعديل registry.
- اختبارات `apps/api/tests/cashier-context-period.test.ts` و
  `apps/web/src/cashier-context-{controller,panel}.test.*`، وfixtures مستقلة.
- إعدادات `cashier-context-{web,api}.tsconfig.json` و
  `cashier-context-{vitest,vite}.config.ts` لا تكتب cache أو build إلى node_modules.

تفاصيل DTO وحدود الربط والتفويض وBarcode Impact وقائمة المراجعة في
[عقد N2](cashier-context-contract-N2_AR.md). طلب الربط أرسل واعتمد مبكرًا لدى المنسق؛
لم يُنشأ endpoint مشترك استباقًا لذلك الاعتماد.

## السلوك الآمن

الحفظ والتذكر مختلفان: تعديل الحقل لا يكتب فوق مسودة محفوظة إلا بضغط حفظ؛ ولا
ينشئ تفضيلًا للبيعات التالية إلا بعد اختيار الكاشير الصريح. لا بقاء بعد إغلاق الصفحة
أو تبديل الشركة/المستخدم/الصلاحيات، ولا storage دائم أو محاولة مالية في هذا السياق.
تُلغى القراءات، ولا تعيد الاستجابة القديمة label أو period بعد تبديل النطاق.

لا نافذة تأكيد متكررة للسياق الثابت: بعد التذكر الصريح والقراءة الجديدة من المالك،
يمكن إعادة استخدام المراجعة إذا تطابقت القيم والنسخ والأسماء والتاريخ والفترة.
تغير المرجع/التاريخ/الصلاحيات أو انتهاء المهلة يلزم مراجعة. خمس دقائق نافذة freshness
للواجهة قابلة للضبط، وليست SLO أو صلاحية محاسبية أو ضمانًا لعدم تعطيل المرجع.
لا تمتد مهلة المراجعة الأصلية بالتكرار، ولا يمدد الضغط على «اعتماد» تحققًا منتهيًا.
يبقى التحقق والقفل ومطابقة تاريخ الفترة داخل أمر الخادم إلزاميًا لكل بيع.

lock يمنع التعديل والاعتماد وبدء بيعة جديدة أثناء scanner/profile pending أو محاولة
Checkout المعلقة/المجهولة/المكتملة. المالك وحده يحسم المحاولة ويسمح ببيعة جديدة.
لا تغيير للعملة دون المرور بمعالجة أسعار POS الحالية، ولا استنتاج لسعر الصرف 1.

## القياس وخط الأساس المصحح

فُحص `PosOperatingContext.tsx` و`PosPage.tsx` عند الأساس نفسه. تصحيح مهم:
«بيع جديد» الحالي يمسح السلة ونتيجة المحاولة لكنه يحتفظ بالسياق داخل الصفحة.
لا يصح وصفه بأنه يفرض خمسة اختيارات في كل بيعة.

| السيناريو | قبل: الشيفرة القائمة | بعد: الشريحة المعزولة |
|---|---|---|
| عناصر السياق المستهدفة | 5 أدوات اختيار ظاهرة: فترة، مستودع، صندوق، طريقة، عملة | 4 قيم ومصادر مرئية مع أزرار تغيير؛ الفترة عرض خادمي بلا أداة اختيار |
| أول تهيئة بلا تفضيلات | 4 اختيارات يدوية عادةً إذا نجح تحميل العملة الأساسية الضمني؛ وإلا5 | 4 تغييرات مرجع صريحة + مراجعة واحدة؛ حفظ المسودة والتذكر اختياريان |
| بيعة تالية في الصفحة، السياق ثابت | 0 إعادة اختيار، ولا مراجعة إضافية للسياق | 0 تغييرات مرجع و0 مراجعات إضافية بعد تذكر صريح وتحقق حديث مطابق |
| تغير التاريخ | يبقى periodId يدويًا في السياق الحالي | يبطل الاعتماد ويحل الخادم الفترة من التاريخ الجديد |
| إعادة تركيب الصفحة/تبديل النطاق | تختلف عن NewSale؛ لا يصح خلطها في القياس | عمر controller يحد الذاكرة؛ تبديل النطاق/reload لا يستعيد تفضيلات مخفية |

عداد الاختبار يثبت للتهيئة: `fieldChange=4, saveDraft=1, review=1, remember=1`؛
وللبيعة التالية بعد التذكر: الأربعة تساوي صفرًا. هذه فئات إجراءات controller،
وليست قياسًا لعدد ضغطات الفأرة على combobox. يتطلب عدّ النقرات الفعلية والزمن
البشري تركيب picker المالك ثم متصفحًا منسقًا؛ لم يُشغّلا بطلب المنسق.
الساعة المحقونة في الاختبار تثبت حساب elapsedMs فقط، ولا تقدم قياس أداء أو نسبة تسريع.
القياسات لا تحمل تاريخًا أو معرف شركة/مستخدم/مرجع أو أسماء أو مبالغ أو باركود.

## أدلة التحقق وحدودها

جميع الأوامر من نسخة D. TEMP/TMP إلى `tmp/cashier-context` في D،
`GOMAXPROCS=2` و`GOMEMLIMIT=1536MiB`، واختبارات Vitest بعامل1 بلا توازٍ للملفات.
استُخدم node.exe المثبت في runtime لأن `node` غير موجود في PATH غير التفاعلي.
الاعتماديات junction للقراءة فقط؛ لم أنفذ install/ci/download/Prisma generate.

| التحقق | النتيجة المثبتة |
|---|---|
| آخر جولة مجمعة معزولة قبل آخر تعديل ويب |61 passed،0 failed/skipped: API24 + controller31 + Panel6؛ `tmp/cashier-context/unit.json` |
| إعادة Web النهائية بعد إضافة حفظ المسودة أثناء القراءة |38/38 passed،0 failed/skipped،ملفان؛ `tmp/cashier-context/web-final.json` |
| Core Accounting النهائي |24/24 من الجولة السابقة، لم تتغير ملفات API بعدها ولم تعاد جولة API أثناء إغلاق PR45 |
| TypeScript Web للنطاق النهائي |pass exit0؛ `cashier-context-web.tsconfig.json` |
| TypeScript API للنطاق |pass exit0؛ `cashier-context-api.tsconfig.json`؛ لا Prisma runtime أو DB في التحقق |
| بناء مكتبة Panel المعزولة |pass exit0؛ CSS1.86kB وJS18.21kB في `tmp/cashier-context/component-build`؛ ليس build التطبيق الكامل |
| Git staged whitespace check |pass؛ لا تعديل tracked خارج الملفات الجديدة |

المحصلة 62 حالة متميزة ناجحة (24 API unit +38 Web)، وليست نتيجة full suite أو
62 اختبارًا في تشغيل واحد. جولات التطوير السابقة بدأت59 ثم60؛ فشل اختبار واحد
أثناء التوسعة لأن توقعه خلط انتهاء عمر المراجعة بعمر آخر قراءة مرجع، وصُحح التوقع
مع الإبقاء على منع قبول تحقق منتهٍ. فحص الأنواع الأول افتقد تعريف استيراد CSS في
config المعزول؛ أضيف vite-env.d.ts الموجود وأعيد الفحص بنجاح. لم تخفف اختبارات أو حراس.

أوامر إعادة الإنتاج (بالترتيب، مع `$nodeExe` إلى runtime المثبت وTEMP/TMP في D):

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run --config cashier-context-vitest.config.ts --configLoader runner --reporter=json --outputFile=tmp/cashier-context/unit.json
& $nodeExe node_modules/vitest/vitest.mjs run apps/web/src/cashier-context-controller.test.ts apps/web/src/cashier-context-panel.test.tsx --config cashier-context-vitest.config.ts --configLoader runner --reporter=json --outputFile=tmp/cashier-context/web-final.json
& $nodeExe node_modules/typescript/bin/tsc -p cashier-context-web.tsconfig.json --noEmit --pretty false
& $nodeExe node_modules/typescript/bin/tsc -p cashier-context-api.tsconfig.json --noEmit --pretty false
& $nodeExe node_modules/vite/bin/vite.js build --config cashier-context-vite.config.ts --configLoader runner
```

## ما لم يُنفذ وما يلزم المنسق

1. OpenAPI/Router/app/composition الفعلية لحل الفترة، وexact-id ports للطريقة والعملة.
   لا يستخدم بديل GET شامل، ولا يعتبر غياب مرجع من أول صفحة دليل تعطيله.
2. تركيب Panel/controller وpicker/الترجمات في POS، وتمرير تغير المستخدم/الشركة/
   الصلاحيات والlocks، وفحص getReviewed عند submit، وربط payment metadata دون
   اختلاق PaymentMethod، ومعالجة تغير العملة عبر مالك POS الحالي.
3. المتصفح الحي بأربع لغات وعلى390/768/1440 وقياس النقرات والزمن. اختبارات Panel
   الحالية renderToStaticMarkup فقط؛ لا دليل responsive بصري أو أحداث متصفح.
4. Barcode integration regression بعد الربط، بما فيه FIFO وleading zeros وفشل
   resolve وتبديل النشاط أثناء قراءة. اختبارات lock الحالية ليست محاكاة HID أو جهازًا.
5. DB integration لإثبات عزل ومطابقة/تزامن الفترات على المحركات المعتمدة. لم تُشغّل
   MariaDB10.11/MySQL8.4 أو fresh+upgrade أو DB E2E أو قاعدة بديلة، ولا ادعاء نجاحها.

لا خادم أو متصفح أو جهاز أو منفذ3151/4201 شُغّل في N2، ولا شيء يلزم إيقافه.
لم تنفذ contracts:check أو Redocly أو full suite لأن العقد العام لم يتغير والربط
لم يُنشأ. هذه بوابات التركيب المقبلة، وليست نجاحًا مفترضًا أو skip مخفيًا.
