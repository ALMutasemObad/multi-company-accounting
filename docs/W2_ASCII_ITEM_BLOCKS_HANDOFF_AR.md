# W2 ASCII item blocks — مرشح مصدر بعد حزمة الرأس

31 أغسطس 2026. النسخة D:/CodexWorktrees/wave1-pdf-decimal؛ الفرع
fix/wave1-pdf-decimal؛ HEAD ثابت c7ffc99306a180387bb1a618d0d2750f762bf48b.
لا commits أو Git writes أو نشر. لم يشغّل Node/PDF/PNG/tests/types لهذه الحزمة.
QA يملك نافذة التشغيل؛ جميع نتائج التحقق التنفيذي أدناه **غير منفذة**.

## القاعدة وحفظ الأدلة

هذه delta **بعد R3 ثم حزمة header**، وليست patch مستقلة من HEAD:

1. R3 combined من HEAD: SHA256
   F7C740E0D11FDDA97C49A158393DD6D8B26020F8183B2552009D34716CB4D000.
2. header delta بعد R3: SHA256
   6F001880FBC1E7D0CA43244A7F3DFED919E9661586B4ACFD49A303E04424DFE7.
3. W2_ASCII_ITEM_BLOCKS_DELTA.patch في tmp/coordination/delivery/w2-ascii-1/.

قاعدة renderer للخطوة الثالثة هي نسخة LF المحفوظة في
delivery/w2-header-1/files/apps/api/src/printing/pdf-renderer.ts، وبصمتها
6D8E44B67CA5A7CAF8F2BF95943DA33B2DD8104C2D6D6A2E71983D69590243E7.
حزم R1/R2/R3/header والأدلة القديمة والتقرير المحدود لـbidi-js لا يعاد حفظها
فوق نسخها السابقة. التقرير رفض bidi-js1.0.3 كما هو، ولا dependency جديدة هنا.

## التغيير المنفذ

- print-invoice-description.ts يبني metadata من حقول Snapshot المستقلة فقط.
  يشترط itemName كما كان، وcode واحدًا حاضرًا على الأقل، وأن تكون **كل** قيمة
  code الحاضرة غير فارغة وprintable ASCII. null/undefined غياب؛ code فارغ أو
  مختلط أو control يعيد الخلية كاملة للمسار السابق دون خطأ أو إسقاط حقل.
- الرموز تحفظ حرفيًا بلا trim/uppercase/arabicSafe. ترتيب الكتل داخل عمود
  الوصف: itemCode، itemName، (unitOfMeasureCode)، description؛ لا صف أعمال
  إضافي. غياب code لا ينشئ بديلًا له. فواصل القالب القديمة تحل محلها فواصل
  كتل؛ لا تحرير لأي حروف داخل الحقول أو تعديل Snapshot.
- الاسم والوصف يظلان بخط Arabic ومعالجة arabicSafe الحالية مرة واحدة قبل
  التقسيم. لا تصنيف لاتيني للنص الحر أو تخمين لاتجاهه.
- pdf-renderer.ts يسجل ArabicLatin من ملف Noto Sans Arabic Latin400 القائم؛
  حجم7 الحالي، LTR ومحاذاة يسار دون rtla. العربية بحجم7 ومحاذاة يمين كما كانت.
  لا تغيير family أو تنزيل font أو إدخال وزن/حجم جديد.

الأصل القائم: @fontsource/noto-sans-arabic5.3.0، OFL-1.1؛ الملف
noto-sans-arabic-latin-400-normal.woff بصمة
86DAB403DB7F723E9C15DE4324C2752C5A350BDD5344458850B2DA9B7D2E332E.
جرد CSS/metadata/ترخيصه سابق ومحفوظ؛ فحص glyphs الفعلي ما زال مؤجلًا.

## القياس والتقسيم

كل block له field/rawText/prepared text وfont وstart/contentEnd/end على النص
المجهز. synthetic newline بين الكتل مملوك للكتلة السابقة؛ لا يرسم glyph،
ويستهلك gap2pt مرة واحدة. source newlines جزء من المحتوى وتبقى مستقلة عنه.
لا فاصل مصطنع بعد آخر كتلة ولا indexOf أو بحث عن محتوى متكرر.

كل view مربوط بـcursor ثابت. fragment(prefix) يقيس تقاطعات النطاق فقط ويعيد
خطة قطع وy نسبي وارتفاع؛ القياس والرسم يستعملان هذه الخطة نفسها. يُحتفظ بخطة
واحدة أخيرة للـview؛ لا cache دائم أو غير محدود. يعاد إنشاء view بعد استهلاك
fragment مقبول وقبل newTablePage؛ لا يعاد استعمال closure الموضع السابق.

print-table-row.ts لم يتغير. يظل يبحث في حدود graphemes ويعيد التحقق من الملاءمة
ويستهلك prefix والبقية دون حذف. الرموز يمكن أن تلتف أو تستمر، وليست atomic؛
أعمدة المال وحراس تقدم R3 وتكرار رأس الجدول بقيت كما هي. أخطاء cursor/prefix
الجديدة حراس اتساق داخلي فقط؛ guard eligibility لا يرفض نصًا صالحًا برمي خطأ.
أقصى نص الحقول الأربع ضمن اللقطة760محرفًا، مع قوسين وثلاثة فواصل كحد إضافي.

## الاختبارات المكتوبة، دون تشغيل

print-invoice-description.test.ts: 24حالة. تشمل raw ASCII والمسافات والحروف
الصغيرة، guard لكل الخلية، code منفرد، عدم معالجة النص الحر المختلط، تطابق
خطة القياس والرسم، كل موضع قطع حول الفواصل، نصوص متكررة، source blank lines،
وتقسيم R3 الفعلي عند budget صغير بخطي قياس مختلفين لكشف cursor قديم أو تكرار
الرمز/المال. نموذج المقاييس هنا لا يدعي صحة الخط؛ اختبار PDF مستقل لهذا الغرض.

pdf-invoice-item-codes.test.ts: 6حالات وعينة مستقلة لا تستعمل formatter أو helper
كمرجع للنص المتوقع. يفحصان PDF الناتج وموارد fonts وCID/ToUnicode للرموز
اللاتينية، بدل تفسير CID كـWinAnsi. حالات الحدود40/20 والالتفاف والاستمرار
والحقول الغائبة/غير المؤهلة لا تثبت العربية البصرية أو النص المختلط العام.
قارئ الاختبار يحتفظ بأخطاء ToUnicode العربية الموروثة منفصلة دون ادعاء فكها؛
يرفض mapping غير صالح أو مفقود وCID0 في الخط اللاتيني المستعمل للرموز. يحسب
50سطر اسم و125سطر وصف من baselines فعلية فريدة في العينة غير المشكلة، مع
حدود الخلايا ورأس الجدول، لا من عدد TJ أو Unicode عربي مُفترض.

صححت المراجعة المصدرية guard كان يستعمل `$` القابل للوقوف قبل LF أخير:
الحارس الآن يشترط nonempty ويرفض أي محرف خارج المجال أينما كان. أضيفت حالات
LF/CR/U+2028 النهائية؛ لا نتيجة تشغيل لها. هذه المراجعة لا تحل محل الاختبارات.

config المستقبلية في tmp/coordination/w2-ascii/ تجمع 103حالات مكتوبة:
65من R3 +8للرأس +24للـhelper +6للـPDF. لم يشغّل هذا المجموع على مصدر W2.
نجاح65السابق خاص بمصدر R3 المجمد فقط. تجمع اختبارات R3 والرأس وASCII
بـworker1/no file parallelism/timeout30s/retry0. tsconfig ضيقة noEmit للملفات
المعنية. لا config جديدة تمنح إذن تشغيل؛ لا pass/timeout مسجل لهذه الحزمة الآن.

## أوامر التحقق المؤجلة وحدود القبول

بعد تخصيص المنسق النافذة وفحص C>=1GiB وRAM>=2.5GiB قبل كل أمر، ومن هذه النسخة
فقط وبالتسلسل: Node مباشر heap768MiB وNODE_OPTIONS نفسه للworker؛
NODE_DISABLE_COMPILE_CACHE=1، TSX_DISABLE_CACHE=1، TEMP/TMP/cache/logs على D،
GOMAXPROCS=2 وGOMEMLIMIT=1536MiB. لا DB/build/browser/npm/generate/shared writes.

الأهداف التالية مصدر أوامر فقط، **لم تنفذ**:

```text
node --max-old-space-size=768 node_modules/vitest/vitest.mjs run --config tmp/coordination/w2-ascii/vitest.config.mjs --maxWorkers 1 --no-file-parallelism --retry 0
node --max-old-space-size=768 node_modules/typescript/bin/tsc -p tmp/coordination/w2-ascii/tsconfig.json --noEmit
```

عند نجاحهما: توليد عينات فعلية في مجلد جديد مع بصمات المصدر، بما فيها العينات
السابقة وheader الملتف وfixtures ASCII، ثم استخراج النص وPoppler PNG لكل صفحة.
يلزم رؤية الرموز كاملة وبترتيبها، وغياب glyph0، وقياس الحدود وعدم التداخل،
واستمرار الاسم/الوصف ورأس الجدول والمال مرة واحدة. لا كتابة فوق PDFs السابقة.
أي assertion/types/extraction failure يوقف الجولة للتشخيص دون rerun تلقائي.

Mixed free text و«شركة ACME» وحسابcode+name والرموز غير المؤهلة خارج القبول.
ToUnicode العربي الموروث ليس قبولًا للاستخراج؛ PNG العربية وصفحات الاستمرار
شرط لاحق. وصف هوية القيد الطويل/footer P2 مستقل ولم يوسع هنا. لا اعتماد نهائي
لطباعة W2 قبل التحقق؛ نجاح R3 السابق لا ينتقل إلى هذه الحزمة دون إعادة تحقق.
