# تسليم W2 POS Context — مرشح قيد التحقق

الشجرة `D:/CodexWorktrees/wave2-pos-context`، الفرع `fix/wave2-pos-context`، الأساس المنشور `e3d6ba03aec8ceabd42428d67855fad2683968a6`. نجحت بوابة التوليد والاختبارات المركزة والأنواع محليًا ضمن `W2-POS-20260831-A`، ثم حُررت runtime للمنسق/QA. لم تُشغّل DB أو متصفح أو build، ولم تُنشر التغييرات أو تُدفع. تجهيزة البقالة شريحة منفصلة عن checkpoint المنتج المتحقق.

## النطاق والعقد

ربط N2 للفترة وexact-ID/options عند ملاك الموارد، وبوابة محلية لهوية user/company لقراءات POS. رأسا `X-POS-Expected-User-Id` و`X-POS-Expected-Company-Id` معًا يقارنان هوية الجلسة؛ لا ينشئان Actor. يُعاد authorize قبل/بعد القراءة مع مطابقة الهوية الملتقطة. `posContext` وصف HTTP خارج النتيجة المالية المخزنة؛ لا تغيير fingerprint أو original result.invoice.id أو N1 retention/idempotency.

في POS، الرأسـان مطلوبان. في قارئات الموارد المشتركة المحددة، غيابهما معًا يبقي السلوك القديم؛ نقص أحدهما أو تكراره أو قيمة غيرcanonical يرفض ولا يهبط لصيغة غير مقيدة. حارسا API وWeb يرفضان غير ASCII digits، والفراغات وline terminators، مع طول1..20 وأولرقم1..9 وحد unsigned64 نفسه.

بوابة الواجهة تثبت الهوية قبل marker وتحجب النتائج المتأخرة. `409/POS_CONTEXT_CHANGED` بعد marker يحفظ المحاولة في quarantine؛ ليس REJECTED أو إثبات عدم تنفيذ. العودة الصريحة للسياق الأصلي تتيح recovery قرائيًا مفوضًا فقط. UNKNOWN لا يُحرر، ولا force-clear أو financial replay بعد reload. هذه البوابة تقلل السياق القديم ولا تدعي إغلاق سباق لحظة POST وحدها.

## أثر التوافق عند الإطلاق

تبويب POS قديم لا يرسل الرأسين سيصبح مقيدًا مع backend الجديد، ويحتاج تحميل الواجهة الجديدة. لا يوجد fallback يقبل checkout غيرمقيد لأجل التوافق. القارئات المشتركة القديمة خارج POS، التي لا ترسل الرأسين معًا، تحتفظ بسلوكها السابق.

إذا حجز التبويب القديم marker قبل تلقي `400/POS_CONTEXT_REQUIRED` فلا يُحرر marker بسبب400، أو reload، أو غياب idempotency record. تحميل الواجهة الجديدة يحفظ المحاولة ويوفر التحقق الصريح والـrecovery في سياقها الأصلي؛ قد تظل UNKNOWN مقفلة إذا لم يوجد دليل خادمي نهائي صالح. لا يُسوَّق تحديث الواجهة باعتباره إثبات رفض أو وسيلة لتجاوز القفل.

يتطلب إطلاق هذه الشريحة تنسيق backend والواجهة وإعلام التبويبات القديمة بالحاجة لإعادة التحميل؛ لا إعادة قبول checkout دون scope ولا إسقاط الحراسة خلال ترقية تدريجية. يملك المنسق التجميع وبوابات التوافق والنشر، ولا يعد هذا المستند إذنًا له.

## التحقق الفعلي والأدلة المحلية

- نجحت483/483حالة في24ملفًا، بلاpending/todo/skips وبلاintegration. تشمل حراسة الرأسين والـreferenceID، النسخة0، exact-ID/options، هوية قارئاتaccounts/tax/catalog/customer/barcode، تبديلشركةبنفسsid، تبديلمستخدم، late responses وquarantine، ربطREJECTED+metadata وUNKNOWN/extra/missing/mismatched identity، وN1/idempotency الأصلية.
- تعديل تجهيزة الحالة المالية DB تم بعد إثبات أن الأمر المعلق السابق لم يعدلها، مع إبقاء فحوص ledger/stock/audit/archive والمفتاح وinvoice.id. لم تُشغّل DB الـ11+1 في W2.
- بصمة fixture قبل التعديل: `3F3E7E5D7D614BA99FE70E4FBC4DD4D2990DFE998AF8E904DA6017406C6B857A`؛ بعده: `23CE0B40A2C1A60668F76BA9955C00476462555208D6CB4358474904A62E1EBB`.
- diff: `tmp/coordination/resume-inspection-01/pos-integration-context.patch`؛ SHA256: `3CBB5BBDEAD746F0D614852DC9BFAF265EA126E15F4E6E2C88982FF9CB1ECE26`.
- العميل المعزول طابق manifest `569F946A3BCBC6EF8058D0245A76683275B4CB5D02BE1F0DCF5AC28F4F6D198F` وملفاته الـ21 قبل وبعد كل أمر، قراءةً فقط. لاsharedclient أوPrisma generate أوكتابةفيالاعتماديات.
- تجهيز التشغيل المحدد: `tmp/coordination/POS_VALIDATION_LAUNCHER_AR.md`. PowerShell معطل؛ CMD+Python -B لقراءات وتجهيز launcher. جلسات القراءة الست المعلقة السابقة أُغلقت، ولا تُصنف exits المقاطعة كفشل اختبار.

| الأمر | الجولة | exit | زمن child |
| --- | --- | --- | --- |
| generate | round01 | 0 | 1.359s |
| generated-check | round01 | 0 | 1.360s |
| focused | round04 | 0 | 16.937s |
| Web noEmit | round04 | 0 | 1.938s |
| API src+tests noEmit | round04 | 0 | 13.782s |

تُحفظ الأوامر الفعلية والموارد وenvD وPID المملوك وlogs/before/after داخل `tmp/coordination/validation/<round>/<action>/`. الملخص `validation/ACCEPTANCE_SUMMARY.json` SHA256 `A58B55019514812568D191AA5FBCD84ADE08FB276D7FF59BA6358D057F4F5960`. طوبقت647بصمةمصدر/تجهيز بعد آخرأمر؛ بصمتهاالمجمعة`9303B082659A91939FBB3850D33BC89ED5AAAF3252F372A9C597C1AB204BE78D`. التوليد وحده غيّرgenerated؛ الاختبارات والأنواع لم تغير المصدر.

بصمةgeneratedالحالي`06C165296BFFB6EC3419F20F0CF9CD0F7F55F0C6DDA48C1D7A57F3AA2A00A67E`،launcherالمستخدمبعدتصحيحCLI`AC623B95CE220192BAFC52DDC823358E50327A2764BB555165D5743A6FED7363`،config`2E93CAF9E851377B42DFF8E482B85A8A47EDA211046ABE88C1E5610A42EF4451`،APIoverlay`916914949E087CFE81C50FCB5DF8105F07EA764659B0E1E3B5A36574FF50BE20`.

## الإخفاقات المحفوظة والتصحيحات

لم تُطمسround01/02/03: أولfocusedرفضخيارVitest4غيرالمدعومminWorkersقبلتحميلحالات؛حُذفالخيارفقطمعmaxWorkers1/no-file-parallelism/retry0. round02كشف6إخفاقاتلنفسالسبب: قارئN1للنتيجةالمخزنةكانمرتبطًا بـHTTP201 الذيأصبحيتطلبposContext. بموافقةالمنسق تغيّرمرجعschemaفقطإلىcomponentالنتيجةالأصلية،معإبقاءprojection/u64/money/idempotency دونتغيير. الفشلالسادسلـcachedsame-key سببهvalidateSuccess→نفسالقارئ→false→IDEMPOTENCY_IN_PROGRESS.

أثبت `validation/original-result-component-proof.json` تطابقcomponentالمالي والمتداخل حرفيًا معالأساسقبلW2؛SHA`E53174443AF798992A25351F439BB2347EAE80625410C5B29B374878856C14C9`. الاختباريثبتأنcomponentيقبلالأصلوHTTP201يرفضغيابالهوية. round03نجحت483حالةثمكشفWebtypesنوعfixtureoptions={}؛صُححإلىPosRequestOptionsدونcastأوتخفيفtsconfig،ونجحتسلسلةround04.

## بوابات لم تُغلق

قبول المتصفح الحقيقي/التبويبين وDB/build حسب نافذة وتكليف المنسق. اختبارات fixtures أو types لا تعوّض قبول DB، ومحاكاة التبويبين ليست دليلًا على جلسات المتصفح/WebLocks الحقيقية. تكييف `tests/grocery-integration/selling-profile.spec.ts` والتحققمنهشريحةلاحقة؛لايُورثقبول15السابقلهذهالنسخة.
