# تسليم N3: معاينة إيصال البيع من الأرشيف

التاريخ: 2026-08-31. النسخة: `D:/CodexWorktrees/retail-receipt-output`.
الفرع: `feat/retail-receipt-output`، الأساس: `39c1de8`.
المنسق: `01a04cc6-7aae-70b2-adb9-e037386d06a2`.
هذه شريحة معزولة للدفعة التالية، لا تخص PR #45 ولا تدعي إطلاقًا أو نشرًا.

## النتيجة والاعتماد

اعتمد المنسق أثناء المهمة: إسقاطًا داخليًا من أرشيف `SALES_INVOICE` الموجود فقط،
وPort قراءة، وصلاحية `sales_invoices.print`، ومقاسي 58/80mm كمعاينة معلنة فقط.
تنزيل PDF الحالي يسمى A4 صراحة. لم يعتمد تغيير renderer أو barcode snapshot الآن.

نفذنا الكود والمكونات والاختبارات، لكن لم نركبها في التطبيق الفعلي أو ننشر API.
لا تعديل في App/PosPage أو print-service/router/types/ports/pdf-renderer الحالية،
ولا OpenAPI/generated أو Prisma/schema/migration أو composition أو CI أو package/lock.
لا install/ci/download/Prisma generate، ولا كتابة إلى node_modules المشتركة، ولا
Push/PR/Merge/Deploy. كل الأدلة والكاش وTEMP تحت `tmp/retail-receipt` في هذه النسخة.

Commits التنفيذ، تؤخذ بالترتيب كمجموعة واحدة:

- `e566abe`: إسقاط Printing وPort وخدمة داخلية واختبارات الملكية والسياسات.
- `2825fe3`: مكونات المعاينة والصلاحيات والقاموس وهياكل التحقق المحلية.

## خريطة الملفات والربط المطلوب

| الملف/المجموعة | المسؤولية |
|---|---|
| `apps/api/src/printing/retail-receipt-types.ts` | DTO داخلي و`RetailReceiptArchiveReadPort` |
| `apps/api/src/printing/retail-receipt-policy.ts` | عزل المصدر، hash القائم، whitelist، Decimal حرفي، حد50 بند |
| `apps/api/src/printing/retail-receipt-service.ts` | locator الحالي ثم قراءة الأرشيف الموجود فقط |
| `apps/web/src/RetailReceiptOutput.tsx` | فتح صريح، قراءة قابلة للإلغاء، إعادة قراءة يدوية، تنزيل A4 صريح |
| `apps/web/src/RetailReceiptPreview.tsx` | قالب الشاشة المشتق بلا أفعال أو محرك PDF |
| `apps/web/src/retail-receipt-model.ts` | UI gate، مفتاح scope، رفض الرد القديم/الأجنبي، مسار A4 |
| `apps/web/src/retail-receipt.css` | CSS معزول، 18/14px فقط، 58/80mm للشاشة، بلا @page |
| `apps/web/src/i18n/locales/retail-receipt.ts` | قاموس مستقل ar/en/hi/ur، لم يعدّل القاموس المجمع |
| `apps/api/tests/retail-receipt-*` و`apps/web/src/retail-receipt.test.tsx` | unit/SSR/architecture بالـfixtures |
| `tests/retail-receipt/*` | harness اصطناعي مستقل؛ لا خادم أعمال أو PDF حقيقي |
| `retail-receipt-{vitest,vite}.config.ts` و`retail-receipt-tsconfig.json` | إعدادات N3 فقط بكاش D وworker1 |

الخطوات التالية للمنسق، ليست منفذة هنا:

1. اعتماد HTTP/OpenAPI قبل أي endpoint. DTO الحالي داخلي وليس عقد نقل عامًا.
   إذا اعتمد JSON، تولد الأنواع والحراس منه؛ تستبدل وصلة type-only من Web إلى
   نوع Printing بالنوع المولد، ولا يصدر `PrintSnapshot` الكامل للعميل.
2. Adapter لدى Printing ينفذ `findExisting(companyId, accountingDocumentId)`
   باستعلام محدود على `DocumentPrintArchive` مع الشرطين؛ يرجع id/companyId/
   accountingDocumentId/snapshotHash/snapshot. لا create/backfill أو lookup للمراجع الحية.
3. تركيب `RetailReceiptService(locator, archives)` بالـlocator الحالي. استدعاء
   `preview(actor, salesInvoiceId)` يأتي فقط بعد `AuthService.authorize` لصلاحية
   `sales_invoices.print` مع استحقاق SALES. الـActor لا يحتوي صلاحيات بنفسه؛ الخدمة
   غير المركبة ليست بديلًا عن حد التفويض. دخول POS يتطلب كذلك pos.view/POS.
4. طبقة HTTP تثبت no-store وno-cache/errors/response guards والـdeadline والعزل
   باختبارات router فعلية. رموز هذه الشريحة داخلية ولم تُنشر: NOT_FOUND،
   ARCHIVE_NOT_AVAILABLE، ARCHIVE_INTEGRITY_FAILED، RECEIPT_PREVIEW_UNSUPPORTED،
   RECEIPT_PREVIEW_LIMIT_EXCEEDED. لا تعرض تفاصيل الأرشيف أو الخطأ الداخلي.
5. ربط `RetailReceiptOutput` في نتيجة POS المؤكدة فقط؛
   `confirmedSalesInvoiceId = result.invoice.id` بعد التحقق من عقد النتيجة.
   تمرر هوية المستخدم/الشركة وpermissionSet/moduleSet واللغة، و`readPreview`
   المستقر الذي يستخدم API المعتمد مع signal وtimeout وguard. لا قيم من السلة.
6. تنزيل A4 يستخدم المصدر القائم `/sales-invoices/{salesInvoiceId}/pdf`.
   لا تستخدم `accountingDocumentId` أو archiveId في هذا المسار. افتراضي المكوّن
   `downloadPdf` الحالي، ويمكن حقن callback عند التركيب. معاينة N3 لا تزيد printCount؛
   تنزيل A4 يحتفظ بآثار PrintService القائمة. انتهاء تنزيل ملف لا يثبت أنه طبع.

`sales-invoice-service.ts` يحفظ الأرشيف أثناء الترحيل بالفعل؛ عند غياب الأرشيف
ترد القراءة بخطأ آمن ولا تعيد بناءه. لا ندعي اختبار إنشاء الأرشيف على DB هنا.
حالة POSTED المعروضة تخص لحظة الأرشفة فقط، لا حالة السداد أو العكس الحالية.
لا تدخل هوية المستخدم أو الشركة في query/body من المتصفح باعتبارها سلطة تفويض.

## سلامة المصدر والأموال

- يطابق الإسقاط الشركة والمستند في envelope واللقطة مع سياق المالك، ثم يعيد
  استخدام `snapshotHashMatches` الحالي لقبول hash القديم والجديد دون إعادة بصمة.
- لا يقرأ Sales/Inventory/Treasury مباشرة؛ لا Prisma جديد، ولا كتابة أو معاملة
  أو Outbox أو retry. لا يجلب أسطرًا بصفحات ثم يعيد تجميع مستند ناقص.
- لا Number أو Float أو إعادة جمع أو ضريبة أو تقريب أو تنسيق locale للأموال.
  المبالغ والكمية والنسبة تنتقل حرفيًا، بما فيها trailing zeros. عدد البنود50
  مطابق لحد POS الحالي؛ أكثر منه أو صفر يرفض دون truncation، ويبقى A4 منفصلًا.
- يحذف الإسقاط Ledger والحسابات والعميل وعناوينه وملاحظاته وbaseTotal وexchangeRate؛
  هذه البيانات لا يحتاجها إيصال التجزئة المصغر. لا تعديل/aliasing للـsnapshot الأصلي.
- الأرقام والمعرفات في bdi LTR، والنص المختلط في bdi auto. React يهرب HTML.
  حالة العرض محلية في الذاكرة فقط؛ تغير user/company/invoice/capabilities يعيد
  تركيب المكوّن فورًا ويُلغي القراءة. لا استجابة متأخرة تعرض إيصال نطاق قديم.
- منفذ تنزيل A4 القديم ليس AbortSignal-aware؛ تمنع هذه الشريحة تحديث رسائلها بعد
  unmount لكنها لا تدعي إلغاء تنزيل بدأ صراحة. أي تحسين للمنفذ مسؤولية ربط المالك.

## Barcode Impact: قيد قائم وقرار forward-only

هذا إخراج مرتبط بأصناف، ولذلك ليس N/A. تمت قراءة Inventory barcode codec وPort
الملصقات وBarcodeLabelService وBwipJsBarcodeLabelRenderer وقواعد Barcode Impact.
`PrintSnapshot v1` يحفظ itemCode/itemName/unit فقط؛ لا barcode منتخبًا ولا itemId.
لا يجوز تفسير itemCode كباركود أو جلب barcode حي ثم وصفه بتاريخي. لم نضف parser
أو render engine ثانيًا أو QR اعتباطيًا أو رابطًا يفتح تلقائيًا. الواجهة تصرح
`NOT_CAPTURED_IN_V1` لكل اللقطات التي تقبلها هذه الشريحة.

اعتمد المنسق تأجيل إخراج الباركود التاريخي حتى عقد لاحق؛ لذلك لا تغلق هذه الشريحة
Retrofit B3 ولا تعد جاهزة للطباعة الحرارية النهائية. المقترح التالي، غير منفذ:

- عقد مصدر لدى Sales/Inventory يثبت الباركود الذي اختير بالفعل وقت الأمر، مع
  symbology/value وهوية مصدر مستقرة؛ B1 codec والـPorts هما المالكان للتحقق.
- نسخة snapshot لاحقة forward-only تلتقط الحقول المعتمدة عند الترحيل. تبقى
  أرشيفات v1 وبصماتها بلا تغيير؛ غياب الباركود يظل صريحًا ولا يعاد ملؤه من live data.
- إخراج الرمز يعيد استخدام BarcodeLabelRendererPort والـadapter الموجود؛ أي
  بروفايل أبعاد جديد يراجع لدى المالك. لا تصغير PNG عشوائيًا لتناسب58mm، ولا مسح
  quiet zones/HRI أو افتراض203DPI كإثبات طابعة، ولا QR ضريبي دون عقد معتمد.

## أدنى hook حراري مقترح لدى المالك: غير منفذ

توسعة خيارات `renderDocumentPdf` الحالي بخيار discriminated template، وافتراضي
`ACCOUNTING_A4` يحافظ على كل المستندات الأخرى. قالب `RETAIL_RECEIPT` يقبل عرضًا
محصورًا58 أو80mm ونسخة قالب معلنة؛ لا مقاسات حرة أو ألوان أو نسخ دفعات من العميل.
لا يستحدث PrintSnapshot ماليًا ثانيًا أو renderer/parser موازيًا.

قبل تفعيله: عقد format في OpenAPI، capability صريحة، مصدر لقطة/bidi/fonts/Decimal
آمن، وحدود صفحات وحجم، وbarcode forward-only عند اعتماده. ثم PDF geometry/text
tests وrender-to-PNG وفحص كل الصفحات، ثم الطابعة الحرارية والقارئ الحقيقيان مع
DPI/quiet zones/HRI. دليل PDF الرقمي ودليل الجهاز يسجلان منفصلين.

عيب قائم أبلغ به دون تغييره: `pdf-renderer.ts:12` يستخدم `Number(value)`.
تجربة helper النصية نفسها، وليست إنشاء PDF، أعطت:

```text
input:              123456789012345.6789
currentA4Formatter:  123,456,789,012,345.67
N3 preview:         123456789012345.6789
```

لذلك لا نعتمد دقة A4 الحالية من نجاح معاينة N3 ولا ندعي مراجعة PDF فعلي.

## أدلة التنفيذ وحدودها

| الفحص | النتيجة |
|---|---|
| Vitest N3 النهائي |43/43: API policy23 + architecture3 + Web17، صفر failed/skipped |
| TypeScript ضيق يشمل المكونات وharness |exit0، دون emit أو تعديل node_modules |
| مصفوفة المتصفح المدمج |24/24 DOM checks: ar/en/hi/ur ×390/768/1440 ×58/80، عامل تحكم واحد |
| قياس العرض |219.207px و302.358px تقريبًا؛ مقاسان CSS وفق96px/inch، لا قياس طابعة |
| تفاعل الواجهة |11 حالة: A4 intent،4حجب access،missing/foreign،late company read،user reset،download error،manual retry |
| صور المتصفح |غير كافية لقبول بصري كامل؛ scaling/stitching/قص لا يطابق DOM ثم فشل desktop capture |
| Git |ملفات جديدة مسماة N3 فقط؛ diff check نظيف؛ commits محلية بلا push |

الأدلة تحت `tmp/retail-receipt/`: `unit.json`، `browser-matrix.json`،
`browser-interactions.json`، `browser-capture-limit.json`. صورتان خام للتشخيص:
`preview-ar-390-58.png` و`preview-ar-390-58-totals.png`؛ لا تدعيا اكتمال الفحص
البصري. لم ينشأ فيديو أو PDF. أصلح فحص المتصفح التفاف أسماء controls في harness
فقط. بعد انتهاء النافذة أضيف `dir="ltr"` لاختيار المقاس وأعيد unit/types؛ لم
تعَد مصفوفة المتصفح بعد هذا التعديل المحدود، ولا تُنسب له أدلة browser جديدة.

كانت أول محاولة CLI exit1 لأن node غير موجود في PATH؛ استُخدم runtime المثبت
بمساره الصريح ونجحت الجولات اللاحقة. تحذيرات Git LF/CRLF فقط، لا فشل فحص.
خادم Vite4202 أوقف عمدًا بـCtrl-C (exit1 عند الإيقاف)، وأغلق تبويب الفحص وأعيد
viewport الافتراضي. تحقق3152/4202 النهائي بلا listeners. لم يستخدم3152 أصلًا.

الأوامر القابلة للإعادة، في نسخة D فقط (بعد تأكيد نافذة browser عند الحاجة):

```powershell
$env:TEMP='D:/CodexWorktrees/retail-receipt-output/tmp/retail-receipt/temp'
$env:TMP=$env:TEMP
$env:GOMAXPROCS='2'
$env:GOMEMLIMIT='1536MiB'
$n3Node='C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $n3Node node_modules/vitest/vitest.mjs run --config retail-receipt-vitest.config.ts --configLoader runner --reporter=default --reporter=json --outputFile=tmp/retail-receipt/unit.json
& $n3Node node_modules/typescript/bin/tsc -p retail-receipt-tsconfig.json --noEmit --pretty false
& $n3Node node_modules/vite/bin/vite.js --config retail-receipt-vite.config.ts --configLoader runner
```

لإعادة فحص المتصفح: افتح harness4202؛ عداد القراءة والتنزيل يبدأ بصفر. افتح
المعاينة يدويًا، وبدل اللغات والمقاسات والعروض؛ تحقق من عدم overflow وحفظ الأرقام.
اختبر Access لكل viewer/no-sales/no-pos/unconfirmed، Read mode missing/foreign،
وslow ثم Company2 ثم Release pending read، وUser10، وdownload-error، وretry.
تنزيل harness callback يسجل المسار فقط؛ ليس طلب HTTP حقيقيًا أو PDF محفوظًا.

لا full suite/build شامل أو API router/Auth integration أو DB أو Prisma generate.
بوابتا MariaDB10.11/MySQL8.4 fresh+upgrade والـDB E2E لم تنفذا هنا ولم تتجاوزا كنجاح.
لا USB/Bluetooth HID أو كاميرا أو scanner أو درج نقود أو طابعة فعلية. يلزم قبول
بصري جديد وصحة عقد/RBAC/عزل فعلي عند تركيب المنسق، قبل أي وعد جاهزية للإطلاق.

## مراجعة التغيير المختصرة

ملكية Printing وحقيقة Sales محفوظتان؛ لا تغيير Ledger/مال/حدث/معاملة/رمز رئيسي
أو schema. العزل/hash/exact strings/negative cases مختبرة بالـfixtures. أنواع
داخلية بلا Prisma records كعقد عام، ولا any جديد. Barcode Impact موثق بقيد واعتماد
لاحق محدد، لا N/A ولا ادعاء الإغلاق. المصدر المفتوح الحالي مستعمل دون إضافة حزم.
بوابات HTTP/DB/صور سليمة/أجهزة/دمج ونشر تبقى خارج التسليم ومملوكة للمنسق والمالكين.
