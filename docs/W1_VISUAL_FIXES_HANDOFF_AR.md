# W1-V1/V2 — حزمة CSS مستقلة غير مشغلة

## الحالة والنطاق

مرشح مصدر فقط، بعد تخصيص المنسق V1/V2 بأولوية P1. النسخة `D:/CodexWorktrees/wave1-subscription-acceptance` والفرع `test/wave1-subscription-acceptance` وHEAD `c7ffc99306a180387bb1a618d0d2750f762bf48b` لم تتغير.

**لا تشغيل أو typecheck أو build أو collection أو متصفح أو صور after أو commit لهذه الحزمة.** لا دليل بعد التعديل بعد، ولا قبول بصري نهائي. لا عمليات دفع فعلية، ولا تعديل لمنطق الدفع أو الصلاحيات أو JSX أو البيانات التجارية. ملكية المتصفح والخادمين3166/4216 محررة كما أُبلغ المنسق بعد الجولة الأولى، ولم نبدأ خوادم جديدة.

هذه الحزمة مستقلة عن قبول الجولة الأولى وعن D1/D2. مصادر v1/v2 وبصماتها مجمدة تحت `tmp/coordination/w1-qa-fixes/`. أدلة الجولة الأولى بقيت ثابتة: آخر مقارنة مصدرية لبصمات58ملفًا في manifest أظهرت صفر اختلاف.

## العيبان المثبتان قبل التعديل

أكد المنسق الصورتين عند1024:

- **V1:** الرقم100 في Recorded allowance يتجزأ إلى10 ثم0 بالإنجليزية؛125 سليمة.
- **V2:** أزرار محاولات الدفع مقصوصة عند حافة البطاقة ومتداخلة مع الوقت بالعربية والإنجليزية. ليست هذه منطقة جدول الفواتير القابل للتمرير.

الدليل الأصلي المحفوظ:

`tmp/coordination/subscription-acceptance/e2e/wave1-acceptance-en-1024-p-e587e-subscription-and-owner-home/subscription-missing.png`

`tmp/coordination/subscription-acceptance/e2e/wave1-acceptance-ar-1024-p-6fe77-subscription-and-owner-home/subscription-missing.png`

هذه صور baseline وليست صورًا للمرشح الحالي.

## ما تغيّر في CSS

| الملف | التعديل وسببه |
|---|---|
| `apps/web/src/subscription-usage.css` | صف القيمة والتسمية أصبح grid: عمود تسمية قابل للالتفاف وعمود قيمة auto. أزيل `overflow-wrap:anywhere` عن القيمة، فلا ينكسر العدد100 تحت ضغط التسمية الطويلة؛ التسمية تستطيع الالتفاف داخل عمودها. |
| `apps/web/src/styles.css` ضمن `.subscription-payment-list` فقط | أصبحت بيانات المحاولة والأزرار مجموعات flex قابلة للانتقال إلى سطر تالٍ بحسب المساحة المتاحة، بدل ثلاثة أعمدة ذات مجموع حدود أدنى أكبر من البطاقة. يلتف التاريخ/provider داخل مجموعته، وتلتف أزرار الإجراءات مع مسافة8px ونص مسموح له بالالتفاف داخل أقصى عرض المجموعة. |

تحافظ قواعد≤600 على المجموعات عمودية. لم تتغير نقاط توزيع billing الرئيسية: عند768 يبقى عمودًا واحدًا، وعند1024/1440 تبقى شبكة billing القائمة؛ يحدد **عرض البطاقة الفعلي** عدد مجموعات المحاولة الممكنة في الصف. لا اشتراط لإبقائها بجانب بعضها إن كانت المساحة لا تكفي.

لم نعدل font-size أو متغيرات الخطوط أو `.button`/`.panel` العامة أو overflow العام، ولم نخفِ عنصرًا أو نضف overflow visible. بقي محتوى جدول الفواتير وتمريره كما هو. لم نحتج تعديل `SubscriptionBillingCenter.tsx` أو `CompanySubscriptionUsagePanel.tsx`. لا خط زخرفي أو إعادة تصميم خارج النطاق.

## مصفوفة اختبار مكتوبة فقط

الملف `tests/subscription-discovery/wave1/visual-fixes.spec.ts` يعرّف6حالات مستقلة:

| اللغة | العرض | الحالة الحالية |
|---|---:|---|
| ar | 768 | مكتوبة، غير مشغلة |
| ar | 1024 | مكتوبة، غير مشغلة |
| ar | 1440 | مكتوبة، غير مشغلة |
| en | 768 | مكتوبة، غير مشغلة |
| en | 1024 | مكتوبة، غير مشغلة |
| en | 1440 | مكتوبة، غير مشغلة |

تعتمد كل حالة تطبيق الويب الفعلي مع fixture محلية لمالك، وخطة URL غير موجودة، وبدون login/DB/payment حقيقي. تنتظر تحميل الخطوط وبيانات الاستخدام ومحاولة الدفع قبل القياس، ثم:

1. تتأكد أن allowance تظل100 بعد توحيد شكل الأرقام، وأن مستطيلات النص تقع على سطر واحد، وأن قيم الاستخدام داخل بطاقاتها.
2. تقيس حدود البطاقة ومحتواها ومجموعات البيانات والأزرار ونصوصها؛ ترفض خروجها أو تداخلها أو overflow الأفقي. لذلك لا يكفي رفع overflow أو إخفاء القص لنجاح الاختبار.
3. تحفظ هندسة العناصر وحجم الخط الفعلي في JSON، وتكتب صورة صفحة كاملة باسم `subscription-after-candidate.png` **عند التشغيل المستقبلي فقط**.
4. تختبر focus ومركز hit target لكل زر بلا click. تتحقق أن الطلبات التجارية غيرGET تساوي صفرًا؛ لا checkout/cancel/retry فعلي.

هذه فحوص هندسية مكتوبة، وليست بديلًا عن مراجعة الصور أو استخدام Browser skill التفاعلي لاحقًا. لا يوجد screenshot baseline assertion جاهز يُخفي عيبًا بتحديث مرجع. يجب مراجعة صور اللغتين والمقاسات الثلاثة، والنصوص الكاملة والأرقام والتدفق والتمرير ولوحة المفاتيح، ومقارنة أحجام الخطوط بالمصدر السابق.

## الملفات والحزمة

ملفا المنتج الوحيدان هما CSS أعلاه. الملفات الجديدة المرافقة:

- `tests/subscription-discovery/wave1/visual-fixes.spec.ts`
- `tests/subscription-discovery/wave1/visual-fixes-vite.config.mjs`
- `tests/subscription-discovery/wave1/visual-fixes-playwright.config.ts`
- `docs/W1_VISUAL_FIXES_HANDOFF_AR.md`

الحزمة: `tmp/coordination/w1-visual-fixes/wave1-visual-fixes.patch`.
الجرد: `tmp/coordination/w1-visual-fixes/source-manifest.json`.
نسخة المصدر المجمدة: `tmp/coordination/w1-visual-fixes/source/`.

الحزمة تضم6ملفات فقط، ولا تضم تغييرات D1/D2 أو قبول الجولة الأولى. تعتمد إعدادات الاختبار على harness القبول المحفوظ؛ المرجع المقترح للتحقق يجمع حزمة القبول ثم D1/D2v2 بدلv1 ثم هذه الحزمة. لا تعيد تطبيق v1 فوقv2.

## نافذة التحقق المستقبلية

يحتاج التشغيل تخصيصًا صريحًا جديدًا من المنسق للموارد والمتصفح/المنافذ. من النسخة المحددة، اضبط TEMP/TMP/npm cache/XDG cache/logs إلى `tmp/coordination/w1-visual-fixes/` على D، و`GOMAXPROCS=2` و`GOMEMLIMIT=1536MiB` و`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`، وأضف Node القائم إلى PATH كما في handoff D1/D2. لا install/ci أو تنزيل متصفح أو كتابة اعتماديات مشتركة.

```powershell
node node_modules/@playwright/test/cli.js test --config tests/subscription-discovery/wave1/visual-fixes-playwright.config.ts --workers=1
```

هذا config يختار الحالات الست فقط، ويستخدم `reuseExistingServer:false` ومخرجات/cache منفصلة في D. يسجل الاختبار الكامل في config D1/D2 **44حالة متصفح متوقعة من المصدر** بعد إضافة الست إلى38؛ الوحدات165 متوقعة كما في v2. لم يُنفذ collection لتأكيد الأعداد. تحفظ أوامر typecheck/حراس/build ونتائجها في مجلد المرحلة عند تخصيصها، تتابعيًا ودون retry تلقائي.

لا اختبارات DB شاملة الآن، ولا workflow أو نشر أو Git writes. نجاح الجولة الأولى18/26 و138وحدة ونتائج البناء القديمة لا ينسب لأي إصلاح في هذه الحزمة. D3 ما زال غير مثبت. نوقف التوسع بعد تجميد هذه الملفات إلى أن تتاح نافذة لإثبات المصدر المجمد.
