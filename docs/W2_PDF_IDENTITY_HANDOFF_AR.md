# W2-PDF-IDENTITY — حجز وصف هوية القيد وصفحاته

المسار الوحيد المعدل: D:/CodexWorktrees/wave2-pdf-identity.
الفرع: fix/wave2-pdf-identity. الأساس المنشور:
e3d6ba03aec8ceabd42428d67855fad2683968a6 (PR46).
المنسق: 01a05783-e720-7ed0-a107-4a372bd53202.

## حالة المرشح

اجتاز المرشح المحلي round-02 جميع118 حالة:103 من الأساس أعيد تشغيلها،
و10helper و5PDF، ثم narrow noEmit types، ثم توليد4PDF للمرشح وbaseline
من الأساس المنشور، واستخراجها ورسم32 صفحةPNG وفحصها بصريًا. هذا قبول محلي
لنطاق هوية القيد وتذييلها واستمرارها، وليس قبولًا شاملًا لـBidi/ToUnicode.
البصمات ثابتة قبل/بعد المراحل؛ التعديل الوحيد بعد تجميد التشغيل هو هذا التقرير.

الجولة round-01 محفوظة كما هي:116/117، بفشل assertion خاص بـCRLF، لاtimeout.
لا توريث لنتائجها إلى الجولة الثانية. حفظ PDF/CID51 الذي أثبت سبب التصحيح.
لا نشر أو push أو merge، ولا تعديلW1 أو أدلته أو وثائق عامة. التجميع والنشر
لدى المنسق؛ commit التسليم محلي فقط، وتفاصيله في receipt المرفق مع التسليم.

بدأ التجهيز أثناء نافذةN2 ثم توقفshell لتشخيص التعليق. المنسق حسم القناة ومنح
هذا المسار وحده نافذةcmd.exe/Python وNodeالمباشر. PowerShell وenv.ps1 لا يشغلان.

## العيب والقرار

R3 يحفظ الوصف الطويل بتدفق PDFKit الأصلي، الذي يسمح له بالنزول إلى نحو799.89
فيA4 بهامش42. التذييل يبدأ عند755؛ التحقق بعد رسم السياق لا يستطيع إصلاح النص
الذي دخل منطقة التذييل بالفعل. هذا هو العيب المتبقي المحدد لهذه الشريحة.

التغيير يخطط مقاطع الهوية قبل رسم أي منها. يقاس النص المحضر نفسه وبنفس خيارات
الرسم: Arabic regular، حجم10 للهوية و14 لعنوان القسم، عرض511، right وrtla.
لم تضاف عائلة أو أحجام أو ملفات خط. heightOfString يتضمن ارتفاع السطر وامتداده
السفلي؛ يضاف الفاصل الحالي0.4 سطر للهوية و0.5 للعنوان. لا يستعمل755 بوصفه
baseline مسموحًا؛ نهاية المساحة المحجوزة يجب ألا تتجاوز بداية التذييل.

- الوصف يمر عبر arabicSafe مرة واحدة قبل تقسيمه. المرجع الأول والبادئة يقاسان
  مع المقطع الأول ويرسمان مرة واحدة؛ تقسيم الوصف نفسه يمنع اختيار الفراغ بعد
  المرجع حدًا وحيدًا قبل كلمة طويلة. لا trim أو ellipsis أو قص أو تصغير خط.
- يحتفظ كل مقطع ببادئة متصلة من النص؛ تنقص بقية الوصف بصرامة. محاولة لا تسع
  المساحة الجزئية تنتقل إلى52 مرة واحدة، ثم إما تتقدم أو تتوقف لخلل هندسي.
  لا عدد صفحات ثابت أو رفض عام لوصف صالح من500 محرف بسبب طوله وحده.
- كل صفحة استمرار للوصف تكرر رقم القيد وتاريخه قبل بقيته. صفحات الجدول تستعمل
  callback المرجع نفسه. عنوان القسم لا يرسم قبل نجاح تخطيط أول مقطع.
- نهاية الوصف تحجز24 لرأس الجدول وارتفاع **مقطع فعلي** من الصف الأول، بقياس
  جميع خلاياه وخلايا المال غير القابلة للتقسيم عبر takePrintTableFragment.
  لا حجز كامل صف متعدد الصفحات، ولا اعتماد على minHeight وحده.
- احتياط هندسي0.01 نقطة يمنع اختلاف طرحy العائم في heightOfString من إعادة
  نقل الجدول بعد آخر مقطع. ليس تغييرًا لحجم الخط أو هامش تسامح للتذييل.
- آخر مقطع يبقى مع أول بيانات الجدول. عند الحاجة يترك المخطط بقية وصف للصفحة
  الأخيرة، بدل ملء الصفحة بالوصف وترك رأس الجدول منفردًا. النصوص والفواصل
  المحضرة محفوظة حرفيًا داخل المخطط، بما فيها الأسطر الفارغة والتشكيل. R2 يحول
  زوجCRLF إلىLF واحد في نسخة عرض الوصف فقط قبل arabicSafe؛ لا trim أو تحويل
  bareCR أو تعميمUnicode، ولا تغيير نص اللقطة الأصلية أو helper التقسيم.

## الملفات

| الملف | الغرض |
|---|---|
| apps/api/src/printing/print-journal-identity.ts | مخطط محدود لهوية القيد وحجز أول مقطع فعلي |
| apps/api/src/printing/pdf-renderer.ts | استبدال التدفق الأصلي للوصف بالمخطط؛ callback سياق واحد مع أول صف |
| apps/api/tests/print-journal-identity.test.ts | حفظ النص والترتيب/الفواصل/التقدم/الحجز والقياس |
| apps/api/tests/pdf-journal-identity.test.ts | خمسة اختبارات على bytes PDF الفعلية |
| apps/api/tests/helpers/pdf-identity-inspector.ts | قارئ classic-xref/chunks/BT/الخط والهندسة للعينات فقط |
| apps/api/tests/fixtures/pdf-journal-identity.ts | معايرة قصيرة و500محرف وCRLF وتشكيل ووصف قصير قرب حد الصفحة |
| docs/W2_PDF_IDENTITY_HANDOFF_AR.md | هذا التسليم الخاص |

لم تتغير print-decimal أو print-table-row أو document-heading أو مساعدASCII،
ولا Snapshot/schema/router/ports/domain/حسابات أو اعتماديات/package/lock.
لا اختبارات جديدة للـDB أو معاملات أو تفويض لأن المسار لا يغيرها.

## دليل الاختبارات المكتوب وحدوده

العينة الرئيسة تحتوي وصفًا من500 محرف بالضبط: سطر أول فاصل ثم125 كلمة عربية
من ثلاثة أحرف بتسلسل معلوم. قيد معايرة قصير في **PDF نفسه** يرسم أربع كلمات
ومراجع القيدين65535 و7 بالخط والحجم نفسيهما؛ تتطابق بصماتCID للأسطر الفعلية
مع التسلسل المتوقع، دون فكToUnicode أو مقارنةCID بين ملفات مختلفة.

يقرأ الفاحص كلContents عبرxref وأطوالstreams. يعد الأسطر بحزمBT ويحتفظ بكل
Tm/TJ داخل الحزمة لفحص كلbaseline معDescent الحقيقي منFontDescriptor. فحص
التذييل يستخدم غلاف مقاييس الخط المحافظ، وليس قياس حبرglyph أو إثباتUnicode.
تستخرج مساحة التذييل من النص المرسوم نفسه وتطابق بدايتها755، ثم يشترط أن
يبقى امتداد كل نص هوية تحت الحد الآمن فوقها. مصدر125 لا يستنتج من مخطط الرسم.
يرفض الفاحص عمليات النص/الإزاحة غير المدعومة بدل تجاهلها وحساب حدود بموضع قديم.
فحص الجدول الجديد يثبت وجود صف فعلي بعد كل رأس؛ لا يدعي قياسglyphs الجدول كلها
من جديد. تبقى103 اختبارات الأساس ومراجعةPNG جزءًا من قبول المصدر الحالي.

تشمل الحالات وصفCRLF من417 محرفًا مع60 سطرًا مرئيًا وأسطر فارغة، و299 محرفًا
معCRLF مفرد و60 سطرًا، و50 سطرًا
مشكلًا، ووصفًا قصيرًا ينقل كاملًا مع أول صف. كل حالة تفحص مرجعًا صحيحًا في
كل صفحة وصف/جدول، ورأس جدول له صف فعلي، ونهاية الوصف مع أول مال، وعدم تسرب
مرجع65535 إلى القيد7، وكل مبلغ مميز مرة واحدة، وعدم تعديل اللقطة.

اختباراتhelper تحفظ الفواصل التي لا تنتجglyph وتختبر حدودgrapheme وضمان
الإنهاء. لم يكتف القبول بها: فحصت صور صفحات الوصف والاستمرار والجدول والتذييل
بعد تشغيل المرشح. قيودBidi/free-text/ToUnicode الموروثة لا تدخل الحل أو القبول؛
لم يضف parserUnicode أو خط أو اعتماد.

## التحقق المنفذ

إعدادات محلية فقط في tmp/coordination/identity-qa/ داخل هذه النسخة علىD:
vitest.config.mjs وtsconfig.json وlaunch.py. ملفenv.ps1 قديم محفوظ ولم يشغّل.
القناة cmd.exe، login=false وtty=false. Node24.19.0 مباشر من subprocess
Python مع env محصور؛ لا توريث لمتغيراتDB/SMTP/payment. worker1،
no file parallelism، retry0، timeout30s، heap768MiB للأب والworker.

| المرحلة | النتيجة على round-02 | مدة الأمر |
|---|---|---|
| focused | 118/118، 9/9 ملفات، exit0؛ Vitest37.86s | 38.500s |
| narrowtypes | noEmit، exit0 | 1.031s |
| توليد4+baseline | 5 ملفاتPDF جديدة، exit0 | 6.047s |
| extraction | المبالغ الثمانية مرة واحدة لكلPDF، exit0 | 0.594s |
| Poppler150dpi | 32/32 صفحة، عملية واحدة كل مرة، exit0 للجميع | 7.922s |

فحص جديد قبل كل أمر: C>=1GiB وRAM>=2.5GiB؛ وقبل **كل صفحةPNG**
RAM>=3GiB. قبل118: C3.7516GiB/RAM4.2488GiB. عند آخرPNG:
C3.7480GiB/RAM4.2257GiB. حررت نافذةruntime فور انتهاء الرسم وأبلغ المنسق؛
لا خادم أو جلسة حية. استمرت بعد ذلك قراءة الصور وصيانة التقرير والبصمات فقط.

الأوامر الفعلية محفوظة كاملة مع cwd/resources/exit/sourceBefore/sourceAfter
في round-02/*-start.json و*-result.json، وstdout/stderr في ملفاتlog مستقلة.
النماذج التالية من جذر الشجرةD؛ تستبدل PYTHON وNODE بمساريهما القائمين:

```text
PYTHON = C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe
NODE = C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe

PYTHON -B tmp/coordination/identity-qa/launch.py round-02 focused NODE --max-old-space-size=768 node_modules/vitest/vitest.mjs run --config tmp/coordination/identity-qa/vitest.config.mjs --configLoader runner --reporter=default --reporter=json --outputFile=tmp/coordination/identity-qa/round-02/tests.json
PYTHON -B tmp/coordination/identity-qa/launch.py round-02 types NODE --max-old-space-size=768 node_modules/typescript/bin/tsc -p tmp/coordination/identity-qa/tsconfig.json --noEmit --pretty false
PYTHON -B tmp/coordination/identity-qa/launch.py round-02 baseline-source PYTHON -B tmp/coordination/identity-qa/prepare-baseline.py
PYTHON -B tmp/coordination/identity-qa/launch.py round-02 generate NODE --max-old-space-size=768 --import tsx tmp/coordination/identity-qa/generate-matrix.mts
PYTHON -B tmp/coordination/identity-qa/launch.py round-02 extract PYTHON -B tmp/coordination/identity-qa/extract-matrix.py
PYTHON -B tmp/coordination/identity-qa/launch.py round-02 png-matrix PYTHON -B tmp/coordination/identity-qa/render-matrix.py
```

لا تعاد الأوامر إلى round-02: المخارج ترفض الكتابة فوق دليل موجود. أي تشغيل
لاحق يحتاج مجلد جولة جديدًا وتخصيص الموارد من المنسق.

لاDB/build/browser أو طباعة فعلية. node_modules المشتركة للقراءة فقط؛
TEMP/TMP/profile/cache/logs/PDF/PNG علىD، وcompilecache معطل. أي commit محلي
يراعى شرطC>=1GiB؛ لم يجر install/generate أو كتابة داخل الاعتماديات المشتركة.

## مصفوفة PDF والفحص البصري

جذر الأدلة: D:/CodexWorktrees/wave2-pdf-identity/tmp/coordination/identity-qa/.
جميع العينات مصطنعة للطباعة فقط ولا تتصل بقاعدة بيانات. استعملbaseline
نفس fixture الحالي مع ملفاتPrinting المستخرجة byte-for-byte عبرgit show
منe3d6ba03؛ بصماتها في round-02/baseline/manifest.json. نسخpackage.json
القديم داخلbaseline يوفر سياقESM فقط، دون تعديلpackage/lock للمشروع أو تثبيت.

| PDF داخل round-02/pdf | الصفحات | حزم أسطر الوصف | أقل فصل لغلاف الهوية عن التذييل |
|---|---:|---:|---:|
| long-identity.pdf | 8 | 125/125 بالتسلسل نفسه | 16.912pt |
| blank-identity.pdf | 8 | 60/60 مع الأسطر الفارغة | 18.232pt |
| shaped-identity.pdf | 6 | 50/50 مع مواضع الحركات | 16.962pt |
| short-identity.pdf | 2 | 4/4 مع أول صف | 186.232pt |
| baseline-long-identity.pdf | 8 | 125/125 | -33.9204pt؛ العيب القديم |

التذييل المقاس يبدأ عند755. أعلى امتداد سفلي للهوية في العينة الطويلة الحالية
738.088، مقابل788.9204 فيbaseline. سجلbaseline22 **glyph-run** تدخل المنطقة؛
ليست22 كلمة مكررة. صفر منها في العينات الأربع الحالية. هذه حدودFontDescriptor
المحافظة لكلTm/TJ، وليست قياس الحبر الفعلي. حزمCID والمواضع في ملفJSON ملاصق
لكلPDF؛ matrix.json يجمع القياسات وبصماتPDF. النصوص ونتائج استخراج المبالغ
في round-02/text/، ولم يستعمل فكToUnicode لإثبات ترتيب النص العربي.

راجعت الصور32/32 بحجمها الأصلي: مراجعة المسار شملتlong1..8 وbaseline1..8،
ومراجعة مستقلة قرائية شملتblank1..8 وshaped1..6 وshort1..2. لم يظهر عيب
مرئي جديد ضمن هذا النطاق:

- long: صفحات2..5 تكرر مرجع65535 والتاريخ قبل الوصف؛ صفحة6 تجمع آخر كلمة
  مع الرأس وأول مقطع؛7 استمرار بلا مال مكرر؛8 نهاية الحساب ثم القيد7 مستقلًا.
- blank: فراغاتCRLF واضحة في2..4، نهاية الوصف وأول مقطع في5، استمرار6..7،
  القيد7 في8. CRLF المفرد مثبت باختبارPDF؛ العينة المرسومة للفاصلين فقط.
- shaped: الحركات مرئية وغير مقصوصة في1..3؛ نهاية الوصف مع أول مقطع في3؛
  استمرار4..5؛6 للتوقيعات فقط. لا بيانات قيد تحتاج مرجعًا على صفحة التوقيع.
- short: المعايرة وجدولها في1، والوصف القصير كاملًا مع صفوفه في2؛ لم يترك
  عنوان أو رأس جدول بلا بيانات. المبالغ الثمانية مرئية مرة واحدة بكل عينة.

صور قبل/بعد لعرض النتيجة، من المصفوفة نفسها دون عينات إضافية:

- [قبل: الوصف يدخل التذييل](D:/CodexWorktrees/wave2-pdf-identity/tmp/coordination/identity-qa/round-02/png/baseline-long-identity-page1.png)
- [بعد: نهاية الوصف فوق التذييل](D:/CodexWorktrees/wave2-pdf-identity/tmp/coordination/identity-qa/round-02/png/long-identity-page1.png)
- [بعد: مرجع القيد مع استمرار الوصف](D:/CodexWorktrees/wave2-pdf-identity/tmp/coordination/identity-qa/round-02/png/long-identity-page2.png)

المنسق راجع هذه الصور الثلاث أيضًا ولم يسجل finding جديدًا. ملفاتPNG منفصلة
لكل صفحة مع الأمر ومواردها وexit وstderr؛ لا تعديل أو قص للصور الأصلية.
تحذيرToUnicode القديم ظهر فيbaseline والحالي أثناءالاستخراج؛ محفوظ فيstderr.
وفيstderr للرسم ظهر No display font for Symbol/ArialUnicode في النسختين؛
لم تثبت خطوط ولم يظهرglyph مفقود في هوية العينات المصورة. لا يمنح نجاح
استخراج المبالغ قبولًا شاملًا للعربية أو النص المختلط.

## بصمات المصدر وتسليم الأدلة

source-before.json في كل جولة يحتوي البصمات الكاملة لملفات النطاق السبعة
والـconfigين. مجلدsource/ في كل جولة يحفظ نسخها byte-for-byte وقت التشغيل.
لم يتغير أي من ملفات الإنتاج/الاختبار الستة أوconfigي التحقق بعدround-02؛
هذاhandoff فقط حدّث بعد نهاية التشغيل ليصف النتائج الفعلية.

| المصدر وقت التحقق | SHA256 |
|---|---|
| pdf-renderer.ts | 022E9D35DC38B42DE6BC6A118BD4498195F76167E161D518053A84171C6A0C5C |
| print-journal-identity.ts | 0B964A0F69CE7285A65E7DA489F8D6094D358B7AE562E00A08128032445FF6F1 |
| print-journal-identity.test.ts | 910AEB52B30B1946289E41BE6174E4A6F80DEB91D5DD69E3C0455A4B1B6AF0D4 |
| pdf-journal-identity.test.ts | 3C97F55506DB5158E14E5E9B9D642E0F47CCAB4D1771FEA5066A0973FDCF24B6 |
| pdf-identity-inspector.ts | 5905E3FC33754D2DD64F31FE71B5ECB1591BBA29317BA81A318E8EB82314FF80 |
| pdf-journal-identity.ts fixture | 1535CAFABF6C35A08B3F134FFE72006A23535D22F1D41BD7CA4354B53F6009F6 |

الجرد النهائي وبصمات الأدلة فيtmp/coordination/identity-qa/artifact-manifest.json؛
إيصالcommit المحلي HEAD/parent/branch/list/diffcheck/resources وبصماتالمصدر
فيtmp/coordination/identity-qa/delivery-receipt.json. إيصالGit يميز bytes
الشجرة المختبرة عن bytes الـblob مع تطبيعCRLF المعتاد؛ لا تغيير دلالي بعدالتحقق.

## الجولة الأولى والتصحيح المثبت

round-01 تحتtmp/coordination/identity-qa/ يحتفظ بـstdout/stderr/exit/resources
والبصمات ونسخ الملفات التسعة وقت التشغيل. نجحت116/117 في36.75 ثانية، والأمر
37.453 ثانية، دونtimeout أوhang. C3.755GiB/RAM4.248GiB قبل الاختبار. استعمل
المشغلPython/ctypes/shutil وsubprocess/env يسمح فقط بمتغيرات النظام الضرورية؛
لا توريث لمتغيراتDB/SMTP/payment، ولا طباعة قيمها. heap768 للوالد والـworker.

crlf-diagnostic.pdf (24696bytes،8صفحات) وcrlf-diagnostic.json يحفظان الحالة
الفاشلة قبل التعديل. حزم الوصف119 تتكون من59 كلمة معCID51، و59 حزمةCID51
وحده، وكلمة أخيرة دونCR. إذن توجد60 كلمة فعلية ولا فقد أو تكرار للوصف.
crlf-font-diagnostic.json يثبت CID51→000d وعرض260 وglyphBytes=0/contours=0
في الخط المضمّن وCIDToGIDMap=Identity. هوCR غير مرئي ذوadvance، لا حزمة فارغة
من المعاملات ولا حرف وصف إضافي. مواضع الكلمات تفصل42.24pt للفاصلينCRLF.

PDFKit_fragment يزيلLF فقط ويتركCR للـfont encoder. يحولR2 CRLF إلىLF في
نسخة عرض وصف الهوية فقط؛ القياس والرسم يستعملان النسخة نفسها. بقي توقع60
حرفيًا، وأضيف CRLF مفرد معpitch21.12 مقابل42.24 للفاصلين، بقياس الخط الفعلي.
لا إسقاط محارف وصف أو إعادة تعريف snapshot. هذا هو فرق الإنتاج الإضافي الوحيد
بعد المراجعة الأولى؛ helper التقسيم والمال والخطوط لم تتغير.

فشل تشغيل سكربت التشخيص.ts أولًا لأن جذرالمشروعCJS لا يقبلtop-level await؛
حفظ كما هو واستخدمت نسخة.mts. كذلك لم تتوفرfontTools؛ لم تثبت، واستعيض عنها
بقراءةloca/glyf المضمّن عبرstruct القياسي. هذان خطآ تجهيز محليان محفوظان،
لا pass أو تغييرًا في اختبارات المصدر. لم يعاد marker الخاص بمهارةPDF؛ نجح
مرة واحدة قبل أمر إنشاء الأثر الأول. لا كتابة أو cache في الاعتماديات المشتركة.

## Barcode Impact والملكية

Printing يملك هذا التعديل. يمس صفحات وصف هوية القيد فقط؛ لا يغير بنود الأصناف
أو رموزها أو تعريف/قراءة الباركود أو اللقطة التاريخية أو إخراج ملصق. تبقى
قدراتB1/ASCII/الأرشفة القائمة كما هي، ولا ينشأ live lookup أو QR أو إعادة بصمة.
لذلك لا يحتاج هذا الإصلاح تغيير عقد باركود، ولا يغلق قبول أجهزة الطباعة أوB3.
ملكيةLedger وACID وDecimal والعزل وCSRF/RBAC/idempotency/version لم تمس.
