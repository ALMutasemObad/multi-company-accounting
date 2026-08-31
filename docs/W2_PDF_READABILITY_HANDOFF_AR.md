# W2-PDF-READABILITY — مرشح مصدر مستقل عن R3

31 أغسطس2026. نسخة العمل D:/CodexWorktrees/wave1-pdf-decimal، الفرع
fix/wave1-pdf-decimal، HEAD ثابت c7ffc99306a180387bb1a618d0d2750f762bf48b.

## الحالة والنطاق

R3 وأدلته مجمدة ومحفوظة. نجحت دقةDecimal وهندسة خلايا المال والاستمرار في
65اختبارًا و12PDF/26PNG؛ لا يعني ذلك قبول الطباعة المرئية بالكامل.
W2 مستقل لمعالجةmissingglyphs والنص المختلط وتزاحم عنوان المستند مع رقمه.
وصف هوية القيد الطويل/التذييل P2 منفصل ولا يدخل هذا التعديل.

**المنفذ الآن: مرشح الرأس فقط ومصدر8اختبارات غير مشغلة.** حلglyphs لم ينفذ؛
جرده وتصميمه فيالقسم التالي. N1 يملك نافذةالتشغيل؛ لم يشغلNode/Python/PDF/PNG
أوtypes/tests/Gitwrites بعد إسنادW2. لاdownload/install أوتعديلnode_modules.
لايستعمل نجاحR3 للتحقق منW2. لاcommit/push/PR/merge/deploy.

## جرد الخطوط

المصدرالمثبت @fontsource/noto-sans-arabic5.3.0؛ metadata يذكرNotoSansArabic v33
ومصدرhttps://github.com/google/fonts وCopyright2022TheNotoProjectAuthors
(https://github.com/notofonts/arabic)، وترخيصOFL-1.1 محفوظفيLICENSEبالحزمة.
قرئالترخيص؛ لا تغييرfamily أو أصل خط أو تنزيل ملف ضمنW2 الحالي.

| المجموعة القائمة | الاستخدام/التغطية المعلنة |
|---|---|
| arabic400/700-normal.woff |الملفان المضمّنان حاليًا؛ Unicode-range يغطيArabic ولا يعلنASCII Latin |
| latin400/700-normal.woff |متاحان بنفسالعائلةوالإصدار؛U+0000..00FF وبقيةLatin الأساسية/ترقيم وبعضرموز |
| latin-ext400/700-normal.woff |متاحان للاتينيةالموسعةوالتشكيلاللاتيني؛ليسابديلينعنالعربية |
| math/symbols |موجودان،غيرمطلوبين لإصلاحITM/UNIT؛ لا إضافة لهما تلقائيًا |
| Helvetica/Helvetica-Bold |الوجهان القائمان للأموال والرموزاللاتينيةالمنفصلة؛ لايستبدلانخليةArabicكاملة |

هذا **جردmetadata/CSS والمصدر**، وليسcmap scan بمحركخط أو إثباتتغطيةكلglyph.
دليلPNG السابق يثبتفشلITM/UNITفعليًا. لم يجدجردapps/packages/node_modules أصلًا
موحدًا كاملاً جاهزًا منNoto؛ Fontsourceيوفرsubsets، وCodicon ليسخطًا للنص العربي.
بصماتملفات400/700 الستوالmetadata/LICENSE تحفظمحليًا في
tmp/coordination/w2-readability/font-inventory.json.

## تصميم glyphs المعروض قبل الحل الواسع

PDFKit EmbeddedFont.layoutRun يمررtext/features إلىfontkit.font.layout دونscript
أوdirectionصريحين. Fontkit Script.forString يختارأولscriptقوي؛
OTLayoutEngine.position يعكسglyphs/positions للمقطع كله حينrtl. لذلك لايكفي
أننجمعglyphs فيملفواحد لقبول«شركة ACME» أو«ACME شركة» أو الأقواسوالأرقام.
Unicode isolatesليستحلًا وحدها؛ محركfontkitيخفيها ولايطبقUAX9للنص المختلط.

الاقتراحالأضيق الذييحفظالعائلةوالنص:

1. helperمحلي لتخطيطخلاياالنصMixed، يختارArabicأوLatin/Latin-ext مننفسالعائلة
   للمقاطع، ويحفظنصالخليةكاملًا دونترجمةرموزأواختصارأوقلبحروفلاتينية.
2. ترتيبBidi موثوق للمقاطعفيكلسطر قبلرسمها، ثمتشكيلكلrunباتجاهه. لا استخدام
   continued كتبديلخط عشوائي ولاكتابةخوارزميةBidiجزئيةبالـregex.
3. مخططواحدللقياسوالرسم: widths/heights/baseline نفسها تستخدمفيmeasureHeight
   وtext؛ التفافعندحدودكلمة/grapheme معحفظالبقاياوضمانتقدمR3 وعدمإعادةالمال.
4. لايمسhelperFormatter الماليأوSnapshot/schema/domain/router، ولاfontfamilyعالمي.

لميوجدUAX9/Bidi engine ضمنالاعتمادياتالمفحوصة. إدراجتنفيذموثوقمراجَع يتطلبعرض
المصدر/الترخيصوالملفات واعتمادحدوده قبلالتنفيذ؛ **لم يضف dependency أوvendor**.
بديلدمجarabic+latin(+latin-ext) فيأصلينثابتين400/700 يمكنأنيفيدglyphcoverage
معالحفاظعلىGSUB/GPOS/GDEF وcmapوالمقاييس، لكنهلايسقطبوابةBidi ولايعدحلًا مكتملًا.
Fontkit.createSubsetليسأداةدمجخطوط مستقلة. لاpatchglyphs جزئييخفيالمشكلة.

ملفاتحلglyphsالمحتملة بعداعتمادتصميمه: helperداخلPrinting واختباراته،
pdf-renderer.ts وfixtureMixedمستقل؛ أيملفاتfont/vendorمطلوبة تعرضقبلإضافتها.
حالاتالقبولالمكتوبةكخطة: ITM-123/UNIT-45، Arabic+ACME والعكس، الأقواسوالسالب
والأرقام، التشكيلالعربي، CRLF/NBSP، التفافالكلمات وصفحاتالاستمرار. يلزمPDFفعلي
وglyphIDsغيرصفرية وترتيبمقاطع/نص وPNG، ولايكفيفحصhasGlyphأوformatter.

## مرشح الرأس المنفذ

الملفات:

- apps/api/src/printing/pdf-document-heading.ts: helperرأس فقط، يعيدأسفلهالمقاس.
- apps/api/src/printing/pdf-renderer.ts: يستدعيhelper، ويضعالبطاقةوالجسم منأسفله.
- apps/api/tests/pdf-readability.test.ts:8حالاتPDFمكتوبة، دون تشغيل.
- docs/W2_PDF_READABILITY_HANDOFF_AR.md: هذهالوثيقةالمنفصلة.

يحافظhelperعلىArabicregular23 للعنوان (الوجهالفعليالذيكانrightيفرضه)،
Helvetica-Bold12 للرقم، وArabicBold9 للشارة. لاfamily/sizeجديد.
الشارةبعرض64 فيعموديسارمنفصل، بينهاوبينالعنوان12pt؛ عرضالعنوان/الرقم435pt
وينتهيانعند553كالواجهةالقائمة. الشارةمحاذيةللسطرالأولللـtitleبقياسlineheight،
ونصهايتوسطارتفاع25بقياسهالفعلي. لايمكنللعنوانالملتفالاستيلاءعلىعمودالشارة.

يقاسالعنوانheightOfString بنفسfont/size/optionsالرسم، وبعدهgap6ثم الرقم
المقاسبالطريقةنفسها. أسفلالرأسmaxللبلوكاتالثلاثة. أعلىالبطاقةmax(190, bottom+14)،
وجسمالمستندمنdetailsY+detailsHeight+20، دونإرجاعy315الثابتة. ارتفاعالبطاقةالقائم
105محفوظ؛ لايوسعهذاالتعديلمعالجةالوصفالطويل خارجالنطاق.

الاختباراتالمكتوبةتفكPDFstreamsوحزمBT/ET وتقرأFontDescriptor/Descent للعنوان
وTmللنص. تفحصمسافةمرئيةبينحدالعنوانالأسفلورقمالمستند، وتوضعالتاريخبعدالرقم.
تستعمل60W ضمنVARCHAR(60) ليلتفالرقم؛ والاختبارالثامنيرسمعنوانًاعربيًايلتف
عبرhelperمباشرةويتحققمنفصلعمودهعنالشارة. لاSnapshotمصطنعجديدولافكCIDلادعاءالعربية.

## التسليم والتحقق المؤجل

تحفظحزمةالرأسفيtmp/coordination/delivery/w2-header-1/؛
W2_PDF_HEADER_DELTA.patch قاعدتهrendererمنR3المجمد، **بعدR3** وليستمنHEAD.
لايستبدلR3 ولايخلطبهحلglyphsغيرالمنفذ. الوثيقةW1وتقريرQAالسابقليساجزءًامنpatchW2.

configمستقبليةخاصةبـW2 فيtmp/coordination/w2-readability/ تشمل65حالةR3+8حالات
الرأس=73حالةمكتوبة، لمتشغل. configالرسموالأنواعوالـworkerلايعنيإذنًاللتشغيل.
يبقىمطلوبًا عندتخصيصنافذة:73focusedtests/narrowtypes ثمPDF/PNGللعنوانالملتفللنوع
الأطولوالمستندبرقم60محرفًاوالشارة، ومراجعةصفحاتالجداولالتيقدتتغيربالإزاحة.
كلنتائجاختباراتW2 وPDF/typecheck **غيرمنفذة** حتىالآن، ولااعتمادنهائي.
