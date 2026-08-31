# W1 — ربط استرجاع POS وحسم الرفض الأولي

التاريخ: 2026-08-31. المنسق: `01a05783-e720-7ed0-a107-4a372bd53202`.
نسخة العمل الوحيدة: `D:/CodexWorktrees/wave1-pos-recovery`، فرع
`fix/wave1-pos-recovery`، الأساس `c7ffc99306a180387bb1a618d0d2750f762bf48b`.

## الحالة الصادقة الحالية

نجح على revision03 توليد العقد وفحص تطابقه، وWeb noEmit، و247/247 اختبارًا
محدودًا، وAPI src+tests noEmit بالعميل المعزول. لا تعتبر هذه النتائج قبول DB
حقيقية أو متصفح أو build أو runtime/dist أو إطلاق. كل الكاش والسجلات والملفات
المؤقتة في `tmp/coordination` على D؛ لم تشغل هذه المهمة install أو ci أو Prisma generate.

لم يُشغّل أي DB أو خادم دائم أو متصفح من هذه المهمة، ولا يوجد push أو PR أو merge أو
deploy أو بريد أو دفع أو طباعة أو اتصال إنتاج. لم يُعدّل مصدر N1 أو نسخة C أو
ملفات مسار آخر.

## checkpoint بعد بوابات revision03

أذن المنسق checkpoint محليًا واحدًا، parent هو
`e3d68da62dc93b3a77913a725ee9ca655abfbb9c`، يشمل تنفيذ W1 وإصلاحي تجهيزات
الاختبار revision02/03. لا تعديل منتج أو schema لهذه الإصلاحات: أضيف
inventoryItemId وإثبات استدعاء checkout للـHTTP fixture، وحُمّل قاموس العربية
الحقيقي، وقُرئ OpenAPI عبر Vite raw، واستُخدم فرز ES2022 وSubmitEvent بلا cast.

| دليل المصدر الحالي | النتيجة | زمن الأمر |
|---|---|---:|
| OpenAPI generate/check | exit0/exit0، 170 request و2144 response | 3264/3417ms |
| Web noEmit | exit0 | 2006ms |
| focused unit/HTTP | 247/247، 14 ملفًا، صفر failed/skipped | 10509ms |
| API src+tests noEmit | exit0 بالعميل المعزول، مع root/include/NodeNext الأصلية | 18045ms |

الأدلة المفصلة: `tmp/coordination/runtime-round-03/RUNTIME_HANDOFF_AR.md`.
SHA256 لبيان الأدلة `runtime-evidence-manifest.json`:
`7B36902A1EEE64D1F949B75189434FFA5CDCBBCA488A05CADD3112902A499754`.
بيان المصدر وقت التشغيل D25C4150… يضم44 ملفًا؛ لم تتغير الشيفرة بعد الفحوص،
وتحديث checkpoint هذا توثيقي فقط. حُفظت أخطاء round01/02 وأدلتها دون استبدال.
العميل المعزول له21 ملفًا، manifest569F946A…، وطوبقت بصماته والمصدر قبل/بعد
كل مرحلة. `paths` يثبت الأنواع فقط، ولا يثبت تحميل runtime أو dist.
تفويض Git لا يشمل نشرًا أو تعديل CI؛ اقتراح تشغيل11 حالة DB في CI يبقى في tmp للمراجعة فقط.

## ancestry والاستيراد

`merge-base(c7ffc993,6d7f522)=39c1de87b45e481ccdfe66a18a33336d8f32b8f9`.
كان الفرق من المصدر خمسة commits تخص N1 فقط؛ استوردت محليًا دون إعادة S1/S2:

| المصدر | المحلي |
|---|---|
| 164e97b | 841b1ac |
| 5538a0f | 94a96d6 |
| 4c2d3a8 | c778949 |
| 5d2bc81 | e09e1c4 |
| 6d7f522 | e3d68da |

كان `HEAD=e3d68da` قبل التعديلات المحلية الجديدة. لا تكرر commit عند فشل C؛
يمكن تسليم patch محفوظ على D، ثم commit واحد صغير لكل جزء عند تحرير المساحة.

التسليم البديل عن commits الجديدة أثناء منع كتابة Git هو ملفان **بديلان**:

- `tmp/coordination/w1-pos-recovery-after-import.patch`: incremental من `e3d68da`،
  ويتطلب وجود استيراد N1 أعلاه.
- `tmp/coordination/w1-pos-recovery-from-base.patch`: combined من `c7ffc993`،
  ويشمل استيراد N1 مع كل تعديلات W1.

**لا تطبق الملفين معًا.** يحفظ `tmp/coordination/w1-pos-recovery-patches.json`
البصمات والقواعد وأعداد الملفات والملفات الجديدة المحددة. لا patch لتغييرات S1/S2
الموجودة أصلًا في الأساس. لا تتضمن الحزمة node_modules أو temp أو logs أو بيانات اعتماد.
فحص `apply --reverse --check` يفحص اتساق patch مع ملفات الشجرة الحالية دون تطبيقه؛
ليس بديلًا عن فحص تطبيقه على نسخة جمع نظيفة أو فحص الأنواع.

## العقد والملكية

- `POST /api/v1/pos/checkouts/recovery` بجسم strict هو `{attemptKey: UUIDv4}` فقط.
- المصدر الخادمي للهوية والشركة هو الجلسة؛ يجري تفويض فعلي قبل القراءة وبعدها
  باستخدام `pos.checkout` وCSRF وPOS. لا user أو company أو key في URL أو response.
- تملك Infrastructure البحث بالمفتاح الفريد الكامل وبصمة SHA256 للمفتاح؛ بصمة
  الجسم `requestFingerprint` مستقلة وتمنع إعادة استخدام المفتاح لطلب مختلف.
- النتائج: `CONFIRMED{result}` للإقرار الأصلي؛ و`REJECTED{rejection}` فقط لرفض
  نهائي versioned مولد وغير منتهٍ؛ وما عداه `UNKNOWN`. النتيجة المالية تاريخية
  وليست حالة المستند الحالية. الرابط هو `result.invoice.id` وليس accountingDocumentId.
- الاحتفاظ 24 ساعة، بلا مدد جديدة أو migration. لا قراءة لقوائم حديثة لتخمين الأصل.
- لا يملك POS بنودًا أو Ledger؛ البيع الحالي ينفذ عبر Sales وTreasury وInventory
  وPosting في معاملة ACID نفسها. لا كتابة جديدة لحقائق سياق آخر، ولا Network I/O
  داخل transaction.

## حل 422

الشرح الكامل في `architecture/POS_RECOVERY_N1_ADR_AR.md` (تعديل W1 المعتمد).
بعد خطأ مجال مسمى خرج من `work` بعد حجز المفتاح، تبدأ مرحلة تحكيم ثانية لدى
Infrastructure بالموعد النهائي الأول. الخطأ نفسه **مرشح فقط** حتى لو ابتُلِع
فشل rollback. تثبت عملية INSERT-only رفضًا versioned بالمفتاح الفريد الكامل،
أو تقرأ فائزًا؛ لا تستبدل نتيجة موجودة. نجاح المنافس يفوز بإقرار الأصل، بينما
لا تثبت حالات mismatch أو inProgress أو failure أو timeout الرفض.
لا يحوّل `resolveExisting` بيانات JSON للرفض إلى نتيجة نجاح؛ يفحص status وcode
وdecoder صراحة. تجري قراءة P2002 من snapshot جديدة، مع فحص deadline قبلها
وبعدها، ولا توجد إعادة للعمل المالي في المرحلة الثانية.

استجابة HTTP 422، حتى بالكود `POS_CHECKOUT_REJECTED`، لا تحرر العلامة؛ بل تدفع
قراءة recovery واحدة. نتيجة `REJECTED` الخادمية المثبتة وحدها تتيح «مراجعة
البيع» بإجراء صريح، مع Web Lock ومطابقة العلامة. تحافظ المراجعة على السلة
الموجودة، وبعد reload تبدأ سلة فارغة بوضوح. لا يوجد force-clear لحالة `UNKNOWN`.

## الملفات ونقاط الجمع

- `apps/api/src/platform/prisma-pos-recovery-query-adapter.ts`: قراءة النتيجة.
- `apps/api/src/platform/idempotent-command-executor.ts`: opt-in للرفض ذي المرحلتين.
  لم يتغير `transaction-executor.ts` العام.
- `apps/api/src/pos/{checkout-rejection,recovery-service,recovery-result,recovery-types,pos-service,pos-router}.ts`.
- `packages/contracts/openapi.yaml` و`apps/api/src/generated/openapi-request-guards.ts`:
  المصدر والحراس؛ أُعيد التوليد بعد توسيع `REJECTED` ضمن استثناء موارد ضيق من المنسق،
  ولم يُعدّل الملف المولد باليد.
- `apps/api/src/app.ts` و`server.ts`: تعديلات root محدودة أذن بها المنسق لـposRecovery
  فقط؛ لا تعديل لـcreate-company-provisioning أو App/navigation.
- `apps/web/src/PosPage.tsx` وملفات `pos-recovery-*` و`PosRecoveryPanel.tsx` وقاموسه:
  controller واحد، وUUIDv4، وmarker فقط في التخزين، وحراس ready وFIFO وprofile
  وscanner والهوية.
- `apps/api/tests/pos-recovery-http.test.ts`: HTTP حقيقي باستخدام AuthService
  وcapability policy وstorage fixture، بلا DB. أما `pos-recovery-finalization.test.ts`
  فيحتوي اختبارات وحدات للسباقات وrollback وdeadline.
- `apps/api/tests/pos-recovery-finalization.integration.test.ts`: اختبار DB لـInfrastructure
  يحوي 11 حالة مكتوبة بحواجز وتنافس على Idempotency مع sentinel اختباري؛ المعاملات
  ستكون حقيقية عند تشغيله مستقبلًا. محاكاة deadline تحرك ساعة المنفذ عند حد commit
  بلا sleep؛ ليست تعطيل نقل حقيقيًا. لا يمثل هذا الملف وحده قبول POS المالي.
- `apps/api/tests/pos.integration.test.ts`: المسار المالي القائم موسع لاسترجاع success/rejection
  وفحص عدم بقاء آثار Invoice وReceipt وJournal وStock وAudit وArchive.
- `pos-recovery-db-vitest.config.ts`: حارس صريح لقاعدة W1POS المحلية، وعامل واحد وكاش على D.

## سجل التوليد والتجميد السابق لـrevision03

نتائج N1 القديمة، 102/102 قبل التركيب، موثقة في تسليمها ولا تعد قبولًا للكود الحالي.
قبل أمر إيقاف الموارد، نجح `contracts:generate` للعقد الثنائي (170 request و2144 response)،
ونجح فحص Web TypeScript للربط الأساسي قبل `REJECTED` في 6.86 ثانية. كلا الدليلين
قديم بالنسبة للتغييرات اللاحقة؛ تلزم إعادتهما ولا يسجلان نجاحًا نهائيًا.

بعد ذلك منح المنسق استثناءً للتوليد وفحصه فقط، بحد Node heap قدره 512MiB:

| الفحص الحالي | النتيجة | الزمن |
|---|---|---|
| generate-openapi-guards.mjs | exit 0؛ 170 request و2144 response | 3264ms |
| generate-openapi-guards.mjs --check | exit 0؛ الملفات المولدة مطابقة، وتشمل REJECTED | 3417ms |

SHA256 للملف المولد:
`514043523D5E1AFDE989528DCF4743A4C351799D3BA81E62D5E8DB789475B718`.
السجلان `tmp/coordination/w1-openapi-generate.log` و`w1-openapi-check.log` على D.
استُخدم Node مباشرة مع تعطيل compile cache؛ انتهت العمليتان وحُررت النافذة.
نجاح التوليد وحده لا يثبت الأنواع أو صحة API أو التزامن. أغلقت لاحقًا فحوص
Web وunit/HTTP وAPI types بالنتائج الحالية أعلاه؛ تبقى DB والمتصفح والبناء معلقة.

أوامر الفحص من جذر D، بلا install أو Prisma generate، وبعد تنسيق المنسق فقط.
يتطلب overlay أدناه عميل Prisma المعزول وبصمته المعتمدة، ولا يعاد توليده داخل الاعتماديات:

```powershell
$env:TEMP='D:/CodexWorktrees/wave1-pos-recovery/tmp/coordination/temp'
$env:TMP=$env:TEMP
$env:GOMAXPROCS='2'
$env:GOMEMLIMIT='1536MiB'
$env:NODE_COMPILE_CACHE=$null
$env:NODE_DISABLE_COMPILE_CACHE='1'
$env:npm_config_cache='D:/CodexWorktrees/wave1-pos-recovery/tmp/coordination/npm-cache'
$taskNode='C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $taskNode --max-old-space-size=512 scripts/generate-openapi-guards.mjs
& $taskNode --max-old-space-size=512 scripts/generate-openapi-guards.mjs --check
& $taskNode node_modules/typescript/bin/tsc -p tmp/coordination/n1-api-src-tests-types-isolated-client.json --noEmit
& $taskNode node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
& $taskNode node_modules/vitest/vitest.mjs run --config pos-recovery-vitest.config.ts --configLoader runner --reporter=json --outputFile=tmp/coordination/pos-recovery-tests.json
```

لا تبدأ اختبارات DB إلا بنافذة حصرية من المنسق وقاعدة جديدة محلية معزولة اسمها
W1POS، مع مطابقة العميل المشترك المولد للمخطط. يشترط حارس القاعدة localhost،
و`POS_RECOVERY_TEST_DATABASE` مطابقًا للاسم، و`RUN_DB_TESTS=true`، و
`RUN_POS_RECOVERY_FINALIZATION_DB_TESTS=true`. لا تضع URL أو بيانات اعتماد القاعدة في التسليم.

```powershell
& $taskNode node_modules/vitest/vitest.mjs run --config pos-recovery-db-vitest.config.ts --configLoader runner --reporter=json --outputFile=tmp/coordination/pos-recovery-db-tests.json
```

بوابة MariaDB 10.11 وMySQL 8.4، وفحوص Redocly وarchitecture وroutes وcontracts،
والبناء على D، والقبول المرئي بأربع لغات، والتبويبان وWeb Locks الحقيقي، ومقاسات
390/768/1440: كلها لا تزال غير مثبتة. حررت W1-QA ملكية المتصفح، لكنه ما زال مجمد
التشغيل بأمر الموارد، ولم نستخدمه.
اختبارات SSR أو hook harness لا تساوي اختبار DOM أو متصفح.

## Barcode Impact والتفعيل والحدود

لا يوجد parser أو lookup للباركود أو تسعير أو طباعة جديدة. نستخدم
InventoryBarcodeScanner وFIFO القائمين، ونحجب المسح وتعديل السلة والسياق ما دامت
النتيجة غير محسومة، وننتظر profile وFIFO قبل البيع أو تحرير العلامة. لم يُختبر
HID أو كاميرا أو طابعة أو درج نقد فعليًا.

يمنع تشغيل backend قديم بالتوازي قبل إنشاء tombstones؛ يلزم تصريف الطلبات وإيقاف
الجيل القديم كاملًا، ثم cutover للقارئ والكاتب المتوافقين. يتجاهل backend القديم
`responseStatus` وقد يعيد JSON الرفض كأنه 201. لا rollback إليه مع بقاء tombstones،
ولا حذفها كحل. يلزم إغلاق تبويبات UI القديمة التي لا تشارك Web Locks قبل الإتاحة.
هذه بوابة نشر لدى المنسق، وليست عملًا منفذًا.

لا ضمان بعد 24 ساعة أو حذف storage أو تلفه أو فقد الجهاز. وقد يبقى الفقد قبل
إرسال الطلب، بعد حفظ marker، في حالة `UNKNOWN` إلى مراجعة خارج نطاق الشريحة.
لا تفترض أن غياب السجل دليل الإخفاق. لا تدخل N2 أو N3 أو Z1 أو Printing أو
Provisioning ضمن هذا التغيير.
