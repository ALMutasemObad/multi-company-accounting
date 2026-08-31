# W1-D3 — هوية شركة الاشتراك والمحاولة

التاريخ: 2026-08-31. النسخة: `D:/CodexWorktrees/wave1-subscription-acceptance`، الفرع `test/wave1-subscription-acceptance`، الأساس المحلي المحفوظ `0dd107ab8ea3718de863c22792390d0141c712b4`.

**مرشح مصدر غير مشغّل.** لم يحدث commit أو تشغيل Node أو اختبار أو generator أو DB أو متصفح أو build في هذه المرحلة. لا نشر أو push أو PR أو دمج إلى main. لم أستورد رأس فرع التنسيق أو generated من N1. بقي الملف المولّد القديم كما هو عمدًا إلى نافذة التوليد المأذونة.

## الدليل السابق وحدوده

الجولة الوحيدة على0dd: **43/44**، عامل1 وretry0، ومدة135.053ثانية. نجحت D1/D2 والهندسة الستة؛ فشل D3 عند عرض خطةB مع شارةA في تبويبين يشتركان في سياقfixture. لا يثبت ذلك تسرب DB أو تنفيذ أمر مالي فعلي.

الجولة مجمدة في `tmp/coordination/w1-acceptance-44/runs/20260831-162846-0dd107ab/`:

- `e2e-results.json`: `96CDE407A8666302C922639CFE88E6976B3CBEBE8AFD237072073093779DC090`.
- `evidence-manifest.json`،54ملفًا: `1D16249009F61A7A6CD3975FE9110D26FD252A85331EF7E0880CC8918B74A9DC`.
- التقرير المنفصل `POST_RUN_SUMMARY_AR.md`: `E1509C4B1D894AB1D4D755446D9E3DDA0C242EFAC1A6E6C2E07926F135F34347`.
- فشل `tests/subscription-discovery/wave1/defects.spec.ts`، الاختبار `W1-D3: tab A must reject company B subscription after tab B changes shared context`، عند assertion48. الصورة والسياق في `artifacts/wave1-defects-W1-D3-tab-A--f3b66-ab-B-changes-shared-context/`.

لا تُنسب نتائج165وحدة/الأنواع السابقة، أو43نجاحًا من الجولة44، إلى مصدرD3 الجديد. أدلةrun1 السابقة وحزم القبول وD1/D2v2 وCSS لم تُعدّل.

## التشخيص المصدري

`auth/prisma-auth-store.ts` يغيّر `selectedCompanyId` داخل الجلسة نفسها، بينما يستبقي كل تبويب لقطة التفويض والاسم داخل `App.tsx`. كل طلب مفوّض يقرأ الشركة الحالية من الجلسة؛ لا يرسل `api.ts` شرط شركة مقصودة. كان `ownerCompany` يحذف `company` من رده، وكان فحص الواجهة يقبل غيابها، فتُنسب بياناتB إلىA.

طلب تغيير الاشتراك السابق حمل الخطة والإضافات و`subscriptionVersion` فقط. يأخذ `requestOwnerChange` شركةactor، ويقارن الإصدار داخلها. إذا كان المستخدم مخولًا فيB وكان الإصدار العددي مساويًا لإصدارA، فقد يعمل الطلب علىB. كذلك فضاءidempotency يحتوي الشركة؛ مفتاحA تحتB لا يسترجع سجلA. هذا استنتاج مصدر مشروط بتفويضB، وليس برهان تجاوز عضوية أو DB أو دفع.

المشكلة العامة أوسع من الصفحة: شارةApp، قوائم أخرى، وتنزيلات أو قراءات تعتمد الجلسة لا تُحل كلها بهذه الشريحة. الفوترة تقيّد UUID المورد بالشركة، وتتحقق بعض الردود منcompanyId، لكن ذلك ليس حارسًا عامًا لنية التبويب. **النطاق هنا هو لقطة اشتراك المالك وأمر تغيير اشتراكه فقط؛ لا App/Auth/api العام أو billing/provisioning/N1.**

## العقد والتغيير

1. تعيد `ownerCompany` هوية الشركة الفعلية من نفس سجل الاشتراك المقروء. أصبحت `company` إلزامية في `SubscriptionSnapshot` وOpenAPI؛ استجابة المشغّل تحتفظ بسلوكها السابق الذي كان يتضمن الشركة أصلًا. لا migration أو تغيير بيانات.
2. ترفض صفحة الاشتراك الرد الناقص أو المختلف قبل عرضه. يُفحص رد المالك عند وصوله، قبل جمعه مع الكتالوج؛ خطأ الكتالوج لا يبتلع mismatch مرصودًا. لا تُستبدل شارةA ولا تُعرض خطةB.
3. يحمل كلreview وattempt جديد `companyId` ثابتًا، ويحمل body `expectedCompanyId`. يثبت fingerprint الواجهة الشركة مع محتوى المراجعة؛ المال يبقى Decimal نصيًا كما كان.
4. يطلب `POST /subscription/change-requests` الحقل الإلزامي `expectedCompanyId` كسلسلة معرف موجب، ثم يحوّله الحارس إلىbigint. يفحصه الراوتر بعد المصادقة/CSRF/RBAC، وقبل استدعاء الخدمة؛ وتعيد الخدمة فحصه قبل `execute` أو حجزidempotency أو أي work.
5. الاختلاف يعيد `409` مع `code` و`reason` يساويان `SUBSCRIPTION_CONTEXT_MISMATCH`. لا يصبح الحقل مصدر صلاحية ولا يختار شركة بديلة، ولا يُضاف GETauth قبلPOST بوصفه حلًا للسباق.
6. **البصمة المالية الخادمية لم تتغير**: `targetPlanVersionId` و`optionalModuleIds` المرتبة و`subscriptionVersion` فقط. شرط النقل الجديد لا يدخلها، وتظل الشركة ضمن `{companyId,userId,operation,key}` فيidempotency. تغيير سياق الجلسة بعد التقاطactor لا يعيد توجيه العملية؛ الخدمة تستخدمactor الملتقط.

## قفل السياق وحفظ المحاولات

يبدأ حارس السياق مغلقًا عند كل تركيب للصفحة، ولا يفتحه إلا GETمالك ناجح ومفوّض يطابق الشركة الملتقطة مع اكتمال قراءة الكتالوج. عند mismatch يُغلق ref تزامنيًا، وتُبطل المراجعة غير المرسلة وإقرارها. يحجب التأكيد والإرسال وإعادة الإرسال، ولا يغيّر record قائمًا أو body أو key أو الشركة المقصودة. لا remount جديد أو انتقال تلقائي إلىB.

يحمل كلread رقم طلب ورقم ملاحظة سياق؛ لا يفتح GET متأخر بدأ قبل رفض أحدث القفل. كذلك لا تفتحه قراءة فاشلة بعد الخروج والعودة. بدءPOST العادي لا يعيد تصفير دليل السياق السابق، فتظل إعادة المحاولة المعتادة الصريحة ممكنة بعد خطأ نقل إذا لم يرصد mismatch.

عند رفضretry بسببالسياق يُستعاد record السابق نفسه بحالتهuncertain؛ الرفض تحتB لا يثبت هل التزمت المحاولة الأصلية فيA. لا يتحول الرمز إلىconflict/rejected يسمحان بتحرير المحاولة. تطابق GET جديد يفك قفل السياق فقط؛ لا يغيّر record/status/body/key ولا يعيدPOST. لا تكفي قراءة سجل أو غياب صف لإثبات مصيرمحاولة.

يبقى record مرئيًا مع تفاصيل مراجعته والتعافي حتى إذا فشلت أول قراءة بعد remount ولم توجدsnapshot. المحاولة القديمة التي لا تحمل شركة متسقة في attempt/review/body تظل محمية؛ لا نمنحها شركة مستنتجة منالشاشة ولا نعيد كتابةbody القديم. حتى GET مطابق لا يجيز إعادة إرسالها.

توضح ثلاثة نصوصAR/EN أن السياق لم يعد موثقًا، وأن المحاولة غير المحسومة لم تُلغ أو تُرفض نهائيًا، وأن المحاولة القديمة لا تُرقّع. تستخدمur/hi نصEN للمفاتيح الجديدة فقط للمحافظة على اكتمال عقد الترجمة؛ لم تتغير الخطوط أوCSS أو واجهةالدفع.

## الاختبارات المكتوبة والمراجعة

الأعداد هنا من قراءة تعريفات المصدر، لا من تشغيلrunner:

| الملف | التغطية الجديدة |
|---|---|
| `apps/api/tests/w1-subscription-context.test.ts` | 17حالةHTTP/service معauth/executor doubles بلاDB: Aقصدًا/Bجلسةً، نفسversion/key، رفضقبلservice/work/idempotency، bigintدقيق، missing/malformed، وRBAC. |
| `apps/api/tests/openapi-request-guards.test.ts` | حالةعقد واحدة لحقلowner الإلزامي ورفض القديم والمشوه والحقل الزائد؛ تعتمد على التوليد المؤجل. |
| `apps/web/src/subscription-change-safety.test.ts` | 17حالة جديدة لهوية دقيقة، legacy/mismatched body، منعPOST، حفظالبايتات والمفتاح، وتصنيفmismatch إلىuncertain. |
| `tests/subscription-discovery/wave1/d3-context.spec.ts` | 12سيناريوfixture: missing/different، review/error، سباقتأكيدالتبويبين، retryمرفوض، remount+GET503، owner mismatch+catalog failure، recorduncertain/succeeded، legacy، sending، وlateGET. |

حُدّثتfixturesالراوتر وخمس نداءاتالتكامل القائمة إلىexpectedCompanyId، وأضيف assertionلهويةownerCompany في اختبارالتكامل. **لم يُشغّل التكامل أوDB.** خادمfixture المحدود يطابق شكل GETالجديد، ويبقى رافضًا للكتابات التجارية؛ حالاتPOST فيPlaywright استجابات معترضة لاخادم مالي.

مراجعة مستقلة نصية وجدت مسار `uncertain → mismatch → remount → GETفاشل → retry` في المسودة. صُحح بجعل قفل كلmount مغلقًا حتىقراءةمطابقة، وأضيف انحداره. روجع أيضًا تحققهويةالمالك قبلجمعالكتالوج وحارسlateGET. لم يجد المراجع خللًا مؤثرًا آخر أو خطأharness/TypeScript واضحًا فيالمصدر، وهذا لا يعادل نجاحاختبار أوtypecheck.

## الحزمة وتسلسل التحقق المتبقي

الحزمة المنفصلة تحت `tmp/coordination/w1-d3-context/`: `wave1-d3-subscription-context.patch` و`source-manifest.json` و`source/` و`inspection.json`، مع `before-source/` و`before-manifest.json`. لا تتضمنpatchأيtmp/log/image/evidence أوgenerated معدل يدويًا. يثبتmanifestالملفات والبصمات؛ يسجلinspectionفحوصGit القرائية وبقاءالأدلةوالحراسالقديمة.

**الحارس المولّد ما زال قديمًا** وبصمته `1EAE8C6416774CABD5D3D73860B6F9C5124B4FDC6141E85F5A67C447118A82D4`. لذلك matchingPOST الجديد يرفضه حاليًاschemaالقديم بـ400 بعد اجتياز شرط السياق. لم نضف bypass أو نتظاهر بأن المرشح صالح للتشغيل قبلالتوليد. سيجمع المنسقOpenAPIموضعيًا على الرأس المشترك ويعيدتوليده؛ لا تُستبدل نسخةهذهالشجرة بملفN1 ولا تُنسخgenerated قديمة إلىالدمج.

بعد نافذةالتوليد المأذونة، ترتيبالتحقق المقترح:

1. `node scripts/generate-openapi-guards.mjs` على عقدالرأسالموحد، ثم `--check`؛ باستخدامNodeالقائم مباشرةً لاnpm ولاPrisma generate.
2. الوحداتالمركزةWeb بـconfig `tests/subscription-discovery/wave1/qa-fixes-vitest.config.mjs`، ثمAPIHTTP/service والعقد/الراوتر بالملفاتالمذكورة وبـconfigمحدود يكتبcacheعلىD. العددWeb المتوقع حسابيًا182 بعد165السابقة، وليسنتيجةمعلنة.
3. `tsc --noEmit -p apps/web/tsconfig.json` وAPI، معإدراجD3spec صراحةً فيفحصE2E؛ **`tsconfig.e2e.json` العام لا يشمل `tests/subscription-discovery/`**، فلايكفي اسمه لإثبات فحص هذاالملف.
4. جولةمتصفح جديدة تراجع44السابقة و12الجديدة (56متوقعًا منالمصدر)، بمجلدأدلةومشغّلجديدين. لا يُستخدمconfigrun1 بمخرجاته، ولا يُعدلmanifestالجولة44.
5. بوابةDB المعزولة والفحصالتفاعلي والبناء وفق تخصيص منفصل؛ لا يُنسب fixture إليها.

تطبق نافذةالتشغيل لاحقًا شروطالمنسق: عامل1/retry0، heap768MiB، TEMP/TMP/cache/logs/profile علىD، منافذ3166/4216 محلية بملكيةصريحة، بلاinstall أو shareddependencywrites. هذه قائمةعمل مستقبلية وليست إذنًا بالتشغيل.

ترحيلالعقد يفشل مغلقًا: clientقديم يحذفexpectedCompanyId فيرفضهserverجديد؛ clientجديد يضيفحقلًا غيرمعروف فيرفضهserverقديم صارم، كمايرفضclientجديد snapshotقديمة بلاcompany. لا يُعاد بناءattemptقديمة لإرضاءالعقدالجديد، ولا تُغيّر بصمةسجلidempotency محفوظ. إغلاقD3 النهائي ينتظرالتحقق بعدالتوليد؛ ليس قبولًا نهائيًا لـS1/S2 أو حلًا لكلسياقاتالتطبيق.
