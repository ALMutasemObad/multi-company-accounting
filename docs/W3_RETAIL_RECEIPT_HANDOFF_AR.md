# W3 — معاينة إيصال البيع من الأرشيف

## الحالة والقاعدة

مرشح checkpoint محلي؛ نجحت بوابات العقد والاختبارات والأنواع أدناه على مصدر W3 نفسه، **وفحص المتصفح لم يُنفذ وغير منشور**. لا تُورث نتائج N3 السابقة أو W1/W2/N2 لهذا المصدر.

- الشجرة الوحيدة: `D:/CodexWorktrees/wave3-retail-receipt`.
- الفرع: `feat/wave3-retail-receipt`، القاعدة `dc9fef38ca5393f1574f36e543d4b8e68d73e42c`.
- مصدر N3 السابق: `0038cc95711b962c08d778ce6b4f47deab3c4955`، البداية `39c1de8`.
- تحقق ancestry بالقراءة: البداية سلف المصدر؛ المصدر ليس سلف القاعدة الحالية. استُخدمت ملفات N3 المختارة فقط؛ لم يُستبدل PosPage أو أي عقد مشترك بنسخة قديمة، ولم يحدث cherry-pick للدفعة السابقة.
- النسخة الحالية تضم PDF وN2 محليًا؛ لم تُمس أشجار W1/W2 أو أدلتها.

## السلوك المطلوب

يظهر المخرج داخل نتيجة POS المؤكدة فقط، ويأخذ `result.invoice.id`. لا يأخذ مبلغًا أو بندًا من السلة، ولا يضيف إجراء ماليًا أو مفتاح Idempotency أو replay أو مسح marker. المعاينة تُفتح بفعل المستخدم، بعرض شاشة 58 أو 80 مم ومسمى «معاينة فقط». زر تنزيل PDF مستقل ومسمى A4؛ لا طباعة جهاز أو PDF حراري.

القراءة تمر عبر `PrismaPrintDocumentLocatorAdapter` الموجود، ثم منفذ Printing لقراءة `DocumentPrintArchive` الموجود للشركة والمستند. لا يُستدعى `PrintService.print` من المعاينة، ولا query لبناء لقطة حية، ولا create/update أو زيادة عداد/تدقيق. غياب الأرشيف ليس إذنًا لبنائه.

## عقد HTTP

`GET /api/v1/sales-invoices/{id}/receipt-preview`، العملية `getRetailReceiptPreview`.

- `id` هو SalesInvoiceId موجب canonical ضمن unsigned BIGINT، وليس معرّف المستند المحاسبي أو الأرشيف.
- يلزم رأسا `X-POS-Expected-User-Id` و`X-POS-Expected-Company-Id` معًا. هما شرط مقارنة فقط؛ Actor يأتي من Auth.
- يلزم `pos.view`/POS و`sales_invoices.print`/SALES. يُقارن Actor بين التفويضين، ويُعاد التفويض بعد القراءة باستعمال `readWithPosContext(..., true)` القائم.
- 200: `source/company/document/invoice/barcodeStatus/pdfFormat/posContext` فقط. بنود 1..50؛ الأموال والكميات نصوص الأرشيف كما هي، بما فيها المقياس والصفر السالب، دون Number أو تقريب أو تجميع أو حساب جديد.
- 400: `VALIDATION_ERROR` أو `POS_CONTEXT_REQUIRED`؛ 401/403: Auth؛ 404: `NOT_FOUND` دون كشف شركة أخرى؛ 409: `POS_CONTEXT_CHANGED` دون هوية حية؛ 422: `ARCHIVE_NOT_AVAILABLE` أو `ARCHIVE_INTEGRITY_FAILED` أو `RECEIPT_PREVIEW_UNSUPPORTED` أو `RECEIPT_PREVIEW_LIMIT_EXCEEDED`.
- middleware القائم يحفظ no-store والمهلة وأخطاء التشغيل. لا جسم طلب JSON أو CSRF/financial POST جديد.
- مصدر النوع العام هو OpenAPI: يستورد Web **نوعًا فقط** باسم `GetRetailReceiptPreview200Response` من الملف المولد، بدل import نوع Printing الداخلي السابق. وُلّد الملف المشتق مرة واحدة داخل نافذة W3 المركزية، ثم نجح `--check` والجرد؛ لم يُعدّل الملف المولد يدويًا.

لا يُعاد full PrintSnapshot أو الطرف أو عنوانه أو بيانات ضريبته أو الحسابات أو القيود أو الملاحظات أو exchangeRate/baseTotal. المعاينة تاريخية عند الأرشفة وليست إثباتًا لحالة السداد أو العكس الحالية. شرط CONFIRMED هو مدخل الواجهة؛ HTTP يقرأ فاتورة مؤرشفة مفوضة ولا يضيف عقد إثبات checkout جديدًا.

## سلامة الأرشيف

منفذ الأرشيف يحمل `snapshot: unknown`. تتحقق السياسة من شكل JSON والحقول المعروضة ثم تسقط قائمة مسموحة فقط. يُمرر JSON الأصلي دون تحويل إلى `snapshotHashMatches` القائم الذي يقبل البصمة canonical والبصمة legacy. جسر النوع الضيق عند التحقق من البصمة لا يدعي صلاحية كل PrintSnapshot؛ لا تغيير لخوارزمية البصمة ولا إعادة تخزينها.

حدود المعاينة المعلنة: 50 بندًا، 2048 وحدة UTF-16 للحقل النصي، 80 محرفًا للنص العشري، رقم بند 1..65535 بحسب `UnsignedSmallInt`، وتاريخ أرشفة بصيغة الكاتب القائمة UTC مع milliseconds. قبل التحقق recursive من البصمة، حد JSON الأصلي عمق 32 و50,000 قيمة ومجموع 2,097,152 وحدة UTF-16 للنصوص والمفاتيح. ليست هذه حدود bytes لـHTTP أو PDF. المخالفة تُرفض صراحة؛ لا قص أو تصحيح خفي ولا تشديد جديد على PrintSnapshot المشترك.

عينات المال الكبيرة في fixture الحالية ضمن `Decimal(19,4)`، ومنها `123456789012345.6789` و`123456789012346.9134`؛ الكمية `1234567890123.123456` ضمن `Decimal(19,6)`. لا يدّعي fixture مصالحة إجمالياته مع جميع البنود؛ Printing يحفظ الحقيقة المؤرشفة ولا يعيد حسابها. أُزيل اعتماد fixture القديم على إجمالي يتجاوز schema.

## N2 وتنزيل A4

حُصر PosPage في imports، إنشاء transport واحد بجانب scopeGate، وموضع المخرج بعد روابط النتيجة. لا تغيير لـN1 أو N2 controller/financial body/fingerprint أو خيارات التشغيل والسلة.

تصحيح P2 إضافي معتمد ضمن N3: استعادة CONFIRMED بعد remount قد تترك Cashier غير مهيأة مع هوية N2 صحيحة، فتظهر رسالة تغير سياق غير حقيقي. عند وجود النتيجة المؤكدة فقط يخفي شرط render `CashierContextPanel` و`PosOperatingContext`، وتبقى بطاقة الاستعادة/المعاينة وزر البيع الجديد. لا تغيير لـafterIdentity أو startSale أو state/controller أو marker لإخفاء الرسالة. UNKNOWN/rejected/quarantine لا تتحول إلى CONFIRMED ولا تفقد حمايتها؛ البيع الجديد الصريح يعيد التهيئة بالمسار القائم. هذا إصلاح P2 في W3، وليس تعديلًا لنتائج W2 السابقة.

المعاينة تستخدم `scopeGate.request` القائم ثم تطابق `company.id` و`source.salesInvoiceId` وهوية الرد. الرد المخالف يحجب السياق؛ الرد المتأخر أو الجيل السابق لا يُعرض. المكوّن يُعاد تركيبه عند تغير المستخدم أو الشركة أو الفاتورة أو الصلاحيات/الوحدات.

امتداد A4 المعتمد داخل المالك نفسه:

- `downloadFile/downloadPdf` يقبلان options اختيارية: RequestPolicy وheaders و`beforeSave(response, signal)`. المتصلون بلا options يحتفظون بمسارهم وسلوكهم؛ لم يُنسخ fetch أو CSRF أو API جديد.
- فحص الإلغاء بعد fetch/blob وبعد الحارس، قبل إنشاء Blob URL أو نقر رابط التنزيل. تزال عناصر التنزيل وتُحرر URLs عند الفشل. يتأكد transport من `X-POS-User-Id` و`X-POS-Company-Id` و`X-Sales-Invoice-Id` ومن جيل N2 قبل الحفظ، ويلغي الطلب عند unmount أو تغير scope.
- `PrintService.print` يضيف callback اختياريًا قبل معاملة الأرشفة وبعد render وقبل معاملة printCount/Audit. التفويض خارج transaction، بلا تغيير للمعاملات أو الآثار أو المال.
- راوتر A4 الحالي يربط POS اختياريًا لمسار sales فقط: الرأسان both-or-neither، هوية الرد للمقيد فقط، وإعادة تفويض قبل التسليم. لا تغيير لمسار SalesInvoiceId أو بقية المتصلين.
- هذه نقاط فحص منفصلة وليست منعًا ذريًا لسباق الجلسة. إلغاء العميل أو الرفض المتأخر لا يتراجع عن أرشفة/عداد/تدقيق سبق اعتماده. المعاينة نفسها لا تنشئ هذه الآثار مطلقًا.

## الملفات

| المجموعة | الملفات |
|---|---|
| Printing الجديدة | `retail-receipt-types.ts`, `retail-receipt-policy.ts`, `retail-receipt-service.ts`, `prisma-retail-receipt-archive-read-adapter.ts`, `retail-receipt-router.ts` داخل `apps/api/src/printing` |
| تركيب الخدمة | `apps/api/src/composition/create-retail-receipt-service.ts`، إضافات imports/property/mount في `app.ts` و`server.ts` |
| امتداد A4 | `apps/api/src/printing/print-service.ts`, `print-router.ts`, `apps/web/src/api.ts` |
| Web | `RetailReceiptOutput.tsx`, `RetailReceiptPreview.tsx`, `retail-receipt-model.ts`, `retail-receipt-transport.ts`, `retail-receipt.css`, `i18n/locales/retail-receipt.ts` داخل `apps/web/src`؛ موضع N3 المحدد في `PosPage.tsx` |
| العقد | `packages/contracts/openapi.yaml` و`apps/api/src/generated/openapi-request-guards.ts` الناتج من المولد المركزي الوحيد |
| اختبارات API | `retail-receipt-policy.test.ts`, `retail-receipt-archive-read-adapter.test.ts`, `retail-receipt-http.test.ts`, `print-service-context.test.ts`, `print-router-context.test.ts` و`retail-receipt-fixture.ts` داخل `apps/api/tests` |
| جرد المسارات | إضافة الراوتر الجديد فقط إلى `apps/api/tests/openapi-route-parity.test.ts`؛ اسم معامل A4 في OpenAPI أصبح `{id}` مطابقًا للراوتر دون تغيير URL، لتفعيل حارس ردود أخطائه JSON مع الحالات 500/503/504 |
| جرد العقد | `apps/api/tests/openapi-request-guards.test.ts` و`scripts/tests/openapi-guards.test.mjs`؛ نُقلت تأكيدات مسارات N2 وجردها المحدودة من مراجعة `371917a`/`108d597` وأضيفت عملية المعاينة صراحة، دون cherry-pick شامل أو إضعاف حارس |
| اختبارات Web | `retail-receipt.test.tsx`, `retail-receipt-transport.test.ts`, `retail-receipt-pos.test.tsx`, `api-download.test.ts`, `retail-receipt-test-fixtures.ts` داخل `apps/web/src` |
| regression P2 | إضافة حالات محددة إلى `apps/web/src/pos-recovery-page.test.tsx` ضمن harness الاستعادة القائم، لتثبيت CONFIRMED بعد remount وnewSale الصريح دون automatic financial POST |
| التسليم | هذا الملف فقط؛ لم تُغيّر docs المشتركة |

## التحقق وحدوده

التخصيص `W3-RETAIL-20260831-A` نُفذ بالتتابع داخل هذه الشجرة فقط. تشمل الاختبارات HTTP مركبًا مع Auth ومنافذ Printing الفعلية وfixture storage، قيود الشركة والصلاحيات والوحدات قبل القراءة وبعدها، الأرشيف المفقود/المخالف، رفض كشف اللقطة، المحافظة على الأرقام، عدم الآثار، وفشل/إلغاء A4 قبل الأرشفة وبعد الرسم وعند حفظ Blob. اختبارات SSR/child ports وملف `pos-recovery-browser.test.ts` هي اختبارات وحدات هنا؛ لا تثبت React DOM أو صورة المتصفح أو جهازًا.

بصمات تجميد المصدر ونتيجة `git diff --check` محفوظة في `tmp/coordination/w3-source-round01/source-receipt.json` وسجلي diff-check المجاورين. هذا دليل حفظ ومراجعة whitespace فقط؛ لا يُعد قبولًا وظيفيًا أو توليدًا للعقد. المراجعة المصدرية المستقلة صححت fixture حالة الرفض، وجرد الراوتر، ومطابقة اسم معامل A4؛ لا تغيير خفي للنطاق.

### نتائج التشغيل الفعلية

| المرحلة | الجولة | النتيجة |
|---|---|---|
| المولد المركزي الوحيد ثم `--check` | round01 | PASS / exit 0؛ الملف المولد وحده تغير أثناء التوليد |
| اختبارات المولد وجرد العقد | round01 | 5/5 PASS؛ 328 عملية، 170 طلب JSON، 2199 استجابة JSON |
| focused API/Web | round01 | 613/614، فشل واحد مشخص؛ 23.078 ثانية، لا timeout |
| focused API/Web، إعادة كاملة | round02 | **614/614 PASS، 28/28 ملفًا، بلا skipped/todo/retry**؛ 21.156 ثانية |
| Web src+tests noEmit | round02 | PASS / exit 0؛ 5.781 ثانية |
| API src+tests noEmit | round02 | PASS / exit 0؛ 15.531 ثانية |

الجرد يزيد عن عقد N2 المقارن `327/170/2182` بعملية معاينة واحدة و10 استجابات JSON لها و7 استجابات JSON إضافية لـA4؛ استجابة PDF200 لا تدخل JSON. اختبارات route parity وتأكيد العملية `getRetailReceiptPreview` نجحت على الناتج الفعلي.

سبب فشل round01 هو تهيئة `api-download.test.ts`: مسار HTTP409 الحقيقي يستدعي `messageForError` قبل تحميل قاموس العربية، فألقى `Locale dictionary is not loaded: ar`. أضافت round02 `beforeAll(loadLocale("ar"))` الحقيقي وفق bootstrap وharness الاستعادة القائم. بقيت توقعات 409/`POS_CONTEXT_CHANGED` ومنع استهلاك Blob وحفظه بلا تغيير، ولم يتغير كود المنتج أو العقد. حُفظت round01 كاملة ولم يُستبدل الفشل بنتيجة pass أو يُعدّل timeout. لم يتكرر التوليد.

### المشغّل والبصمات والأوامر

- المشغّل: `tmp/coordination/w3-validation/run.py`، config: `vitest.config.mjs`، وoverlay النوعين `tsconfig.web-src-tests.json` و`tsconfig.api-src-tests.json` في المجلد نفسه. القائمة 28 ملفًا صريحًا: API12 وWeb16، وتشمل N1/N2/A4/API وregression P2.
- Node مباشر عبر Python `-Xutf8 -B` وCMD `login:false`، لا PowerShell. native config loader، worker1/no-file-parallelism/retry0/timeout30s، heap768MiB للوالد والعامل، GOMAXPROCS2/GOMEMLIMIT1536MiB، compile cache معطل، وwhitelist env بلا إعدادات DB/SMTP/payment؛ TEMP/profile/cache/logs كلها على D.
- حارس الموارد قبل كل مرحلة: C>=1GiB وRAM>=2.5GiB. عند النهاية C=`3962966016` وRAM=`4730322944` بايت. انتهت كل عملية Node طبيعيًا وأُحررت النافذة صراحة بعد API types في `2026-08-31T19:18:45Z`. لا خادم/متصفح/DB/عملية اختبار باقية أنشأها المسار؛ لم يُستخدم timeout أو قتل عملية أخرى.
- العميل المعزول للقراءة فقط: `D:/CodexWorktrees/wave1-onboarding-policy/tmp/coordination/prisma-c7ffc99/client`، manifest SHA256=`569f946a3bcbc6ef8058d0245a76683275b4cb5d02be1f0dcf5ac28f4f6d198f`، وطابقت ملفاته الـ21 قبل/بعد كل مرحلة. لم يحدث install أو Prisma generate أو كتابة إلى shared node_modules.
- receipt المصدر الأصلي33: `tmp/coordination/w3-source-round01/source-receipt.json`، SHA256=`91f702bd784bd4eb66e16a5ad9d6136edb4f18749a00b7fc8ab9fc4e89a3f776`. أضيف حارسا الجرد المأذونان والناتج المولد ليصبح تسليم checkpoint **36 ملفًا**. حارس التشغيل يثبت 61 ملف مصدر/config/اختبار؛ تغير من الـ33 في round02 اختبار تحميل القاموس فقط. تحديث handoff الحالي لاحق للتشغيل، ولا تغير بعد التحقق أي شفرة منتج/اختبار أخرى.
- generated SHA256=`2836bea4f8faa42e6bec847b41b408f3562264259dbe422b528a18b696144fef`؛ الأصل ومخرجات التشغيل وبصمات كل مرحلة محفوظة في `tmp/coordination/w3-validation/runs/round01` و`round02`، بما فيها `pin.json`, `source-before.json`, `source-after.json`, `command.json`, `result.json`, `stdout.log`, `stderr.log` و`focused/vitest.json`. سجل `generation-completed.json` يمنع توليدًا ثانيًا.

الأوامر الفعلية عبر `run.py`: `pin --round round01`، ثم `generate` و`generated-check` و`inventory` و`focused` مع `--round round01 --execute --allocation W3-RETAIL-20260831-A`؛ بعد التشخيص `pin --round round02 --revision-note ...`، ثم `focused` و`web-types` و`api-types` بالـallocation نفسه. كل `command.json` يسجل argv النهائي الكامل. تنفيذ `plan` وpin لا يشغل Node. تعثرت صياغتا CMD اقتباسيتان قبل إطلاق أي Node أو إنشاء round إضافية؛ استُخدم مسار Python بلا فراغات وrevision-note كلمة واحدة، دون PowerShell أو تغيير سقوف التشغيل.

checkpoint وdiff وreceipt الـGit محفوظة تحت `tmp/coordination/w3-validation/checkpoint/`. يستعمل Git عبر Python argv و`commit -F`، مع هوية/hooks المستخدم القائمة وTEMP/TMP على D، دون bypass أو push. قيمة HEAD والـparent والقائمة وبصمات blobs في receipt خارج handoff لتجنب مرجع commit ذاتي.

### القبول المؤجل

يلزم تخصيص متصفح منفصل: نتيجة POS مؤكدة ببيانات fixture، 58/80 وأربع لغات/عرض ضيق، الأرقام والنص الطويل، تبديل الشركة/المستخدم مع قراءة أو Blob معلق، وملف A4 الحالي بفعل صريح. لم يُشغّل browser أو PDF أو DB أو build في هذه النافذة؛ لا طباعة جهاز ولا فعل مالي حقيقي. هذه النتائج تقبل بوابات المصدر/العقد/الوحدات/الأنواع فقط، ولا تمثل قبولًا مرئيًا نهائيًا.

## BarcodeImpact وحدود القبول

**BarcodeImpact: يؤثر في عرض البنود المؤرشفة فقط.** تعرض المعاينة itemCode/unitCode عند وجودهما في اللقطة وتتركهما null عند غيابهما في الأرشيف القديم. لا تغيّر سجل الصنف أو رموزه أو اللقطة، ولا تستعلم Inventory لإثراء أرشيف سابق. `itemCode` ليس barcode؛ لا QR/باركود مخترع، ويظهر `NOT_CAPTURED_IN_V1` مع توضيح للمستخدم. بوابات الأجهزة والباركود ونسخة الأرشيف التالية خارج N3.

لا اعتماد Bidi/free-text/fonts أو طباعة حرارية/جهاز أو PDF جديد. لا schema أو dependency أو router مالي جديد، ولا تغيير Decimal/helpers أو ownership/ACID أو optimistic version. لم يُدفع فرع أو يُفتح PR أو يُدمج main أو يُنشر شيء.
