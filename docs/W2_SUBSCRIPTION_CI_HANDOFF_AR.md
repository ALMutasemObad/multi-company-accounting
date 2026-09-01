# W2 — بوابة قبول الاشتراك الدائمة

الحالة: اجتاز المشغّل الجديد القبول المحلي على Windows في النافذة `W2-SUBSCRIPTION-CI-20260831-A`: الحراس35/35، قائمة58، الأنواع، ثم58/58 بمحاولة واحدة. لا نشر أو push أو تغيير في المنتج أو fixtures أو assertions. لم تُشغّل خطوة GitHub/Linux بعد، ولا يُورّث نجاح W1 لهذا المشغّل.

## نطاق البوابة

الأمر `npm run subscription-acceptance:test` يشغّل ستة specs مرة واحدة في مشروع Chromium واحد، بعامل واحد وretry صفر و`forbidOnly: true`. مصفوفة اللغة/المقاس داخل الاختبارات نفسها، وليست projects إضافية.

| الملف تحت tests/subscription-discovery | الحالات |
| --- | ---: |
| plan-navigation.spec.ts | 10 |
| wave1/acceptance.spec.ts | 13 |
| wave1/defects.spec.ts | 3 |
| wave1/qa-fixes.spec.ts | 12 |
| wave1/visual-fixes.spec.ts | 6 |
| wave1/d3-context.spec.ts | 14 |

`scripts/subscription-acceptance/expected-cases.json` يحفظ أسماء الحالات الـ58 من تقرير W1 المقبول ذي SHA256 `4c77e6e6c6eb390350ca20d579ee13412a0b368cdc25f132e6db28c89da9aa47`. المقارنة القرائية أكدت 58 اسمًا فريدًا بلا نقص أو زيادة. هذا مصدر الأسماء فقط، ولا يعتمد التشغيل على ذلك التقرير أو أي مسار محلي قديم. لا توجد آلية تحدث المصفوفة من collection؛ تعديلها يحتاج مراجعة نطاق صريحة.

الحارس يتحقق من الهوية file/title/project ومن حالة expectedStatus ومن نتيجة passed واحدة بمحاولة صفر لكل حالة؛ ويرفض النقص والتكرار والتصفية وskip/fixme وexpected-fail وretry/repeat وtimeout والانقطاع والخطأ العام. الـreporter يعيد failed إلى Playwright عند مخالفة العقد أو تعذر حفظ التقرير؛ لا يكفي exit سابق أو عدد aggregate. `list` يتحقق من الأسماء دون ادعاء تنفيذ، ولا يقبل أي نتائج تشغيل.

## الأوامر والمخرجات

أوامر التحقق، بالتسلسل وبعد تخصيص الموارد:

```text
node --max-old-space-size=768 --test --test-concurrency=1 scripts/tests/subscription-acceptance-gate.test.mjs scripts/tests/subscription-acceptance-launcher.test.mjs
npm run subscription-acceptance:list
npm run subscription-acceptance:typecheck
npm run subscription-acceptance:test
```

يمكن استخدام Node القائم مباشرة بدل npm في البيئة المحلية:

```text
node --max-old-space-size=768 scripts/subscription-acceptance/run.mjs list
node --max-old-space-size=768 node_modules/typescript/bin/tsc --noEmit -p tsconfig.subscription-acceptance.json
node --max-old-space-size=768 scripts/subscription-acceptance/run.mjs
```

الـentrypoint لا يقبل filters أو flags إضافية. كل استدعاء ينشئ مجلدًا جديدًا تحت `test-results/subscription-acceptance/run-*` أو `list-*` نسبةً إلى جذر المشروع، لذلك تبقى جميع المخرجات على قرص الشجرة محليًا، وفي المسار القياسي على CI. لا يعيد استعمال أدلة قديمة ولا ينظفها. يحتاج Chromium مثبتًا مسبقًا؛ لا تنزيل أو install داخله. متغير `SUBSCRIPTION_BROWSER_EXECUTABLE_PATH` اختياري لمسار متصفح موجود. يحسم المسار من بيئة التثبيت الأصلية قبل تحويل cache/profile، بما يشمل Linux XDG وWindows، ثم يمرره صراحةً إلى launchOptions. يرفض المسار النسبي أو الشبكي أو الدليل أو الملف المفقود، ويتحقق من صلاحية التنفيذ على Unix. المسار الصريح الفارغ/الفاسد يفشل، ولا يعود إلى متصفح آخر.

الملفات: `invocation.json` (البصمة/البيئة غير الحساسة)، `readiness.json`، `gate-report.json`، `results.json`، `html/`، `artifacts/`. يحتفظ CI بهذه فقط، دون temp/cache/profile. `accepted: true` في gate-report خاص بالتنفيذ؛ collection تستعمل `collectionValid` ولا تمنح قبولًا. يحفظ invocation رقم commit من GITHUB_SHA على CI؛ محليًا يلزم تسجيل HEAD وفرق المصدر مع أدلة النافذة.

## ملكية العمليات والعزل

Playwright هو مالك حياة خادمين فقط: fixture على `127.0.0.1:3166` وVite على `127.0.0.1:4216`. الجاهزية الأولى stdout صادر عن الطفل الذي أطلقه؛ fixture يطبعه داخل listen، وVite يستخدم strictPort. `reuseExistingServer: false`، ولا URL readiness بديل يستطيع listener قديم تلبيته. بعد ذلك يفحص globalSetup استجابة fixture وHTML محليين. تضارب المنفذ يفشل بدء الطفل، ولا يحاول إيقاف مالك سابق.

يستعمل cleanup الأصلي لـPlaywright شجرة الطفل الذي أطلقه على Windows ومجموعة عمليته على Unix عند النجاح والفشل والمهلة. لا يوجد taskkill بالمنفذ، ولا اكتشاف/قتل خوادم خارجية. إنهاء العملية قسرًا من نظام التشغيل قد يمنع أي cleanup أو تقرير؛ ليس ذلك نجاحًا ولا تداركه البوابة بقتل عمليات أخرى. يلزم التحقق من تحرير المنفذين بعد الجولة المحلية.

TEMP/TMP/TMPDIR وXDG cache/config وUSERPROFILE/APPDATA/LOCALAPPDATA وكاش Vite داخل مجلد الجولة. NODE_OPTIONS للطفل/worker يحد heap إلى768MiB؛ GOMAXPROCS=2 وGOMEMLIMIT=1536MiB. NODE_COMPILE_CACHE يمسح، والاعتماديات المشتركة لا تكتب. تمسح بيئة التشغيل الموروثة الخاصة بقاعدة البيانات وDB gates والبريد ومزودي الدفع، دون طباعة قيمها أو تعديل بيئة النظام. fixture محلي بلا DB أو بريد أو دفع حقيقي؛ هذه البوابة ليست إثبات DB أو عملية مالية حقيقية.

## CI والحدود

تغيير `.github/workflows/ci.yml` محصور في خطوة types ثم58 ورفع artifact داخل job `verify` الذي يستخدم MySQL، بعد Chromium والبوابات القائمة وقبل e2e MySQL. لا jobs أو services أو concurrency جديدة. اختبارات حارس التقرير تنضم إلى `infra:test` القائم. `tsconfig.subscription-acceptance.json` يشمل specs الاشتراك والـconfig والـreporter صراحةً. بوابات API/DB وHTTP201 القائمة لم تتغير؛ لا تضعف البوابة سيناريوهات mismatch/403/CSRF أو حماية المحاولة المالية، ولا تصلح سياقات خارج الاشتراك.

المراجعة المصدرية المستقلة أكدت استعمال lifecycle وstdout وreporter override المدعومة في Playwright المثبت. عُولجت ملاحظتها عن حسم Chromium قبل نقل XDG. اختبارات launcher الناجحة تغطي PLAYWRIGHT_BROWSERS_PATH الصريح وLinux default cache وWindows profile ببديل محدود لدالة الاكتشاف، وملفًا محليًا غير صالح، وانتقال المتغيرات إلى child mock بلا credentials، بما فيها DB_PASSWORD وMYSQL_PWD وMARIADB_PASSWORD. لا تقلد implementation لاكتشاف Playwright ولا تثبت تشغيل Linux فعليًا. اختبار readiness يرفض503 مباشرةً ولا يحاول listener بديلًا. تحقق التشغيل الفعلي على Windows؛ يبقى Linux/GitHub CI غير مشغّل لهذه الحزمة. نافذة المتصفح المحلية تشترط C≥1GiB وRAM حرة≥3GiB وملكية حصرية، ولا تبدأ ما دام عامل آخر يملك runtime.

## القبول المحلي والأدلة

| الفحص | النتيجة | الزمن المسجل للعملية |
| --- | --- | ---: |
| الحراس المركزة | 35/35، zero skipped/cancelled، exit0 | 1.047ث |
| list | 58 اسمًا في6specs، collectionValid=true، accepted=false | 2.063ث |
| noEmit | config/specs/reporter، exit0 | 1.047ث |
| Chromium | 58/58، accepted=true، نتيجةpassed واحدة retry0 لكل اسم، exit0 | 186.203ث |

أُجريت السلسلة في2026-08-31 ابتداءً من18:18UTC بNode مباشر وCMD/Python، دون PowerShell أو npm install أو DB أو إعادة جولة. كانت C الحرة3.73GiB وRAM الحرة4.36GiB عند الحفظ الأول، وبعد المتصفح C3.73GiB وRAM4.17GiB. فحص الموارد والمنفذين تكرر قبل كل أمر. كانت بصمات30ملف مصدر وHEAD `e3d6ba03aec8ceabd42428d67855fad2683968a6` متطابقة قبل وبعد التشغيل؛ لم يلزم تعديل المرشح. تحديث هذه الوثيقة بالنتائج جاء بعد حفظ مصدر القبول.

دليل القائمة: `test-results/subscription-acceptance/list-d9fRjw/`. دليل الجولة الجديدة: `test-results/subscription-acceptance/run-O1389C/`. الأسماء الفعلية والحالات والمحاولات محفوظة في gate-report/results؛ missing/extra/issues/errors كلها فارغة. لم تتغير أدلةW1.

الأوامر وexit/time وstdout/stderr وصورتا المصدر محفوظة محليًا تحت `tmp/coordination/w2-ci/validation-A/`، وهي أدلة مرجعية خارج Git وليست اعتمادًا للمشغّل الدائم. بصمات SHA256:

- gate-report: `714476d0e72478656fefb7a79210aafd94db1c94562cc432263a3fc0721ca83a`.
- results: `3083f3fc97ad5d2f719eef9df6c59373932457fb2685eda0eaf4996b3c801999`.
- summary: `fd56f7462b91cfd2b2a44f93f248dafb5257a3358f96311d221b0555688ef9d5`.
- جرد42ملف دليل (لا profile/cache): `9a5b536c05c3ee32acc1da3dfc2e682f4ecd73f0dcaa9e5a155bd9919133df1f`.

رُصد الخادمان PID23972/22008 تحت عملية Playwright المملوكة PID11044، ثم انتهيا؛ خلو3166/4216 مثبت قبل وبعد. أدرج مراقبPID المحلي عمليةAnyDesk قديمة خطأً عبر رقمparent أُعيد استخدامه؛ `cleanup-verification.json` يثبت أنها بدأت10:36UTC قبل عملية البوابة18:18UTC. لم يوقف المراقب أي عملية ولم تُمس تلك العملية؛ لا عملية مملوكة متبقية. هذه ملاحظة على مراقب الأدلة المحلي، لا تعديل في lifecycle الدائم ولا ادعاء ملكية لعمليات المستخدم. حُررت نافذةruntime والمتصفح صراحةً بعد التحقق.

المراجعة النهائية المستقلة: لا findings متبقية ضمن حارس البيئة/CI/الملكية؛ diff الاختبارات الستة والـfixtures فارغ مقابلHEAD. بقيت تحذيرات NO_COLOR/FORCE_COLOR غير مؤثرة، ورسائل dictionary-load-failed المقصودة ضمن اختبار D2؛ جميع الحالات نجحت. لا ادعاء قبول DB أو دفع حقيقي أو تشغيل Linux/CI عن بُعد. مقاطعات قنوات PowerShell السابقة ليست إخفاق اختبارات.
