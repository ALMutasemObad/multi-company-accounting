# W1-QA-FIXES — تسليم مرشح D1/D2

## الحالة والحدود

- النسخة الوحيدة: `D:/CodexWorktrees/wave1-subscription-acceptance`، الفرع `test/wave1-subscription-acceptance`.
- الأساس وHEAD دون تغيير: `c7ffc99306a180387bb1a618d0d2750f762bf48b`، ويحتوي دمج S1/S2 المحلي `611691f`.
- هذا **مرشح كود غير مختبر بعد**. منذ تجميد الموارد لم يُشغّل اختبار أو typecheck أو build أو متصفح، ولم يُنشأ commit.
- لا push أو PR أو merge أو deploy، ولا DB أو تسجيل أو بريد أو دفع حقيقي. جميع حالات المتصفح المكتوبة تعتمد fixtures محلية.
- لم نغيّر `App.tsx` أو OpenAPI أو بيانات تجارية أو CSS أو وثائق الحالة العامة. لا تعديل لحقوق الشركة أو الصلاحيات أو CSRF أو عقد الدفع أو idempotency أو optimistic version.
- انتهى خادما هذه المهمة (PID 13720 و12392)، وتأكد خلو 3166/4216 بعد الجولة الأولى. أُبلغ المنسق وتحررت ملكية المتصفح والخوادم؛ لم نبدأ جلسة جديدة بعدها.

## الفصل عن قبول الجولة الأولى

وثيقة القبول الأصلية: `docs/W1_SUBSCRIPTION_ACCEPTANCE_HANDOFF_AR.md`.
جذر أدلتها: `tmp/coordination/subscription-acceptance/`، وفيه `run1-source/` و`evidence-manifest.json` و`e2e-results.json` والسجلات والصور الأصلية.

حزمة القبول المحفوظة: `tmp/coordination/subscription-acceptance/wave1-subscription-acceptance.patch`.
SHA256 الثابت لها:
`BA609A44D84E7D05A2B1326CAB83182911EA9F39DE0201F3343B0640DC0419DC`.
لا يُعاد توليد هذه الحزمة ولا تُعدّل مصادر/نتائج الجولة الأولى لإظهار نجاح لم يحدث.

الجولة الأولى وحدها: **18 ناجحًا و8 فاشلة من26، دون retry أو skip**؛ اثنان D1/D2، وستة عيوب harness صُححت لاحقًا دون rerun. D3 توقف قبل خطوة الإثبات بسبب selector، فلا يُعد دليل تسرب. نتائج 138 وحدة والأنواع والحراس والبناء السابقة تخص المصدر السابق؛ لا تثبت هذا المرشح ولا تشكل قبولًا نهائيًا من المنسق.

## الملفات المخصصة للإصلاح

| الملف | التغيير |
|---|---|
| `apps/web/src/CompanySubscriptionPage.tsx` | متابعة نية URL وإبطال المراجعة وحراسة التأكيد مع حماية المحاولة القائمة |
| `apps/web/src/subscription-route-intent.ts` | قراءة نية `plan` الصريحة للمسار فقط؛ helper صغير بلا طلبات أو صلاحيات |
| `apps/web/src/subscription-route-intent.test.ts` | 10 حالات وحدة مكتوبة |
| `apps/web/src/main.tsx` | قراءة locale آمنة وتمرير اللغة التي حُمّل قاموسها إلى provider |
| `apps/web/src/i18n/react.tsx` | قراءة/كتابة locale آمنة مع استمرار التغيير في الذاكرة |
| `apps/web/src/safe-local-storage.ts` | catch محصور في getter وgetItem/setItem فقط |
| `apps/web/src/safe-local-storage.test.tsx` | 11 حالة وحدة مكتوبة، تشمل SSR للـprovider |
| `tests/subscription-discovery/wave1/qa-fixes.spec.ts` | 11 حالة متصفح مكتوبة للتحولات والحماية وفشل التخزين |
| `tests/subscription-discovery/wave1/qa-fixes-vitest.config.mjs` | إضافة الوحدات الجديدة إلى القائمة المركزة السابقة |
| `tests/subscription-discovery/wave1/qa-fixes-vite.config.mjs` | cache/build منفصلان داخل D |
| `tests/subscription-discovery/wave1/qa-fixes-playwright.config.ts` | تقارير وصور منفصلة، العامل واحد، لا reuse لخادم موجود |
| `docs/W1_QA_FIXES_HANDOFF_AR.md` | هذه الوثيقة الخاصة بالإصلاح |

حزمة الإصلاح: `tmp/coordination/w1-qa-fixes/wave1-qa-fixes.patch`.
جرد المصادر والبصمات: `tmp/coordination/w1-qa-fixes/source-manifest.json`.
الحزمة تشمل الملفات أعلاه فقط، ولا تشمل تغييرات قبول الجولة الأولى. إعدادات الاختبار الجديدة تعتمد harness الموجود في حزمة القبول؛ ليست بديلًا عنها. لا توجد أدلة تشغيل للإصلاح حتى الآن.

## D1 — السلوك المقصود من المصدر

1. متابعة `hashchange` و`popstate` دون إضافة remount. لم نغيّر مفتاح العزل القائم بحسب المستخدم/الشركة/تفويض الإدارة.
2. عند تغير النية بلا محاولة محمية، تُبطل review وack والاختيارات الاختيارية فور الحدث، وتُمسح مراجع الاختيار تزامنيًا. لا ننتظر وصول catalog كي نحرس المراجعة القديمة.
3. يتأكد `confirm` من نية URL الحية ومن revision المراجعة قبل إنشاء محاولة جديدة؛ يحرس حتى النقرة الواقعة في المهمة نفسها بعد تعديل hash وقبل تسليم الحدث أو تحديث React.
4. تبقى الأهلية من صفحة catalog الموثقة الفعلية فقط. إن كانت القراءة جارية تُحفظ أحدث نية فقط حتى الرد الصالح؛ حراسة requestId/abort القائمة ترفض الرد المتأخر من قراءة منتهية أو نطاق سابق.
5. الخطة المفقودة لا تتحول إلى أول خطة ولا تستعاد تلقائيًا بمجرد الانتقال إلى صفحة catalog أخرى. مسح `plan` أو فساده أو تكراره يترك الاختيار فارغًا، ويمسح تفضيل التخزين القديم كي لا يعيده الرجوع إلى الصفحة. لا يتحول غياب النية إلى اختيار أول خطة؛ يلزم اختيار صريح.
6. عندما يوجد `command` أو `record`، يُستهلك حدث الرابط دون استبدال الاختيار أو المراجعة الموثقة أو record، ودون إنشاء نية مؤجلة. يُمسح التفضيل الذي قد يكون EntryPage حفظه لهذا الرابط. إعادة المحاولة uncertain تستخدم body/key/review نفسها، ولا تمر بحارس إنشاء محاولة مختلفة.
7. بعد النجاح يستمر سلوك إزالة `plan` القائم، ويُزامن معه مفتاح النية المرصودة؛ اختيار رابط جديد لاحقًا لا يُهمل باعتباره الرابط الذي وصل أثناء الإرسال.
8. لم نضف POST تلقائيًا أو خطة بديلة أو رسالة خطأ مالي. لا تعديل لمبلغ أو Decimal أو version أو مفاتيح idempotency.

المثبت في الجولة الأولى قبل الإصلاح: افتح `/#subscription?plan=2101` بكتالوج fixture يحوي 2101 و2102، ثم انتقل داخل الوثيقة إلى `/#subscription?plan=2102`؛ بقي select عند2101. الاختبار الأصلي:
`W1-D1: changing the subscription plan URL must update the displayed review choice`.
دليله: `tmp/coordination/subscription-acceptance/e2e/wave1-defects-W1-D1-changi-7e24d-the-displayed-review-choice/`.
الموضع المسؤول كان تهيئة الاختيار لمرة واحدة داخل `applyCatalog` في `CompanySubscriptionPage.tsx`.

## D2 — السلوك المقصود من المصدر

`readLocalStorageItem` و`writeLocalStorageItem` يحميان الوصول إلى `window.localStorage` نفسه وكذلك العملية عليه. الاستثناء يعني تفضيلًا غير متاح؛ لا نسجل قيمة التخزين أو تفاصيله.

يتبع bootstrap اللغة الافتراضية القائمة `ar` عند تعذر القراءة. يحمّل القاموس خارج catch التخزين، ثم يمرر اللغة المحمّلة إلى provider. إذا فشل قاموس اللغة المختارة، يبقى fallback العربي وسجل `initial_locale_dictionary_load_failed` القائمان؛ فشل حفظ fallback لا يعيد اللغة القديمة غير المحمّلة من التخزين.

يحمّل provider قاموس اللغة المطلوبة أولًا، ثم يحاول حفظ الاختيار ويحدّث حالته في الذاكرة حتى مع رفض الكتابة. لم يوسّع catch التخزين ليشمل تحميل القاموس أو render؛ سجل `locale_dictionary_load_failed` وحراسة سباق طلبات اللغة باقيان.

المثبت قبل الإصلاح: احجب getter لكل من localStorage وsessionStorage في init script ثم افتح `/plans`؛ ظهر root فارغ وصفر بطاقات مع `application_bootstrap_failed`. الاختبار الأصلي:
`W1-D2: blocking localStorage and sessionStorage must still render public plans`.
دليله: `tmp/coordination/subscription-acceptance/e2e/wave1-defects-W1-D2-blocki-39a8e-t-still-render-public-plans/`.
المسؤول: القراءة غير المحمية في `main.tsx`، ثم getItem/setItem في `i18n/react.tsx`؛ لذلك إصلاح main وحده غير كافٍ.

## الاختبارات المكتوبة وحدودها

- D1: BIGINT نصي، فساد/تكرار/مسح plan، تفضيل قديم، catalog محدود، تغير اختيار ومراجعة وإقرار وإضافات، sending/uncertain ومحاولة ثابتة، استجابة catalog مؤجلة، الخروج/العودة، سباق confirmation قبل الحدث، وعدم تأجيل رابط أثناء الإرسال.
- D2: getter/getItem/setItem وغياب window، العربية الافتراضية واللغة المخزنة والـinitialLocale المحمّل؛ وحالات متصفح لتغيير ar/en في الذاكرة وفشل قاموس en مع رفض الكتابة واستمرار سجل الخطأ.
- 21 حالة وحدة جديدة، و11 حالة متصفح جديدة. العدد المتوقع عند دمج القوائم: **159 وحدة و37 متصفحًا**؛ هذه أعداد من المصدر وليست نتائج تشغيل أو collection مؤكدة.
- اختبارات provider الوحدة تستخدم SSR؛ لا تثبت تفاعل تبديل اللغة. اختبار التفاعل المكتوب في Playwright هو المطلوب عند النافذة.
- اختبار فشل القاموس يستخدم مسار Vite المحلي `src/i18n/locales/en.ts`؛ ليس دليل bundle إنتاج.
- اختبارات URL لا تعطي قبولًا جديدًا للرجوع/التقدم أو company/authorization أو D3؛ يعاد كامل الطقم المصحح ويكمل الفحص التفاعلي عند امتلاك النافذة.

## أوامر التحقق المقترحة — لا تُشغّل قبل نافذة المنسق

لا تستخدم `run.ps1` القديم لتسجيل جولة جديدة فوق أدلة القبول. من النسخة المحددة فقط، جهّز مخرجات هذه المرحلة:

```powershell
Set-Location -LiteralPath 'D:/CodexWorktrees/wave1-subscription-acceptance'
$qaRoot = 'D:/CodexWorktrees/wave1-subscription-acceptance/tmp/coordination/w1-qa-fixes'
New-Item -ItemType Directory -Force -Path "$qaRoot/temp", "$qaRoot/cache", "$qaRoot/logs" | Out-Null
$env:TEMP = "$qaRoot/temp"; $env:TMP = $env:TEMP
$env:npm_config_cache = "$qaRoot/cache"; $env:XDG_CACHE_HOME = "$qaRoot/cache"
$env:GOMAXPROCS = '2'; $env:GOMEMLIMIT = '1536MiB'; $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$qaNodeDir = 'C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
$env:PATH = "$qaNodeDir;$env:PATH"
```

تُنفذ الأوامر التالية **تتابعيًا** عند التخصيص، مع حفظ كل stdout/stderr وكود الخروج في ملف مستقل تحت `$qaRoot/logs`، ودون retry تلقائي. برنامج Node يقرأ من مساره القائم؛ لا تثبيت أو توليد اعتماديات:

```powershell
node node_modules/vitest/vitest.mjs run --config tests/subscription-discovery/wave1/qa-fixes-vitest.config.mjs --configLoader runner --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.subscription-discovery.json --pretty false
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node scripts/generate-openapi-guards.mjs --check
node node_modules/vite/bin/vite.js build --config tests/subscription-discovery/wave1/qa-fixes-vite.config.mjs --configLoader native
node node_modules/@playwright/test/cli.js test --config tests/subscription-discovery/wave1/qa-fixes-playwright.config.ts --workers=1
```

لا تبدأ حراس DB أو البوابات الشاملة ضمن هذه القائمة. API guards المركزة المكتوبة سابقًا غير مشغلة، وتُخصص منفصلة إذا أجازها المنسق. لا تشغل المتصفح أو تستعمل منافذ3166/4216 قبل إعادة تخصيص الملكية؛ ثم أغلق فقط العمليات التي تملكها. أعد Browser skill تفاعليًا بالعربية/الإنجليزية عند768/1024/1440 مع التمرير ولوحة المفاتيح، دون جلسة الاستضافة الحقيقية.

## V1/V2 — تخصيص بصري مقترح فقط

أكد المنسق V1/V2 من صور1024، **أولوية P1 بعد D1/D2**. لم نبدأ إصلاحهما.

| العيب | الدليل الأصلي تحت `tmp/coordination/subscription-acceptance/e2e/` | الملكية المقترحة |
|---|---|---|
| V1: Recorded allowance=100 تنقسم إلى10 ثم0 بالإنجليزية؛125 سليمة | `wave1-acceptance-en-1024-p-e587e-subscription-and-owner-home/subscription-missing.png` | `apps/web/src/subscription-usage.css`، قواعد `.subscription-usage-card dl > div` و`dd` وتوزيع الشبكة، الأسطر12 و18–20 و25 |
| V2: أزرار محاولات الدفع مقصوصة ومتداخلة مع الوقت بالعربية والإنجليزية | الصورة الإنجليزية السابقة و`wave1-acceptance-ar-1024-p-6fe77-subscription-and-owner-home/subscription-missing.png` | `apps/web/src/styles.css` ضمن `.subscription-billing-grid` و`.subscription-payment-list` فقط، الأسطر1455 و1461–1465 والاستجابة1538 |

مواضع العرض للقراءة فقط: `CompanySubscriptionUsagePanel.tsx:69` و`SubscriptionBillingCenter.tsx:71`؛ لا أطلب تعديلهما ابتداءً. لا تعديل عام لـ`.panel` أو `.button` أو overflow العام؛ قاعدة `.panel` عند1488 تفسّر القص لكنها ليست إذنًا بتغيير عالمي.

معيار الإصلاح اللاحق: الرقم لا يتجزأ، والأزرار تظهر كاملة داخل عرض البطاقة بلا تداخل، وليس مجرد رفع overflow. لا تصغير خط أو تغيير أحجام الخط الأساسية أو سلوك/صلاحيات الدفع. لا خط زخرفي قصير. يلزم دليل AR/EN768/1024/1440 على المصدر الجديد.

## D3 والقبول النهائي

D3 فرضية غير مثبتة، وليس إصلاحًا ضمن هذه الحزمة. يُعاد الاختبار المصحح بعد تخصيص النافذة قبل إسناد أي تعديل منتج له. راجع وثيقة القبول لجرد تناقضات CURRENT_STATE دون تعديل الوثيقة العامة هنا.

**لا قبول نهائي لـS1/S2، ولا ادعاء نجاح D1/D2 بعد التعديل، قبل التحقق من المصدر الجديد وإغلاق العيوب المثبتة واستكمال المصفوفة والتفاعل.**

## ملاحظة المراجعة المصدرية عند تجميد النسخة الأولى

وجد المراجع أن عودة `onPlanRouteChange` المبكرة عند تطابق المفتاح تسبق حارس record؛ قد يعيد EntryPage حفظ رابط متجاهل في حدث ثانٍ مطابق أو أثناء remount. تُحفظ هذه النسخة الأولى كما طلب المنسق، وتُعالج الملاحظة في revision منفصل مع اختبارات مكتوبة وبصمة مستقلة. لا تُعامل النسخة الأولى كمرشح خالٍ من هذه الملاحظة.
