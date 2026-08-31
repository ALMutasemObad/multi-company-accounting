# تسليم R3 — الرئيسية وطريق أول بيع

التاريخ: 2026-08-31. التنفيذ محلي في `D:/CodexWorktrees/grocery-first-run`،
الفرع `feat/grocery-first-run`، البداية `fb2fe59`. لا نشر أو Push أو PR أو دمج.

## النتيجة

- الرئيسية الموجودة تعرض دخولًا بارزًا للكاشير، واختصارات المخزون والمشتريات
  والمبيعات والقبض والتقارير وفق التنقل المعتمد. لم تُستبدل بدليل تجريبي منفصل.
- دليل مراجعة من ست مراحل: النشاط، الأصناف/الباركود/الأسعار، توريد المخزون،
  الصندوق، الكاشير، الفاتورة والقبض والنتائج. أول مرحلة مختارة هي أول مرحلة
  ذات إجراء مسموح، وليست أول مرحلة «غير مكتملة» مستنتجة من زيارة سابقة.
- كل مرحلة «تحتاج مراجعة». لا نسبة اكتمال ولا علامة إنجاز من الزيارة، ولا شهادة
  جاهزية من وجود سجل. الموديولات الأخرى تبقى في دليل الأنظمة العام.
- مقاسان محليان فقط: العناوين `20px` والنصوص/الأزرار `16px`، باستخدام PageHeader
  المشترك دون تغييره. لا عنوان ضخم أو خط زخرفي. أهداف لمس لا تقل عن 44px في الدليل.
- ترجمات عربية/إنجليزية/أردية/هندية، RTL/LTR، وصلاحيات تفصيلية لكل إجراء.

## الملكية والتغييرات

ملفات المنتج المملوكة: `SystemHomePage.tsx` و`RetailOnboardingGuide.tsx` و
`retail-onboarding-model.ts` و`retail-onboarding-read.ts` و
`retail-onboarding-home.css` وhome.* فقط في `i18n/locales/system-home-platform.ts`.
لم تتغير مفاتيح nav.* أو platform.* في القاموس.

لا تعديل مباشر في App/navigation أو Inventory/Treasury أو types/api/shared styles
أو قاعدة البيانات أو OpenAPI. لا اعتماديات جديدة أو install/ci/prune/update أو
Prisma generate. الاعتماديات المشتركة استُخدمت للقراءة فقط؛ TEMP/TMP والنتائج على D،
والكاش داخل `apps/web/node_modules/.vite-track-r3` و`.vitest-track-r3` المحليين.

## عقد الربط المطلوب من R0

النوع المصدر: `apps/web/src/retail-onboarding-model.ts`.

```ts
type RetailSetupTarget =
  | { view: "inventory"; section: "warehouses" | "units" | "items" | "balances" }
  | { view: "treasury"; section: "accounts" | "methods" }
  | {
      view: Exclude<View, "inventory" | "treasury" | "platform" | "platformSubscriptions">;
      section?: never;
    };

// SystemHomePage
onNavigate: (view: View) => void;
onOpenSetupTarget?: (target: RetailSetupTarget) => void;
```

1. إن وُجد callback، تُمرر إليه الأهداف ذات section فقط. باقي الأهداف تمر إلى
   `onNavigate(view)`. لا كتابة أو تغير إعداد من callback.
2. دون callback، تفتح الشاشة الحالية فقط ويظهر شرح لاختيار تبويبها يدويًا.
   لا hash مختلق مثل `#inventory/items`، ولا افتراض أن Inventory بدأ بتبويب items.
3. على R0 التحقق مجددًا من view/section والصلاحيات عند التركيب، وتصفير هدف التبويب
   عند تغير الشركة أو المستخدم/الأذونات. هذا الربط لا ينفذه R3 في App.
4. إجراء `sellingProfile` هدفه `{ view: "inventory", section: "items" }`:
   صلاحية صفحة المخزون (`warehouses.view` وموديول INVENTORY)، مع
   `inventory_catalog.view` و`sales_catalog.view` وموديول SALES. النص يوجه إلى
   «إعداد البيع» داخل صف الصنف. لا محرر أو endpoint أسعار بديل في الرئيسية.
5. باركود الصنف يتطلب صفحة المخزون + `inventory_catalog.view` +
   `inventory_barcodes.view`. الأرصدة تتطلب الصفحة + صلاحيات الكتالوج والحركات،
   لأنها مطلوبة لقراءات صفحة الأرصدة الموجودة.
6. فتح الكاشير كفعل بيع يتطلب `pos.view` و`pos.checkout` وموديول POS؛ صاحب
   `pos.view` وحده يرى «مراجعة مبيعات نقطة البيع». الإنفاذ الحاكم يبقى بالخادم.

اعتمد R0 العقد واستورد R3، بطلب صريح منه، commit ربط الصلاحيات
`ff742eb6bac45d6bda38c9aaf6cbc9a0a9816466`؛ نسخته المحلية `e924127`.
هذا commit **ليس من تسليم R3 ولا يعاد cherry-pick له لدى المنسق**.
اختبارات الأسعار النهائية تستعمل effectivePermissionSet الحقيقي بعد هذا الربط؛
لا تغيير في raw permissions أو تجاوز للـAuthorizationProvider في المنتج.

## القراءة وحدود دلالتها

الفحص اختياري صريح بزر «فحص البيانات المتاحة»، وليس عند فتح الصفحة. كل قراءة GET،
صفحة واحدة بسجل واحد، ومهلة 10 ثوانٍ بلا retry تلقائي. لا أسماء أو مبالغ أو سجلات
كاملة في الحالة المحلية؛ يحتفظ الدليل فقط بحالة الدليل المحدود.

| الحقيقة | endpoint/مرشح | الإذن + الموديول | ما لا تثبته |
|---|---|---|---|
| مستودع نشط | `/warehouses?active=true` | warehouses.view + INVENTORY | أنه مستودع البيع المختار |
| وحدة نشطة | `/units-of-measure?active=true` | inventory_catalog.view + INVENTORY | توافق وحدة كل صنف |
| صنف نشط | `/inventory-items?active=true` | inventory_catalog.view + INVENTORY | الباركود/السعر/حساب الإيراد/الضريبة |
| رصيد غير صفري | `/inventory-balances?nonZero=true` | inventory_movements.view + INVENTORY | كفاية المخزون أو صحة تقييمه |
| صندوق نقدي نشط | `/cash-bank-accounts?active=true&type=CASH` | cash_bank_accounts.view + TREASURY | توافق العملة والطريقة والحساب مع البيع |

كل طلب يضيف `page=1&pageSize=1`. لا طلب على صفحة أو موديول محجوب، ولا N+1 للباركود
أو الأسعار. غياب الإذن = مراجعة مخوّلة، وفشل الطلب/شكله = تعذر التحقق؛ لا يحوّلان
إلى صفر أو «مكتمل». تحقق الشكل يشمل meta واتساق empty/total ونشاط السجل ونوع
الصندوق وكمية نصية غير صفرية. لا Float أو جمع أموال.

التفويض من AuthorizationProvider الحالي؛ companyId من الجلسة في API الموجود،
لا من حقل جديد يثق به الخادم. يعاد تركيب الدليل بمفتاح user/company/modules/
permissions، وتلغى القراءات عند تغيره أو مغادرة الصفحة. لا نتيجة قديمة تظهر تحت
شركة أو مستخدم آخر، ولا localStorage لنتائج الفحص أو إعدادات مالية.

إعداد النشاط والفترة والعملة والضريبة والعميل والباركود والأسعار ونتيجة البيع
تبقى مراجعة صريحة. ليس لدى الدليل عقد readiness شامل ولا يبحث في بيانات غير
مسموحة لاستنتاجها.

## قبل/بعد — قياس خطوات محدد لا ادعاء سرعة

القياس هو عدد النقرات للوصول إلى الشاشة/التبويب ابتداءً من الرئيسية، ولا يشمل
الكتابة أو العودة للرئيسية أو ترحيل المستند. المسار المباشر يحتفظ بالدليل السابق؛
المسار الموجّه يضيف قراءة المرحلة. لم تُقَس مدة أول بيع حقيقي أو مجموع حقوله هنا
لأن R1/R2 وتركيب R0 والبيانات والأجهزة خارج هذه النسخة.

| نقطة الوصول | قبل، من الدليل القديم | بعد، اختصار/دليل مباشر | بعد، عبر المرحلة مع fallback الحالي |
|---|---:|---:|---:|
| إعدادات النشاط | 1 | 1 | 1 (مرحلة البداية) |
| تبويب الأصناف | 2 | 2 | 3 |
| فاتورة توريد/شراء | 1 | 1 | 2 |
| تبويب الأرصدة | 2 | 2 | 3 |
| الخزينة/الصندوق | 1 | 1 | 2 |
| الكاشير | 1 | 1 (زر بارز أعلى الصفحة) | 2 |
| فاتورة المبيعات بعد البيع | 1 | 1 | 2 |

التحسين المثبت هو وضوح ترتيب العمل، وشرح المتطلبات والحدود، وتقريب الأعمال اليومية
إلى الأعلى، لا ادعاء خفض عدد كل النقرات. بعد توصيل R0 للـsection، ينخفض الوصول
الموجّه للأصناف/الأرصدة من 3 إلى 2؛ callback نفسه اختُبر، أما فتح التبويب الإنتاجي
عبر App فيظل بوابة تجميع لدى R0. إعداد البيع والباركود يتطلبان بعد الوصول اختيار
الصنف وأمره، ولا يسقط الدليل هذه المراجعة.

## الاختبارات والأدلة

- Playwright **32/32** بعد ربط الصلاحيات: 30 اختبار R3 + 2 اختبار regression
  قائمين للرئيسية والمنصة، دون تعديل ملفهما.
- المصفوفة ar/en/ur/hi × 390/768/1440 تثبت الاتجاه، عدم التجاوز الأفقي، مقاسي
  الخط 16/20، الأزرار، الترجمة، وجود إعداد البيع للمخوّل، والتنقل بلوحة المفاتيح.
- أدوار POS-read-only، غياب كل صلاحية لازمة للأسعار، حجب موديول رغم صلاحيات
  قديمة، لا شاشات متاحة، لا شركة، فراغ، 403/429/500، malformed، مهلة بلا replay،
  وتغير الشركة/المستخدم/الصلاحيات أثناء طلب معلق.
- callbacks/fallback لا ينشئان إعدادات أو مستندات؛ الرجوع من صفحة الأصناف يعيد
  الحالة إلى «لم يُفحص»، لا «مكتمل».
- حزمة الويب الكاملة بعد ربط R0: **128/128 في 17 ملفًا**، باستخدام worker واحد
  `--pool threads`. محاولة forks سابقة تعطلت في تهيئة عمال الاختبار؛ لم تُحسب
  نجاحًا رغم أن ملف JSON الجزئي قال success. إعادة threads انتهت exit 0 كاملة.
- typecheck المنتج واختبارات Playwright وfixture، وi18n/UI، وcontracts:check،
  وبناء Vite محلي. بوابة UI بقيت 27 PageHeader و67 منطقة جدول؛ العقود دون تغيير
  (167 request bodies و2101 response bodies).
- مهارة المتصفح استُخدمت لفحص المكوّن الحقيقي في fixture معزول مرئي التسمية،
  ولقطتا التطبيق الكامل تحت `tmp/agent/track-r3-results` فقط؛ لا video أو trace.
  fixture لا يدخل بناء الإنتاج، ويمنع طلبات الكتابة ويستخدم بيانات صناعية فقط.

### إعادة التشغيل

استخدم Node runtime المزوّد، ولا تثبّت أو تولّد اعتماديات. من جذر النسخة على D:

```powershell
$env:TEMP = 'D:\CodexWorktrees\grocery-first-run\tmp\agent'
$env:TMP = $env:TEMP
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --pretty false
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.track-r3.json --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.track-r3.json --pretty false
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node scripts/generate-openapi-guards.mjs --check
node node_modules/@playwright/test/cli.js test --config playwright.track-r3.config.ts
```

ومن `apps/web` مع TEMP/TMP نفسيهما:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.track-r3.config.ts --configLoader runner
node ../../node_modules/vitest/vitest.mjs run --config vite.track-r3.config.ts --configLoader runner --maxWorkers 1 --pool threads
node ../../node_modules/vite/bin/vite.js build --config vite.track-r3.config.ts --configLoader runner
```

منفذ الويب 4192 strictPort وreuseExistingServer=false؛ 3142 محجوز لـAPI R3 ولم
نشغّل قاعدة بيانات عليه. الاختبارات تعترض HTTP ببيانات صناعية؛ ليست رحلة بيع
حقيقية على قاعدة البيانات. يجب إغلاق خادم preview اليدوي قبل حزمة Playwright.

## Barcode Impact وبوابات الإطلاق

الأثر هنا توجيه المستخدم إلى إدارة باركود Inventory القائمة وإبقاء المراجعة
صريحة. لا إدخال/اختيار صنف في مستند جديد، ولا parser أو lookup أو توليد/طباعة
موازٍ. باركود الصنف ملك Inventory، وسعر البيع ملك Sales. لا يدعي الفحص تغطية
باركودات الكتالوج ولا سلامة leading zeros من مجرد وجود صنف.

قبل إطلاق أول عميل، على R0 تجميع R1/R2 والـsection callback، واختبار بيع ذري
حقيقي ومستنداته ومخزونه وقبضه، والعزل وIdempotency وبوابتي MariaDB 10.11 وMySQL
8.4 والترقية والرجوع. لا تزال تجربة قارئ USB/Bluetooth والطابعة والمسح من المخرج
بوابات أجهزة فعلية. لا موافقة إطلاق من نتائج UI أو fixture أو تقرير هذا المسار.

لا فروع أو محطات أو ورديات أو Offline أو lot/expiry أو مطاعم/صيدليات ضمن R3.
لا ملكية مجال جديدة، لا Prisma/Posting/Outbox تغييرات، ولا إنشاء بيانات تأسيسية
ضمنيًا. لا توقف بوابات المعمارية أو الإصدار، ولا تحصيل أو رسائل أو استضافة حقيقية.

## commits التسليم

1. `116e845` — المنتج: الرئيسية والدليل والقراءات والترجمات.
2. `a279f42` — الاختبارات والعزل وبيئة الفحص المحلية.
3. commit هذه الوثيقة — اختبار ربط الصلاحيات الفعلي، فحص الأسعار والـregression،
   وتثبيت worker threads وtypecheck الخاص بالـfixture.

استبعد `e924127` من النقل لأنه نسخة commit R0 `ff742eb` الموجودة لديه أصلًا.
