# توافق fixture العرض مع عقد POS في W2

الحالة: اجتاز التحقق المحلي المحدود في 31 أغسطس2026: الأنواع، list16، وbrowser16/16، دون إعادة تشغيل. الشجرة `wave2-pos-visual-compat`، الفرع `fix/wave2-pos-visual-compat`، الأساس المجموع `371917a334e87aea3131dc2a9acc4cb4a63f8fe6`. لا تغيير في المنتج أو N2 أو grocery/track-r1 أو حزمةCI59c9. لا نشر أو قبولDB أو ادعاء إعادة مصفوفة336.

## العيبان المثبتان

1. `scripts/visual-qa-server.mjs` أعاد fallback للقائمة بلا `posContext` لقراءة الهوية والسجل. مستخدم الـfixture يملك `pos.view`، ولا يملك `pos.checkout`؛ الواجهة الجديدة تتحقق من `/pos/context/identity?purpose=history` ثم `/pos/sales`، وتحجر السياق عند غياب الهوية من أي رد.
2. `tests/visual/responsive-ui.spec.ts` اشترط تنبيه رفض في `.pos-recovery`، بينما `PosPage` الجديد لا يرسم لوحة recovery أصلًا لمستخدم العرض فقط. إضافة رد الهوية وحدها لا تصلح هذا assertion.

## التعديل المحدود

في الـfixture، مسارا GET للهوية بغرضhistory والسجل يعيدان metadata مأخوذة من هوية الـfixture الثابتة user/company=`1/1`، بعد مقارنة رأسي expected بها. الرأس الناقص أو غيرcanonical يعيد400، والهوية المختلفة409، بلا هوية في رد الخطأ. لا تُنسخ الهوية من رأس العميل إلى الرد. بقيت صلاحيات الـfixture كما هي؛ طلبات checkout/recovery/cashier وأي كتابةPOS ترفض403. يمرر HTTPdispatch الرؤوس ويستعمل status الخطأ لهذه المسارات فقط؛ ردود المسارات الأخرى لم تتغير. `responseFor` يحتفظ بتوافق الاستدعاء ذي المعاملين للمسارات غيرPOS.

داخل حالة الشاشات الـ29 نفسها، يرصد الاختبار قراءات POS ورأسي الهوية وmetadata للردين، ثم يفتح تفاصيل السجل ويتحقق من نص حالته الفارغة المحلية بعد التحميل. يشترط غياب quarantine والـalerts وform/checkout/scanner/recovery، ويرفض أية كتابة أثناء زيارةPOS أو كتابةPOS متأخرة. أُزيل استثناء تنبيهPOS من فحص أخطاء الواجهة؛ لا يقبل عنوانًا عامًا بدل السجل الجاهز.

يُجري داخل خطوةPOS فحصي GET محدودين للـfixture: غياب الهوية→400، وطلب company2 أمام الهوية الثابتة1→409. لا يرسل أي POST أو recovery أو ينشئ محاولة بيع. لم تُضف أسماء حالات أو projects؛ هذه assertions مرتبطة مباشرة بالـfixture المعدل، وليست قبولًا لخادم الإنتاج أو DB.

## الحالات الفعلية المتأثرة

الملف: `tests/visual/responsive-ui.spec.ts`. داخل كل حالة أدناه، تظل زيارة جميع الشاشات الـ29 كما كانت، ومنها خطوة `pos` عبر التنقل؛ لا تصفية للخطوات داخل الحالة.

| الاسم الثابت | mobile-390 (390×844) | tablet-768 (768×1024) | desktop-1440 (1440×900) | wide-1920 (1920×1080) |
| --- | --- | --- | --- | --- |
| ar: all 29 screens satisfy the responsive interface contract | مطلوب | مطلوب | مطلوب | مطلوب |
| en: all 29 screens satisfy the responsive interface contract | مطلوب | مطلوب | مطلوب | مطلوب |
| ur: all 29 screens satisfy the responsive interface contract | مطلوب | مطلوب | مطلوب | مطلوب |
| hi: all 29 screens satisfy the responsive interface contract | مطلوب | مطلوب | مطلوب | مطلوب |

المجموع16 فقط من مصفوفة336. caller الحالي: خطوة `subscription-qa:test` في job `verify` → `package.json` → `playwright.integration.config.ts` الذي يشمل visual على المشروعات الأربعة. `playwright.visual.config.ts` يستعمل الملف نفسه يدويًا، لكنه ليس خطوةCI إضافية. لم نجد حالةPOS فعالة أخرى ضمن track-b/d/e أو E2E خارج grocery وtrack-r1؛ فحص زرPOS في system-home لا يفتحه، وbarcode داخل محرر الفاتورة ليس PosPage.

## أمر التحقق الضيق بعد تخصيص الموارد

التخصيص `W2-POS-VISUAL-20260831-A`: الأنواع عبر `tsconfig.integration.json` أولًا، ثم list16، ثم browser16. المشغّل والـoverlay محليان داخل `tmp/coordination/pos-visual-compat`، وليسا ملفات دائمة جديدة. الأوامر التالية تسلسلية من جذر الشجرة؛ `NODE` هو ملف Node القائم، و`CHROMIUM` ملف Chromium القائم الصريح:

```text
NODE --max-old-space-size=768 tmp/coordination/pos-visual-compat/run.mjs types CHROMIUM
NODE --max-old-space-size=768 tmp/coordination/pos-visual-compat/run.mjs list CHROMIUM
NODE --max-old-space-size=768 tmp/coordination/pos-visual-compat/run.mjs browser CHROMIUM
```

يُنشئ المشغّل مجلدًا جديدًا لكل أمر داخل `runs`، ويثبت المصدر أمام `prepared-pins.json` قبل وبعد التنفيذ؛ النسخة المسبقة محفوظة في `prepared-source`. يحافظ overlay على مشروعاتconfig الأربعة نفسها، ويختار الأسماء الأربعة كاملة دون تصفية أي خطوة. تُحفظ أوامر/exit/time وstdout/stderr وHEAD وبصمات المصدر. لا يُعاد تشغيل336 أو58، ولا يستعمل دليل قديم. نتيجة القبول المطلوبة16passed/zero skip/zero retry مع تطابقfile/title/project، و29خطوة لكل حالة، لا مجردexit0.

الخادمان fixture3133 وVite4183 مع reuse=false. ينتظر Playwright stdout من كل طفل يملكه ثم يفحص readiness هويةfixture للعرض فقط وصفحةVite. لا يثق بوجودlistener سابق؛ يُفحص خلو المنفذين قبل وبعد عبر connect بمهلة3ثوانٍ وexclusivebind. Playwright CLI يعمل داخل عملية Node نفسها ويملك مقابضwebServer وإغلاقها؛ لا قتل عبر المنفذ ولا لمس عملية سابقة. يسجل الرصد عمر العملية لتجنب الخلط عند إعادة استعمالPID.

تُضبط TEMP/TMP/cache/profile علىD، وheap768 للطفل/worker وGOMAXPROCS=2. يُمرّر executablePath قائم صراحةً قبل عزلprofile؛ لا اعتماد على PLAYWRIGHT_BROWSERS_PATH بعد العزل ولاfallback أو تنزيل. يعاد استعمال helper البيئة المعتمد قراءةً دون تعديلCI59c9، لحذف DB/SMTP/payment environment. Viteoverlay يوجه cache إلى مجلد الجولة، لأن cacheconfig الأصلي يقع داخل node_modules المشترك للقراءة فقط. حد البداية C≥1GiB وRAMحرة≥3GiB.

globalTimeout=720s وعامل1/retry0/forbidOnly؛ مرجع التخطيط من جولة المنسق السابقة331s. الحالات16 تتضمن464زيارة شاشة. يُحفظ أول فشل ولا تعاد الجولة لمجرد فشلobserver؛ إصلاحfixture/types/launcher المثبت فقط ضمن النافذة.

## النتيجة الفعلية والأدلة

جذر الأدلة المحلي: `D:/CodexWorktrees/wave2-pos-visual-compat/tmp/coordination/pos-visual-compat`.

| الفحص | النتيجة | الزمن الكلي للعملية | الدليل |
| --- | --- | --- | --- |
| tsconfig.integration noEmit | exit0 | 0.433s | `runs/types-uM8O1F/completion.json` |
| قائمة الحالات16 | تطابقfile/title/project دون نقص/تكرار | 1.069s | `runs/list-4vWiOJ/verified.json` |
| browser16 | 16passed،zero skip/retry/flaky،464خطوة مكتملة | 279.267s | `runs/browser-24sOtC/verified.json` |

زمن Playwright داخل العملية278.179s. القائمة لا تشغل الحالات؛ ظهور skipped16 في JSON للقائمة مجرد جرد، بينما تقريرbrowser هو الذي يثبت skipped0. بقيت الأسماء الأربعة والمشروعات الأربعة وكل29خطوة كما هي، وتحقّق verifier من ترتيب الخطوات وعدم وجودstep.error، لا العدد وحده. لا فشل assertion أو readiness أو types، ولم تُحتج أي إعادة أو تعديل مصدر بعد بدء الجولة. اقتصرت stderr على تحذيرNO_COLOR/FORCE_COLOR غير الحاجب؛ السجل محفوظ كاملًا.

`prepared-pins.json` بصمةSHA256: `f5ae321fcbeec88e749d8f4468d66233d27b2b3b12f4996f4754ef870fdbb0c1`؛ يثبت232ملفًا والمصفوفة، ونسخة الملفات محفوظة في`prepared-source`. تقاريرcompletion الثلاثة تثبتsourceChanges=[]؛ HEAD قبل وبعد ظل371917a. حدّثت هذه الوثيقة وحدها بعد القبول لإضافة النتائج، وبقيت نسخة ما قبل التشغيل محفوظة، وملفاfixture/spec مطابقين للمصدر المقبول.

قبلbrowser: C3.709GiB/RAM4.732GiB والمنفذان خاليان. بدأrootPID31088 عند19:00:46Z، ثمfixturePID17276 وVitePID26068؛ stdout و`readiness.json` يثبتان الجاهزية المملوكة وهوية1/1 بلاcheckout. ملفات`owned-during.json` و`owned-after.json` تثبت انتهاء13عملية مرصودة معوقتإنشائها، ومنهاroot والخادمان وChromium؛ لم يُستخدم قتل خارجي. `observations/20260831T190536490806Z-after-browser.json` يثبت المنفذين3133/4183 بلاlistener وconnect10061≈2s وexclusivebind ناجح. حُررت ملكيةruntime/browser/المنافذ صراحةً للمنسق.

هذا قبول محلي للـfixture ومسار التنقل للعرض فقط عبر المتصفح الآلي. ليس اختبارDB أو خادمAPI حقيقي أو تسجيل/دفع/طباعة، ولا فحصًا تفاعليًا للاستضافة أو بديلًا عن بقية336. التغيير الدائم ثلاثة ملفات فقط؛ المشغّل والـoverlay والأدلة خارجGit.
