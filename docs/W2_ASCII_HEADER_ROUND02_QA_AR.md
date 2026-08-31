# W2 — نتيجة الجولة الثانية وتسليم النطاق المحدد

التاريخ: 2026-08-31. النسخة الحصرية `D:/CodexWorktrees/wave1-pdf-decimal`، الفرع `fix/wave1-pdf-decimal`، HEAD القائم `c7ffc99306a180387bb1a618d0d2750f762bf48b`. لا commits جديدة أو Git writes أو push/PR/merge/deploy، ولا DB/browser/install/Prisma generate.

اجتازت الحزمة التحقق المحلي المحدد **للرموز ASCII المنظمة والرأس واستمرار جداول R3**: 103/103 اختبارات، narrow noEmit types، استخراج12PDF، ومراجعة31PNG فعلية. لا يعني ذلك قبول النص المختلط أو Unicode العربي الشامل. بقيت مربعات الحروف في عينتي fallback الموروثتين خارج النطاق، كما هو موضح أدناه.

## قاعدة الحزم والإصلاح الأخير

ترتيب التطبيق، دون خلطه ببديل يبدأ من HEAD:

1. حزمة W1/R3 الموجودة، ومنها `delivery/revision-3/W1_PDF_COMBINED_R3.patch` إذا بدأ التجميع من HEAD المذكور.
2. `delivery/w2-header-1/W2_PDF_HEADER_DELTA.patch` بعد R3: `6F001880FBC1E7D0CA43244A7F3DFED919E9661586B4ACFD49A303E04424DFE7`.
3. `delivery/w2-ascii-1/W2_ASCII_ITEM_BLOCKS_DELTA.patch` بعد R3+header: `F6EF93582FC9692280BDABD25106E0B595B44DA0B4C9FFDE79397B6E25837409`.
4. **التصحيح الاختباري الجديد فقط**: `delivery/w2-ascii-test-2/W2_ASCII_TEST_R2_DELTA.patch` بعد ASCII أعلاه: `A12C6654E8FC793F59EF5E14EBA6B77ECF4DFB8C8A6B739ABDA140737935A6D3`.

كل المسارات السابقة تحت `tmp/coordination/`. التصحيح الأخير يضيف هوية حزمة BT إلى قارئ الاختبار ويعدّ الأسطر بـ`page:packet`، مع إبقاء توقعَي50/125 والإحداثيات والحدود والمال. لم يتغير renderer أو helper أو fixture أو خط بعد تجميد ASCII. دليله الدائم مستقل في `W2_ASCII_BT_DIAGNOSIS_AR.md`:125BT/250glyphY بإزاحة0.336pt داخل الحزمة، لا250سطرًا. بقي round01 محفوظًا بنتيجته102/103 وفشل assertion؛ لم يُعد تصنيفه نجاحًا.

بصمة الاختبار الجديد `apps/api/tests/pdf-invoice-item-codes.test.ts`:
`ECB710B724FEDA4D6ED216A23CE1700E205BF9896F9CD8CABDD5EC4D14557DEA`.

قائمة المصدر الجاري18ملفًا: `delivery/w2-ascii-test-2/working-source-hashes.json`، بصمة `C6A4BB61A8A29132537C96F177796D1FB832A5966822DD9CB13603DB95834488`. تغير الاختبار وحده من قائمة ASCII السابقة. البصمات18/18 مطابقة قبل التشغيل وبعد PNG. renderer الفعلي بقي `7FD323CDC768CD22C89BF67E571D4089CA722418F7667E6AF3DA362FD121AE08`؛ اختلاف line endings عن نسخة LF بالحزمة موثق في تسليم ASCII.

## نتائج التشغيل

مجلد الجولة الجديدة: `tmp/coordination/w2-qa-20260831-round02/`.

| المرحلة | النتيجة | المدة |
|---|---|---:|
| focused tests | 103/103،7ملفات،لا failed/pending/retry |64.60s حسب Vitest |
| narrow types | exit0،noEmit |2.188s |
| PDF |11جديدة +1محفوظة أعيد استخدامها بالبايتات نفسها |42.015s لمجموع أوامر التوليد |
| extraction |12/12،31صفحة،116خلية مالية،لا mismatch أو إخفاق هندسي ضمن الفاحص |18.237s |
| Poppler PNG |31/31،150dpi،كل صفحة بأمر مستقل |16.700s |

الـ103 تشمل65R3 +8header +24ASCII helper +6ASCII PDF. نجحت الآن الفحوص الواقعة بعد assertion السابق أيضًا، ومنها حدود الحروف وصفحات الاستمرار وتكرار رأس الجدول والمال وimmutability. التصحيح لم يغير عدد الاختبارات أو timeout.

أوامر الاختبارات والأنواع من جذر النسخة، عبر Node المثبت للقراءة فقط:

```text
node.exe --max-old-space-size=768 node_modules/vitest/vitest.mjs run --config tmp/coordination/w2-ascii/vitest.config.mjs --configLoader runner --retry=0 --reporter=default --reporter=json --outputFile=D:/CodexWorktrees/wave1-pdf-decimal/tmp/coordination/w2-qa-20260831-round02/tests.json
node.exe --max-old-space-size=768 node_modules/typescript/bin/tsc -p tmp/coordination/w2-ascii/tsconfig.json --noEmit --pretty false
```

المسار الكامل لـNode: `C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`. config ثابت: threads،worker1،no file parallelism،retry0،timeout30s. heap768MiB مباشر ومع `NODE_OPTIONS` للـworker، compile cache معطل. TEMP/TMP/profile/AppData/LocalAppData/cache/logs على D داخل الجولة؛ Vite cache كما في config داخل `tmp/coordination/w2-ascii/vite`. `GOMAXPROCS=2` و`GOMEMLIMIT=1536MiB`.

التوليد بأمر منفرد لكل عينة عبر `w2-round-prep/generate-one.ts`، والاستخراج عبر `extract-one.py` باستخدام Python المثبت، والرسم بـ`pdftoppm -f N -l N -singlefile -r 150 -png`. المصفوفة `w2-round-prep/pdf-matrix.json` وبصمات أدوات QA في `qa-source-hashes.json`. جميع الأوامر متتابعة بلا runtime إضافي.

لم يُعد توليد حالة استمرار الاسم والوصف: نُسخ PDF التشخيص نفسه ببصمة `D9CA23E5DA80CD4B350DFBD35710DE78E45EE6FB804872C7E79DA2EBEB18729F` إلى الجولة؛ renderer والـfixture لم يتغيرا. كل استخراج وصورة مبنيان على PDF محفوظ واحد، وتحققت بصمته قبل الرسم. الملفات السابقة لم تُستبدل.

حراسة الموارد قبل كل واحد من56أمرًا: أقل C حرة2.48294GiB وأقل RAM حرة3.95878GiB، فوق الحدين1/2.5GiB. انتهى آخر أمر Poppler عند **17:50:14.928+03:00** وأُرسلت فور انتهائه رسالة تحرير النافذة. لم يُشغّل بعدها Node/PDF/PNG؛ تمت قراءة الصور وكتابة التقرير فقط. `runtime-summary.json` يسجل تفاصيل الأوامر.

## المراجعة البصرية

شُوهدت31/31صورة بالحجم الأصلي:16لصاحب المسار و15لمراجع `pdf_path_audit` المستقل. `visual-review.json` يسجل لكل صورة مسارها وبصمة SHA256 وPDF المصدر والصفحة والمراجع والملاحظات. `png-plan.json` الأصلي بقي محفوظًا.

| العينة | الصفحات المشاهدة | الملاحظة |
|---|---|---|
| `ascii-limits-wrap` |1–2| رمزا40/20محرفًا يلتفان داخل كتلهما اللاتينية؛ العربية والمال والحدود واضحة. |
| `ascii-name-description-continuation` |1–6| item ص1،الاسم ص1–2،unit ص3،الوصف ص3–5،الصف التالي ص5،التوقيعات ص6؛ رأس متكرر ومال الصف الأول مرة واحدة. |
| `ascii-one-code` |1–2| `(U_9073-26)` وحده واضح؛ لا رمز item مخترع. |
| `ascii-guard-non-ascii` |1–2| whole-cell legacy محفوظ؛ مربعات حروف في الوصف ص1 خارج قبول ASCII، دون قص المال أو تداخل الرأس. |
| `ascii-guard-empty` |1–2| whole-cell legacy محفوظ؛ مربعات رمز الوحدة ص1 قيد موروث خارج قبول ASCII. |
| `ascii-guard-missing-item-name` |1–2| وصف الصنف فقط وفق الحارس القائم؛ لا رموز مخترعة. |
| `long-invoice` |1–3| ITM/UNIT ص2 واضحان دون مربعات R3 القديمة؛ الأرقام الكاملة والعربية ضمن الخلايا. |
| `multiline-journal` |1–3| هوية القيد مع أول مقطع وتكرارها في ص2/3؛ المال ص1 فقط؛ لا تداخل مع التوقيعات. |
| `ordinary-receipt` |1–2| العنوان والرقم والبطاقة متباعدة، والمال والتوقيعات واضحة. |
| `header-purchase-debit-note-w60` |1–2| العنوان العربي،رقم60Wعلى سطرين،badge والبطاقة منفصلة؛ الجسم يتبع البطاقة. |
| `header-wrap-helper` |1| عنوان عربي يلتف إلى4أسطر ثم رقم بسطرين وbadge منفصل؛ تشخيص helper فقط، وليس بطاقة/جسم مستند كامل. |
| `multiline-invoice` |1–4| وصف legacy مستمر ص1–3 مع رأس متكرر؛ هوية القيد والمال ص4 دون عنوان يتيم أو قص. |

المقارنات استخدمت صور R3 الموجودة فقط: `long-invoice-page-2`،`PURCHASE_DEBIT_NOTE-page-1`،وأول صفحة من `multiline-journal` و`multiline-invoice`. زالت مربعات ITM/UNIT في الحالة المستهدفة وتزاحم عنوان المستند ورقمه. لم يُعد رسم أي baseline. صفحات توقيعات بعض fixtures تعرض عنوان قيود دون صفوف لأن `entries=[]`؛ لم تُعتبر دليل بيانات قيود مفقودة.

## الحدود والعيوب المستقلة

- الاسم/الوصف المختلط وحساب code+name وشركة ACME ليست ضمن قبول ASCII. الحارس يتطلب raw printable ASCII لكل رمز حاضر مع حارس itemName القائم؛ وإلا يعود الوصف كله للمسار القديم. لا trim أو UAX9 مؤلف أو dependency جديدة.
- ToUnicode العربي ما زال يطبع تحذيرات `Skipping broken line … Odd-length string`. ليس اجتياز مقارنة المال والرموز تصريحًا بصحة نسخ/بحث العربية. هذا قيد baseline مثبت سابقًا، ولم يُخفَ من logs.
- تحذيرا Poppler `No display font for 'Symbol'` و`'ArialUnicode'` موجودان أيضًا في logs R3 وbaseline القديمة، ومنها `r3-qa-20260831/png/long-invoice-page-1.log` و`comparison-png/baseline-manual-page-1.log`. exit0 والفحص البصري للخطوط المستخدمة هما دليل هذه الجولة، لا تجاهل التحذير.
- التشكيل العربي وBidi للنصوص الحرة بجميع تراكيبها، وهوية القيد الطويلة قرب footer، ليست مغلقة بهذه الجولة. لم نغيّر النص/المال/الأحجام لعلاجها.
- لم تتغير قواعد Decimal: ROUND_HALF_UP وعرض2–4منازل، بما فيها quantity19,6 التي تظل تعرض4كالسابق؛ لا تغيير schema أو حسابات أو Snapshot.

## مفاتيح الأدلة

| الملف داخل round02 | SHA256 |
|---|---|
| `tests.json` |`A0E1C3AEA4E1814CDD8723F005217C37D184FCCAB33B9A865FEB355B8BC04FC4`|
| `visual-review.json` |`49558C821DDA49D6CB6277F482F8CD4C04515BBF72067625C8B87C79ADC55E96`|
| `source-after-png.json` |`AB39B452348088326BD2B5CD5D3DAD85E5EB6D1E2A4B8339F971B516187AE56A`|
| `runtime-summary.json` |`5A4896E8C6D5C387708CF302C4DAEFBAF72BE32451683A0E425D942059C5F69A`|

كلPDFله metadata وبصمة داخل `pdf/`، وكل استخراج له `.verification.json` داخل `extract/`، ولكل أمر resources/result/stdout/stderr داخل `logs/`. بقيت أدلة R3 الـ99 وحزم R1/R2/R3/header/ASCII وround01 ودليل BT محفوظة؛ لا حاجة لإعادة تشغيلها أو إنشاء renderer جديد. تسليم هذه الجولة patch اختبار محلي مع الأدلة، وليس نشرًا أو قبولًا للنطاقات المستثناة.
