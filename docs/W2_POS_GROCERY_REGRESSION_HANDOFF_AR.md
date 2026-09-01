# W2 POS — شريحة تحقق البقالة والتبويبين

## الأساس وحدود الملكية

المنتج المتحقق محفوظ محليًا في `af0b31adc0782b4245e4d70cc4c87d8d4f9b4316`، parent `e3d6ba03aec8ceabd42428d67855fad2683968a6`، 58 ملفًا. أدلة 483/483 وWeb/API types وOpenAPI generation/check موثقة في `docs/W2_POS_CONTEXT_HANDOFF_AR.md`. لا تستبدلها شريحة المتصفح، ولا ترث هذه الشريحة قبول15 من النسخة المنشورة.

ملفات هذه الشريحة:

- `tests/grocery-integration/selling-profile.spec.ts`: تكييف fixture وتفاعل حالتي AR/EN مع سياق N2 المنشور بالمرشح.
- `tests/grocery-integration/pos-context-tabs.spec.ts`: fixture HTTP/UI مستقل بأربع حالات لتبديل الشركة والمستخدم بين تبويبين.
- وثيقة التسليم هذه. جميع overlays والمشغّل والبصمات والسجلات مؤقتة تحت `tmp/coordination/grocery-validation` ولا تدخل commit المنتج.

لم تتغير PosPage أو App/Auth أو api العام أو N1 أو OpenAPI/generated أو CI أو schema. لا تداخل مع hunk N3 للإيصال المؤكد. أي عيب منتج جديد يتطلب الإبلاغ للمنسق قبل تعديل الملفات المجمدة.

## ما يبقى ثابتًا

حالتا AR/EN تراجعان الفترة حسب التاريخ والمراجع المحددة بهوياتها قبل البيع. بعد scanner/profile توجد مراجعة صريحة جديدة لأن pending lock يبطل المراجعة السابقة. فحوص `123.4500` و`2.000000` و`246.90` وbody المالي وCSRF والمفتاح UUIDv4 وcheckout الوحيد باقية. top-level posContext خاص بالنقل، ولا يضاف إلى body المالي. recovery POST قرائي بلا idempotency header.

تُثبت قراءات الاسترجاع الثلاث زمنيًا: remount يقرأ بعد نجاح هوية N2 وفق `PosPage.tsx:166`، ثم manual UNKNOWN، ثم manual CONFIRMED. لا يؤدي remount أوUNKNOWN إلى مالية أخرى، ويظل قفل السلة حتى النتيجة الأصلية. حالات محرر البيع الأربع وunknown-save بنفس key/body وread-only catalogue بقيت بسلوكها السابق.

دليل التبويبين يستخدم BrowserContext واحدًا وcookies مشتركة وUI الشركة/login الحقيقيين. company switch يبقي sid/CSRF؛ user login يغيرهما. named409 للشركة بعد marker يعني quarantine وحفظ المحاولة، ولا يصير REJECTED. العودة الصريحة للسياق الأصلي تسمح بالقراءة المفوضة فقط؛ UNKNOWN وreload لا يحرران المحاولة ولا يولدان POST ماليًا آخر. تأخر القراءة لا يعيد فتح latch.

المصادقة ونتائج الخادم في هذه الحالات fixtures HTTP؛ ليست دليلًا على محرك DB أو جلسات backend الحقيقية أو وجود أثر مالي. أدلة عزل الخادم/الهوية لها وحدات وHTTP مستقلة؛ القبول المالي الحقيقي يحتاج بوابته الصريحة.

## البوابة المقترحة

19 حالة: 7 navigation قائمة بلا تعديل، 8 selling-profile (منها AR/EN)، و4 cross-tab. `expected-cases.json` يثبت الأسماء المطلوبة. التسلسل بعد تخصيص المنسق: grocery noEmit types ثم Playwright list ثم Chromium19؛ worker1/retry0 وzero skips. لا يكفي مجموع19 بلا أسماء أو نتائج؛ كل حالة يلزم أن تمر مرة واحدة دون retry/expected failure/incomplete.

المتصفح القائم: `C:/Users/motas/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`. التشغيل headless بملف مؤقت علىD، دون تنزيل أو فتح profile المستخدم. المنافذ3165/4215 مقترحة وتنتظر تثبيت المنسق. يشغّل Python مقابض Node للـHTTP harness وVite source، ولا يستخدم API dist أو Prisma أو DB.

التفاصيل والأوامر والبيئة والمهل والإيصالات في `tmp/coordination/grocery-validation/README_AR.md`. C≥1GiB/RAM≥2.5GiB (3GiB للمتصفح)، heap768، cache/profile/logsD، compile cache معطل، لا env أسرار/DB/SMTP/payment موروثة. لا PowerShell أو npm/install أو build أو CI workflow أو push/deploy. لا يدعي الإيصال تنظيف descendants غير المتحقق منها؛ لا إيقاف إلا handles مملوكة مثبتة.

## التحقق الفعلي — 31 أغسطس 2026

شُغّلت الشريحة مرة واحدة تحت التخصيص `W2-POS-GROCERY-20260831-A` على3165/4215، بعد C/RAM preflight وقبل نقل النافذة إلىQA. لم يتغير أي مصدر أثناء الأوامر؛502 ملفًا مطابقة قبل/بعد. بقي المنتج وملفا الاختبار بلا تعديل بعد النجاح؛ التعديل اللاحق لهذه الوثيقة يسجل الأدلة فقط.

| البوابة | النتيجة |
| --- | --- |
| grocery noEmit types مع overlay الأصلي | exit0؛0.750s |
| Playwright list | الأسماء19 مطابقة، صفرskip؛exit0؛1.672s؛ليس تشغيلbrowser |
| Chromium19 | 19/19 PASS،كل اسم بنتيجةpassed واحدة،صفرretry/skip؛CLI exit0 |
| readiness | stdout منcallback listen الفعلي للـHTTP harness،وVite بعدawait server.listen،معPID المملوك وHTTP200 |
| خروج المشغّل الأول | exit2؛80.359s بسببprobe إغلاق غيرحاسم فقط،لا إخفاقاختبار أوtimeoutللأطفال |
| تشخيص الإغلاق المستقل | exit0؛IPv4/IPv6 GetExtendedTcpTable بلاLISTEN على3165/4215،ومقابضالأطفال خرجت وexclusivebind ناجح |

تفصيل exit2 محفوظ ولا يُحوّل إلىexit0: `connect_ex` بمهلة0.5s أعادWindows10035 رغم نجاحexclusivebind. تشخيص مستقل مُعلن بمهلة3s سجل10061 بعد2.062s/2.016s معexclusivebind؛ثم أكدTCPtableالقرائي غيابlisteners. لم يُعد المتصفح أوNode أوالاختبارات لأجلprobe،ولم تُغيّر مهلةالجولة السابقة أوإيصالها. لاادعاءلتنظيفdescendants غيرمتحقق؛الدليل هوخروجالمقابضالمملوكة وغيابlisteners علىالمنفذين.

الأمر الفعلي لكلaction هوPython المضمن مع `-B tmp/coordination/grocery-validation/run-grocery.py <types|list|browser> --round round01 --freeze freezes/runtime-01.json --api-port 3165 --web-port 4215 --execute --allocation W2-POS-GROCERY-20260831-A`. الأوامر الكاملة وpreflight وreadiness والـlogs والتقارير والأسماء تحت `tmp/coordination/grocery-validation/runs/round01`؛تشخيصاالإغلاق في `port-diagnostic-01` و`port-diagnostic-02`.

بصمات الأدلة:

- freeze الأول المحفوظ: `902A2DC46C9BACF2AC1760B67BD72BAA72CA97A3A4B90521DC515F1800AD623F`.
- freeze التنفيذ بعدتعديلتجهيزreadiness/portsAfter فقط: `4F9697EC2CE8910A08CFE48AD3FB08099874168EACFA13C3A10069A1BDDA9566`.
- `ACCEPTANCE_SUMMARY.json`: `5CD9742E90B01930A44C69647FF929C1C26B5324B169C51088485D34A3A0619E`.
- ملفاالاختبارالمشغلان: selling-profile `F8EBF63ED723ADABB2B7A16D809BC65FE062DD81DB97900A9E6A97180ADBFC21`؛pos-context-tabs `F150CC0BD96A9DB9365391ABA611C1004298385696E0221187204661A152DAA7`.
- TCPtable/exits proof: `786BC09B0E11105E5BBEEF061206763EFCEF9FDC2FE3A1D6B381F8F792C28662`.

فُتحت لقطتاAR/EN الفعليتان،والفاتورة/القبض/246.9000 واضحة،وفحصعدمoverflow مضمن. لا يشمل ذلك قبولًا بصريًا مطلقًا: الملاحظةP2 التالية باقية. حُررت نافذةruntime/browser صراحة بعد إثبات الخروج؛ لا عمليةاختبار أوخادم مملوك باقٍ،ولاDB/build/install/push/deploy.

## ملاحظة P2 ظاهرة ومحفوظة دون تعديل المنتج

لقطتا `grocery-checkout-ar.png` و`grocery-checkout-en.png` تعرضان رسالةتغيرالمستخدم/النشاط/الصلاحيات فوقCONFIRMED فياستردادطبيعي،رغم نجاحهويةالأصل. سببالمصدر محدد: `pos-scope-controller.ts:43` ينشرchecking،واشتراك`PosPage.tsx:174` ينفذ`cashier.setScope(null)` عندchecking/quarantined. بعدنجاحالفحص يقرأ`afterIdentity` في`PosPage.tsx:166` علامةUNKNOWN؛هذاالفرعلاينفذ`startCashierSale`الموجودفيelse:167. يبقىcashier.scopeKeyفارغًا،فتعرض`CashierContextPanel.tsx:26` نصscopeChanged. الحالةليستدليلتغيرسياقفعلي أوبيعفيشركةأخرى،ولا تفكUNKNOWN ولا تضيفPOST.

أُبلغالمنسق بالملاحظةوأبقاهاP2لتصحيحعرضمحدودلاحق معN3. لم تتغيرPosPage أوCashierContextPanel أوcontroller أوأيمنتج لمعالجتها،ولم تُعد19لأجلها. هذاالتسليم يتضمنالاختباراتالمجتازة وهذهالوثيقةفقط.
