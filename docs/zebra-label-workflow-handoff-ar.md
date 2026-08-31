# تسليم Z1: إعداد ملصقات Zebra محليًا

التاريخ: 2026-08-31. النسخة الوحيدة المعدلة:
`D:/CodexWorktrees/zebra-label-workflow`، الفرع `feat/zebra-label-workflow`.
الأساس `9f98ddfa566dd329a81b9838f61bdfe73832764a` مرشح PR45 غير المنشور، **ليس main**.
هذه الشريحة مستقلة ولا تدخل PR45. لا Push أو PR أو Merge أو Deploy.

commits التنفيذ المحلية، بالترتيب: `823d905` لخدمة Printing واختباراتها، ثم
`b1e1d20` للواجهة والمنافذ وحماية الإرسال والساعة والنطاق واختباراتها. يتبعها commit
توثيق هذه الوثيقة. يراجعها المنسق قبل اختيار التركيب؛ لا توجيه لدمجها في PR45.

## المنفذ والحدود

الشريحة شفرة قابلة للتركيب، وليست تقريرًا فقط: مكوّن React بأربع لغات، إعدادات
ومعاينة وكمية، خدمة تحضير فعلية تعيد استخدام مولّد PNG القائم، ومنفذ إرسال قابل
للحقن محمي بمراجعة الإعدادات والتفويض والنطاق. لا تُركّب تلقائيًا في صفحة قائمة.

كل حقول البداية فارغة: الموديل، الاتصال، الطابعة، العرض والارتفاع بالملليمتر، DPI،
الاتجاه والكمية. معلومات جهاز المستخدم والبكرة ما زالت مجهولة. 203 هو بروفايل
المولّد الحالي فقط؛ يرفض المسار DPI آخر، ولا يستبدله أو ينصح بتغيير القيمة الفعلية.
المقاس الذي لا يتسع للصورة الأصلية كاملة يُرفض؛ لا stretch/crop أو إعادة ترميز.
الدوران 0/90 وموقع الصورة أعداد dots صحيحة؛ معاينة الشاشة نسبية وليست دليل جهاز.

كل الملفات المضافة تبدأ بـ `ZebraLabel` أو `zebra-label`. لم تتغير InventoryPage أو
scanner أو codec أو renderer القائم أو PrintSnapshot أو أي فاتورة/إيصال N3، ولا
App/navigation أو API app/server أو OpenAPI/generated أو Prisma/migrations أو
الترجمات المجمعة أو package/lockfiles أو CI. لا تغيير للمال أو RBAC أو الاستحقاقات.

## الملكية وعقد التركيب

قُرئت AGENTS.md ومراجعها السبعة كاملة ووثيقة التنسيق. أُرسل العقد مبكرًا للمهمة
المنسقة `01a04cc6-7aae-70b2-adb9-e037386d06a2` واعتمدت الملفات الجديدة فقط.

Inventory يظل مالك التعريف والبحث. يستخدم Printing
`InventoryBarcodeLabelQueryPort.findPrintableBarcode(companyId, itemId, barcodeId)`،
ثم `encodeBarcode` القائم، ثم `BarcodeLabelRendererPort` و
`BwipJsBarcodeLabelRenderer`. لا Prisma أو parser أو symbology جديدة.

`ZebraLabelPreparationService` في Printing يأخذ ثلاثة منافذ: authorization،
Inventory query، renderer. `prepare(context,input)` يقبل IDs فقط ومعها
`media {widthMm,heightMm,dpi,orientation}` و`quantity`؛ لا قيمة باركود حرة أو company
في جسم الطلب. context من الجلسة المثبتة. منفذ التفويض يعيد actor موثوقًا يطابق
userId/companyId ويفحص `inventory_barcodes.print` قبل التحضير وبعده. يعاد أيضًا
قراءة المصدر بعد الرسم لمنع قبول تغيير/تعطيل حدث أثناء الرسم.

المخرج الداخلي `ZebraLabelPreparedSnapshot`:

```ts
{
  companyId: string; inventoryItemId: string; barcodeId: string;
  profile: "INVENTORY_203_DPI_V1";
  media: { widthMm: number; heightMm: number; dpi: number;
    orientation: "normal" | "rotate90" };
  quantity: number;
  mediaDots: { widthDots: number; heightDots: number };
  raster: { png: Buffer; widthDots: number; heightDots: number };
  placement: { xDots: number; yDots: number; widthDots: number;
    heightDots: number; rotation: 0 | 90 };
}
```

اللقطة frozen، والوصول إلى PNG يعطي نسخة دفاعية. هذه أنواع application داخلية
وليست عقد HTTP منشورًا. `authorizeSubmission(context,snapshot)` يعيد التحضير
والتفويض وقراءة المصدر ويقارن bytes والهوية والمقاس والموضع؛ يرفض المصدر المتغير
واللقطة المزورة. يظل ذلك read-only، وليس معاملة ذرية تربط قاعدة البيانات بالطابعة.

في الواجهة `ZebraLabelWorkflow` يأخذ `locale` و`scope` و`printers` ومنافذ اختيارية
`preparation` و`direct`. `scope` يحوي `actorId/authorizationRevision` محليين فقط،
وsource {companyId,inventoryItemId,barcodeId} والصلاحيات الفعلية وحالتي نشاط الصنف
والباركود. على المضيف تغيير authorizationRevision عند استبدال الجلسة/التفويض؛
هذه الحقول ليست سلطة تفويض لخادم HTTP.

التحويل البسيط بين منفذي الخادم والواجهة في composition المستقبلية:

```ts
// Mapping only after a generated, authorized transport is approved.
const artifact = {
  source: { companyId: snapshot.companyId,
    inventoryItemId: snapshot.inventoryItemId, barcodeId: snapshot.barcodeId },
  rendererProfile: snapshot.profile,
  media: snapshot.media, quantity: snapshot.quantity,
  png: new Uint8Array(snapshot.raster.png),
  raster: { widthDots: snapshot.raster.widthDots,
    heightDots: snapshot.raster.heightDots },
  mediaDots: snapshot.mediaDots, placement: snapshot.placement,
};
```

`ZebraLabelPreparationPort.prepare` و`authorizeSubmission` يحتاجان ربطًا معتمدًا
على API مولد عند دمج الواجهة. لا يوجد endpoint جديد أو عميل HTTP مختلق في هذه الشريحة.
الافتراضي للتحضير والإرسال يفشل صراحة ولا يجري I/O. عمليات POST المستقبلية تحتاج
CSRF/RBAC/no-store وحراس OpenAPI مولدة؛ اختيار طريقة نقل PNG/التفويض ملك المنسق.

descriptor الطابعة يأتي من composition موثوقة بعد مراجعة الموديل والجسر، ويشمل
id وcompanyId وmodel وconnection وdpi وmaxWidthMm/maxHeightMm وsupportEvidence
و`approved === true`. لا اختيار تلقائي أو عناوين شبكة حرة أو اكتشاف أجهزة.
المقاسات القصوى فيه يجب أن تكون نطاق الطباعة الفعلي المراجع، لا مجرد عرض البكرة.

## حماية الإرسال

- لا I/O عند mount أو تغيير الحقول. يلزم إعداد معاينة ثم فعل إرسال منفصل.
- يتغير React key عند تبديل actor/authorization/company/source؛ السياسة المحافظة
  تصفّر الإعدادات حتى عند الانتقال لباركود آخر. ref للنطاق في المكوّن الخارجي يجعل
  controller القديم يرى النطاق الجديد قبل تنظيف effects. حارس الصورة يطابق scope.
- controller يمسح الحالة عند تغيّر النطاق، ويمنع نتائج prepare/reauth/send المتأخرة
  أو أخطاءها من تغيير رسائل النطاق الجديد. لا تخزين محلي للصور أو بيانات الطباعة.
- صلاحية المعاينة دقيقتان من بدء التحضير، وموعد نهائي واحد 10 ثوانٍ للتفويض والإرسال.
  فحص الساعة finite/آمن ومتزايد؛ NaN أو rollback يغلق الجلسة حتى فتح إعداد جديد.
- قبل `submit` مباشرة، داخل callback نفسه، تعاد مقارنة الهوية والصلاحية والنسخة
  والمصدر والطابعة وDPI والمقاس وصلاحية المعاينة والموعد النهائي. لا await بين الفحص
  واستدعاء المنفذ.
- تُستهلك المعاينة قبل أول await للإرسال. النقر المتزامن أو Enter لا يكرر التسليم.
- النتائج `sent` و`queued` تعنيان تسليمًا/قبولًا فقط، ولا توجد حالة `printed`.
  فشل/مهلة بعد التسليم يعني `unknown`، ولا retry آلي. `unknown` يقفل إعداد دفعة
  جديدة وإعادة الإرسال داخل الجلسة نفسها، بما فيها تعديلات الحقول وinvalidate.
- الإرسال بعد `sent/queued` يحتاج معاينة وفعلًا جديدين وإقرارًا ظاهرًا؛ ليس retry
  تلقائيًا. لا سجل دائم أو recovery أو استنتاج لانتهاء الطباعة. لا ضمان exactly-once
  عبر إعادة تحميل التطبيق أو أجهزة متعددة؛ يلزم قرار مستقل قبل adapter حقيقي.

حدود الأمان الأولية، وليست قدرة جهاز أو SLO: 1..100 نسخة، 2 MiB للصورة، 16 MiB
لمجموع bytes الصورة×الكمية، 4,000,000 بكسل للملصق/الصورة، 16,000,000 بكسل للدفعة،
و300mm لكل ضلع كحد موارد. سقف Code128 لهذه الشريحة 128 محرفًا قبل الرسم؛ لا يغير
قبول Inventory لرموزه. تُرفض media/pixel/quantity والرموز الطويلة قبل الرسم، ولا
تُنشأ صورة مجمعة أو مصفوفة pixels أو نسخ PNG بعدد الكمية. فحص PNG هنا لبيانات الحاوية
ومقاسها، وليس decoder بصريًا. يجب أن يحد adapter المستقبل **الناتج المرمز النهائي**
قبل device I/O؛ PNG المضغوط ليس حجم ZPL النهائي، ولا يكفي فحصه لضمان حد الجسر.

## بحث Zebra وقرار SDK

تعرض [صفحة دعم Browser Print الرسمية](https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html)
دعم Windows/macOS عبر USB أو شبكة، وAndroid عبر شبكة أو Bluetooth، مع طلب تنزيل
التطبيق الأصلي ومكتبة JavaScript. كود الويب وحده لا يثبت الجسر.

تعرض [TechDocs الحالية](https://techdocs.zebra.com/link-os/latest/demos/browser-print/)
متطلبات Windows 11/macOS ومتصفحات Chrome/Edge/Safari وموافقة Accepted Hosts.
لم تُغيّر هذه الموافقات هنا. لا يُستنتج منها توافق جهاز المستخدم.

يتضمن [دليل Browser Print 1.3.2](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/zebra-browser-print-user-guide-v1-3-2-en-us.pdf)
موديلات/عائلات محددة ولغة ZPL II وحد إرسال 2MB وقيود firmware/fonts. قسم HTTPS
وتاريخ إزالة الشهادة الذاتية فيه غير متسقين؛ يلزم فحص الإصدار والمتصفح وHTTPS الفعلي،
دون تعطيل TLS أو security flags. رقم 1.3.2 مرجع وثيقة، وليس حزمة اعتمدناها.

[دليل Android](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/zebra-browser-print-user-guide-v1-3-2-android-en-us.pdf)
يصف شبكة/Bluetooth. لم يثبت هذا البحث iOS أو Android USB.
تفرق [صفحة Zebra القانونية](https://www.zebra.com/us/en/about-zebra/company-information/legal/open-source-usage.html)
بين البرمجيات المملوكة ومكونات OSS؛ الإشعارات ليست إذنًا لإعادة توزيع SDK.

المقترح فقط: adapter معزول لـBrowser Print بعد اعتماد الموديل والاتصال وOS والمتصفح،
ومراجعة حزمة رسمية exact version/hash/EULA وحقوق توزيع JavaScript والإشعارات والأمن
وخطة تحديث/خروج. لم يُنزّل/يثبت/ينسخ SDK ولم تُقبل EULA ولم يتغير Accepted Hosts.
لا أوامر firmware/calibration/reconfigure/fonts، ولا حقل raw ZPL أو QR جديد.

## Barcode Impact وقائمة المراجعة

هذا التغيير يمس Printing مباشرة، ولذلك ليس N/A. يستهلك تعريف Inventory المسجل
والمفوض، ويحافظ على value النصية وleading zeros. لا يستخدم normalizedValue كبيانات
للملصق، ولا ينشئ معرفًا ماليًا أو GTIN أو QR. quiet zones/HRI وبكسلات PNG الأصلية
كلها تدخل fit check وتبقى دون تعديل. لا تغيير للمسح أو اختيار بنود أو حركات مخزون.

لا جدول/كتابة/حدث/Outbox/معاملة مالية أو dependency cycle جديد. لا تغيير نسخة أو
حالة مستند أو صلاحية/استحقاق. الاختبارات تتضمن denied/foreign/null/stale والحدود
والتزامن المحلي. لا migrations أو بوابة ترقية مطلوبة لهذه الشريحة دون DB؛ عند إضافة
route/ربط جديد تبقى بوابات OpenAPI وHTTP/CSRF وMariaDB10.11/MySQL8.4 وDB E2E على
المنسق بحسب الصلة، ولا تعتبر ناجحة بهذه الاختبارات.

## التحقق القابل للإعادة وحدوده

استُخدم Node المجمّع للقراءة فقط، والاعتماديات المشتركة للقراءة فقط. لكل أمر ضبط
TEMP/TMP/XDG_CACHE_HOME إلى `D:/CodexWorktrees/zebra-label-workflow/tmp/zebra-label`،
وGOMAXPROCS=2 وGOMEMLIMIT=1536MiB. لم يحدث install/ci/generate أو cache في node_modules.

من `apps/web` أو `apps/api` بحسب المسار:

```text
node ../../node_modules/vitest/vitest.mjs run --config zebra-label-vitest.config.ts --configLoader runner --maxWorkers 1 --no-file-parallelism
```

ومن الجذر:

```text
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false --pretty false
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.test.json --noEmit --incremental false --pretty false
```

بناء المكوّن المعزول من `apps/web`:

```text
node ../../node_modules/vite/bin/vite.js build --config zebra-label-vite.config.ts --configLoader runner
```

آخر تحقق: **62 اختبار web في ملفين، و99 اختبار API في خمسة ملفات: جميعها ناجحة**.
حزمة API تشمل اختبارات Z1 الجديدة واختبارات codec/renderer/service/architecture
القائمة. نجح typecheck الكامل للواجهة ولـAPI مع اختبارات API، بلا emit/incremental.
نجح بناء المكتبة: JS ‏40.47 kB وCSS ‏1.74 kB (قبل gzip). نجح git diff --check.
مراجعة مستقلة أغلقت نافذة تغيّر المصدر أثناء الرسم، وفاصل microtask قبل التسليم،
وقبول approved/available بقيم truthy. اختبارات R0 تشمل 31 حالة للساعة والهوية
والنتائج المتأخرة؛ ليست هذه اختبارات DOM أو قبول متصفح. فحص إعادة تركيب React
مستند إلى مفاتيح المكوّن وSSR ومراجعة المرجع المشترك، لا جلسة تفاعل متصفح.

المخرجات والسجلات تحت `tmp/zebra-label` على D، ولا تدخل git. بناء المكتبة ينتج
JS/CSS للقطعة نفسها، دون
App/InventoryPage؛ لا يعني أنها متاحة للمستخدم في التطبيق.

أدلة الخدمة تشمل renderer PNG الحقيقي والـcodec القائم، مع منافذ auth/Inventory
اختبارية؛ اختبارات الواجهة/السباقات وSSR لا تستخدم جهازًا. **لم ينفذ متصفح أو خادم،
SDK أو اكتشاف/إرسال أو طباعة فعلية أو فك باركود من الورق**. ليست هذه أدلة قبول جهاز
أو round-trip بصري. يلزم لاحقًا إذن منفصل واختبار الملصق الفعلي وقراءة باركوده
على الموديل وDPI والبكرة الفعلية قبل أي ادعاء قبول أو إتاحة direct-print.
