# تسليم المسار C — استهلاك الاشتراك

الحالة: منفذ ومختبر محليًا في `project-track-subscription-usage`، فرع
`feat/subscription-usage-visibility`. لا Push أو PR أو Merge إلى main أو نشر.
يبقى ربط التشغيل في app/server والرحلة المجمعة وبوابتا قواعد البيانات عند المنسق.

## الالتزامات وطريقة الجمع

يلتقط المنسق commits المسار التالية بالترتيب، على أساس يحتوي عقده المركزي:

1. `0fb4f8a` — الخدمة وPorts والمحول وRouter واختبارات القراءة الأساسية.
2. `1d4b38a` — اللوحة والترجمات والاختيار الصريح وصفحات الكتالوج وتهيئة track-c.
3. `4cce689` — validator الاستجابة الفعلية وroute parity واختبارات fallback والعزل والفترة الجزئية.
4. `35cda99` — تثبيت الاختبارات البصرية ورفع specificity لمقاسي16/18.
5. التزام هذه الوثيقة النهائي (يذكر معرفه في رسالة التسليم).

لا تُلتقط `dda02aa` مرة أخرى؛ هو نسخة cherry-pick للعقد المركزي `b8dc7a1`
الموجود أصلًا لدى المنسق. لا تعاد تغييرات الأساس أو الصفحة العامة المنفذة.

## العقد والملكية

المالك Platform Subscriptions & Entitlements؛ اللوحة قناة قراءة فقط. لا جداول أو
migrations أو أحداث أو كتابات جديدة، ولا تغييرات Ledger أو الفواتير أو الموظفين
أو سياسة الأسعار. قُرئت AGENTS.md ومراجعها السبعة وعقد التنسيق ووثيقة الخطط العامة.

الملفات الجديدة الأساسية:

- `apps/api/src/platform-subscriptions/subscription-usage-{ports,service,plan-adapter,router}.ts`.
- `apps/api/src/composition/create-subscription-usage-service.ts`.
- `apps/web/src/CompanySubscriptionUsagePanel.tsx` و`subscription-usage.{ts,css,test.ts}`.
- ترجمة `apps/web/src/i18n/locales/subscription-usage.ts` للأربع لغات.
- `apps/api/tests/subscription-usage.test.ts` و`tests/visual/track-c-subscription-usage.spec.ts`.
- إعدادا `apps/web/vite.track-c.config.ts` و`playwright.track-c.config.ts`.

تعدل `CompanySubscriptionPage.tsx` فقط لربط اللوحة وتصحيح اختيار الكتالوج بتفويض
المنسق، و`openapi-route-parity.test.ts` لإضافة import/Router فقط بتفويضه اللاحق.
لم تُعدّل الخدمات أو المحولات القائمة أو `app.ts/server.ts` أو Prisma. استورد عقد
المنسق وحده، بتفويض محدد، من `b8dc7a1621fe20908f50ad43d62782cfdd17307d` وأصبح
محليًا `dda02aa`. لا يعاد جلب هذا العقد إلى التكامل عند جمع commits المسار C.

## تعريف القياس المثبت من المصدر

يعيد composition استخدام `PlatformAnalyticsQueryPort.companyUsage` نفسه الذي تستهلكه
الفوترة، عبر `SubscriptionUsageMeasurementPort` ضيق. لا تستورد خدمة الاشتراكات
محول Analytics الخرساني، ولا توجد عدادات موازية.

| العداد | تعريفه الحالي | دلالة الحصة |
|---|---|---|
| المستخدمون | عضويات الشركة `UserCompany.isActive=true` مع `User.isActive=true` | قياس لحظي، ليس زيارات أو دخولًا أثناء الشهر |
| الموظفون | موظفو الشركة بحالة `ACTIVE` أو `ON_LEAVE` | قياس لحظي، مع حساب مستخدم أو بدونه |
| المستندات | `AccountingDocument.postedAt >= startsAt && postedAt < endsAtExclusive` | إحصاء فترة فقط؛ مقارنة الحصة غير مؤكدة |

لا يوجد فلتر لحالة المستند الحالية؛ يبقى المعكوس محسوبًا إن احتُفظ بـpostedAt.
لا تحسب المسودة غير المرحلة. ولا يكشف DTO أسماء أشخاص أو بيانات شركة أخرى أو
العمليات أو أي قيمة مالية.

الفوترة الحالية في `issueInvoice` تقبل فترة يحددها المشغل، وتحول تاريخ البداية
إلى منتصف الليل UTC وتاريخ النهاية الشامل إلى اليوم التالي المستبعد. لا تحسب
دورة مستندات شهرية/سنوية تلقائيًا، ولا يوجد كاتب تشغيلي لحقلي currentPeriodStart/End.
لذلك اختيرت فترة إحصائية **من أول الشهر التقويمي UTC حتى وقت بدء القياس حصريًا**.
يُلتقط الوقت مرة واحدة ويطابق `measuredAt === period.endsAtExclusive`، حتى عند تغير
اليوم المحلي في الرياض. عند منتصف ليل أول الشهر تكون النافذة فارغة صحيحة.

السنوية والربع سنوية والشهرية مجرد دورة الخطة المعروضة؛ لا تضرب الحصص ولا تقسمها.
الخطة التجريبية لا تُنشئ فترة فاتورة من عدد أيام تجربتها. Legacy يحتفظ بالحصص null
كما هي؛ لا تُستعار حصص حساب الفوترة القديم ولا تعني null صفرًا أو غير محدود.
حتى وجود تاريخ بداية/نهاية كامل أو جزئي يعطي `UNCONFIRMED` لا تأكيدًا ماليًا؛
إذا غاب الحقلان فالحالة `NOT_CONFIGURED`.

الخطة هي أحدث تغيير `APPROVED` حيث `effectiveAt <= measuredAt` بترتيب
`effectiveAt DESC, id DESC`، وإلا إصدار الاشتراك الأساس. يُقيد التغيير بـcompanyId
وsubscriptionId، ولا تؤثر الطلبات المعلقة أو التغييرات المستقبلية. الاستعلامات
select ضيقة لا تحميل لتاريخ التغييرات أو الموديولات أو الشركة أو بيانات الأشخاص.

## دلالات المقارنة والواجهة

- `included=null`: الحالة `NOT_CONFIGURED`، والباقي/التجاوز null.
- `used=null` مع حصة معلومة: `UNKNOWN`، لا استبدال بصفر.
- مستخدمون/موظفون معلومون: `WITHIN_LIMIT/AT_LIMIT/EXCEEDED`، والباقي
  `max(0,included-used)` والتجاوز `max(0,used-included)`. الصفر حد حقيقي.
- المستندات دائمًا `UNCONFIRMED_PERIOD`، والحالة UNKNOWN أو NOT_CONFIGURED؛ لا
  باقي/تجاوز رقمي ولا شريط نسبة يوحي بمقارنة دورة غير مؤكدة.
- الأعداد صحيحة غير سالبة آمنة في JSON؛ تُحوّل قراءة غير آمنة إلى غير معروفة،
  ولا توجد حسابات أموال تحتاج Decimal أو مبالغ مستحقة مشتقة من العد.
- `BEST_EFFORT` واضح: الاستعلامات المتوازية ليست لقطة ACID، ووقت بدء القياس لا
  يدعي أن كل العدادات قرئت ذرّيًا في اللحظة نفسها. لا تُحفظ هذه اللقطة كفاتورة.
- حد انتظار القراءة 12 ثانية فقط لهذه اللوحة، Abort عند مغادرتها/تغير الشركة،
  وإعادة محاولة يدوية دون Retry تلقائي أو تغيير سياسة الكتابات المالية.
- الحماية الخادمية subscriptions.view قبل كل قراءة؛ الواجهة تمنع الطلب أيضًا
  عند غياب الصلاحية، وترفض استجابة تحمل companyId مختلفًا وتخفي اللقطة القديمة.
- اللغة العربية/الإنجليزية/الأردية/الهندية وRTL/LTR والهاتف ولوحة المفاتيح مدعومة.
  تستخدم اللوحة مقاسين فقط (1rem و1.125rem)، ولا خط زخرفي قصير تحت العنوان.

## تصحيح اختيار الباقة والكتالوج

طلب المنسق هذا التعديل بعد إثبات استبدال تفضيل غائب بأول خطة ضمن أول 100 نتيجة.
الاختيار الموجود يبقى كما هو؛ المفقود أو الاختيار السابق الذي اختفى يصبح فارغًا
مع placeholder ورسالة «لم يُعثر عليه ضمن المعروض»، وتُصفّر الإضافات التابعة.
لا يدعي النص إلغاء الخطة أو إخفاءها. حتى إن ظهرت في صفحة لاحقة لا تختار آليًا؛
يلزم اختيار صريح. الزيارة الأولى بلا تفضيل تحتفظ بالسلوك السابق لأول خيار.

تستخدم أزرار السابق/التالي GET الحالي page/pageSize=100 عند totalPages>1، ولا
تحميل لكل الصفحات أو فلترة توحي بكتالوج كامل. لا يمكن الإرسال أثناء التحميل أو
بلا اختيار صحيح. الطلب الأحدث فقط يطبق النتيجة، ولا طلب تغيير اشتراك أو checkout
آليًا بسبب التصفح/القياس/التحديث. لم يتغير helper `public-plans.ts`.

## OpenAPI واقتراح الربط الدقيق

العقد أصبح مركزيًا OpenAPI **1.45.0**؛ المصدر الكامل
`CompanySubscriptionUsageResponse` في `packages/contracts/openapi.yaml`.

```text
GET /api/v1/subscription/usage
operationId: getCompanySubscriptionUsage
auth.authorize({ sid, permission: 'subscriptions.view', requireCsrf: false })
companyId: من سياق الجلسة وحده؛ لا query أو body معتمد
200: { companyId, measuredAt, consistency:'BEST_EFFORT', plan|null, period, metrics }
plan: { id: معرف إصدار BIGINT نصي, displayName, billingCycle }
metrics: { users, employees, postedDocuments }
Metric: { used, included, remaining, excess, state, comparisonBasis, definition }
errors: 400, 401, 403, 404, 429, 500, 503, 504 (Problem)
```

كل GET يمر بالتفويض قبل الخدمة، والاستعلامات غير المعروفة مرفوضة. no-store مع
Pragma/Expires في Router، ويبقى middleware العام لازمًا لبقية الاستجابات، خصوصًا
429 قبل Router والـdeadlines. لا حاجة إلى CSRF جديد لـGET؛ لا نقطة كتابة جديدة.

التركيب المقدم:

```ts
// server.ts، بعد تهيئة platformAnalytics القائم:
import { createSubscriptionUsageService } from './composition/create-subscription-usage-service.js';
const subscriptionUsage = createSubscriptionUsageService(database, platformAnalytics);
// يضاف subscriptionUsage إلى services الممررة إلى createApp.

// app.ts:
import type { SubscriptionUsageService } from './platform-subscriptions/subscription-usage-service.js';
import { createSubscriptionUsageRouter } from './platform-subscriptions/subscription-usage-router.js';
// في نوع services: subscriptionUsage?: SubscriptionUsageService;
if (services.auth && services.subscriptionUsage) {
  app.use('/api/v1', createSubscriptionUsageRouter(services.auth, services.subscriptionUsage));
}
```

هذا الاقتراح غير مطبق في هذه النسخة؛ app/server محجوزان للمنسق. يجب تحديث المخدم
الوهمي المشترك لإرجاع DTO للاستهلاك بدل `{}`، وتحديث توقع `public-plans.spec.ts`
إلى اختيار فارغ للتفضيل المفقود. اختبارات track-c تستخدم route fixtures اصطناعية
ولا تغيّر المخدم المشترك، ولذلك ظهور خطأ قياس في المتصفح اليدوي قبل الربط متوقع.

## العزل والبيانات الكبيرة

المسار لا يقبل companyId من الاستعلام ولا company أخرى من المستخدم. اختبرت رفض
401/403 قبل measurement وplan معًا، رفض override والفترة المرسلة، 404 للشركة
المفقودة، وعزل طلبين لشركتين. لا كاتب أو retry كتابة؛ تكرار GET يكرر القراءة فقط.

لكل طلب مكتمل: lookup شركة ضيق + أربعة count في analytics + lookup اشتراك ضيق +
findFirst أحدث تغيير عند وجود الاشتراك. لا findMany على الأشخاص/المستندات ولا
تحميل سجل تاريخي. عدد صفوف النتائج والذاكرة ثابت بالنسبة لحجم بيانات الشركة.
الكلفة المعروفة: count رابع لعمليات Audit لا يُعرض، بسبب إعادة استخدام companyUsage
كما هو؛ لم يُفتح منفذ مضاد أو يُعدّل analytics المشترك. count نفسه قد يستهلك زمنًا
يتناسب مع البيانات والفهارس؛ لم يثبت SLO أو benchmark لقواعد كبيرة.

اختبار تركيب المحول القائم يحاكي أربعة مليارات سجل عبر نتائج count ويثبت شكل
where وحدود gte/lt وعزل companyId، وأن JSON الناتج أقل من 1800 حرف. هذا **اختبار
وحدة/عقد استعلام، لا اختبار حجم فعلي على DB** ولا دليل على الأداء التشغيلي.

## نتائج التحقق

النتائج الفعلية لهذه النسخة، لا إعادة نسبة نتائج الأساس إليها:

- 22 اختبار واجهة track-c ناجحًا **قبل تعديل مقاس وصف رأس اللوحة الأخير** (390
  و1440، أربع لغات، الأخطاء والمهلة و429 والعزل والاختيار والصفحات وغياب أي
  change/checkout تلقائي). ثم نجح اختبارا العربية المحددان على390/1440 بعد
  تصحيح specificity في CSS، مع assertion بأن مقاسات العناوين/النصوص/الأزرار
  المحسوبة هي16/18px فقط، وعدم overflow أفقي، وصورتين محدثتين. لم تُعد الجولة
  الـ22 بعد تعديل CSS، ولا تنسب نتائجها إلى شيفرة لاحقة.
- TypeScript المصدر والاختبارات API/Web/E2E ناجح، contracts:check ناجح
  (167 جسم طلب/2101 استجابة)، وحارسا i18n/UI وdiff check ناجحان.
- مجموعة API الكاملة: **514 ناجحًا،136 متجاوزًا،صفر فشل** (84 ملفًا ناجحًا،36
  ملف DB متجاوزًا). تشمل21 اختبارًا خاصًا بالاستهلاك، وفترتي البداية/النهاية
  الجزئيتين، validator المولد على استجابة Router الفعلية، وroute parity بلا استثناءات.
- 93 اختبار API مركزًا نجح أيضًا قبل إضافة اختباري الفترة الجزئية الأخيرين.
- مجموعة Web الكاملة: **80 ناجحًا** في13 ملفًا، منها7 لمساعدات القراءة والاختيار.
- Infra لم يُعاد تشغيله في المسار C؛ التنسيق القديم في الأساس يتضمن المسار المحلي
  السابق المخالف لحارس brand-removal، وقد أصلحه المنسق في فرعه. لم يعدل C الوثيقة
  المشتركة. Redocly والبناء الإنتاجي لم يعادا هنا؛ نتائج العقد المركزي موثقة
  في وثيقته، وعلى المنسق تشغيلهما للنسخة المجمعة. لا تنزيل حزم لأجل التحقق.
- MariaDB 10.11 وMySQL 8.4، fresh/upgrade وDB E2E: **لم تشغّل**؛ شرط مانع للدمج.

صور QA الأخيرة موجودة في `test-results/track-c/` بصيغتي390/1440 العربية، ولا
تُضم إلى Git. مخرجات الاختبار المركّز تستخدم مجلد Playwright نفسه وتستبدل أدلته
الملفية السابقة؛ تبقى نتيجة الجولة22 الكاملة في سجل تنفيذ المهمة وفي الأرقام
أعلاه، وليست هناك حزمة صور نهائية للغات الأربع بعد تحديث CSS. لم تُعد الاختبارات
لإعادة إنشاء ملفات غير لازمة في ظل تنبيه المساحة. كان المتاح نحو1.1GiB أثناء
التنبيه، ثم نحو1.95GiB في فحص الإغلاق؛ لم يحذف المسار C أي ملفات للمستخدم لتوفيرها.

لا يُعد harness أخطاء Router إثباتًا لمعالج 500 الحقيقي في التطبيق؛ اختبار فشل
المصدر يثبت رفض الخدمة وعدم تحويل الفشل إلى صفر. اختبار429 يحاكي طبقة HTTP
السابقة للـRouter ويطابق العقد، وليس اختبار محدد المعدل الإنتاجي نفسه. يتحقق
المنسق من تلك الطبقات بالربط الحقيقي؛ لا تدّعي هذه الوثيقة اكتمالها.

## إعادة الفحص والموارد

تُضاف مسارات Node/npm المذكورة في وثيقة التنسيق إلى PATH. من جذر نسخة C:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.test.json
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.e2e.json
node scripts/generate-openapi-guards.mjs --check
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node node_modules/@playwright/test/cli.js test --config playwright.track-c.config.ts
# من apps/api ثم apps/web على الترتيب:
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1
```

إعداد track-c يستخدم API3132 وWeb4182 مع strictPort وreuseExistingServer:false،
وcache محلي تحت apps/web/node_modules. يسمح Vite بمجلد النسخة وrealpath لحزمة
@fontsource فقط، لا كود نسخة التكامل. لا install/ci/prune/update أو Prisma generate
أو إيقاف لعمليات الآخرين. جميع التبعيات المشتركة بقيت للقراءة فقط.

## مراجعة معمارية وما بقي

- الملكية والـPorts والعزل وRBAC مثبتة؛ لا اعتماد خرساني جديد بين السياقات.
- لا schema/migration أو أي كتابة؛ locking/Idempotency/Outbox/Audit append غير
  منطبقة على هذه القراءة ولا يُضعف دعمها القائم. لا سعر أو تحصيل أو قرار حظر.
- OpenAPI مستورد من المنسق ومطابق؛ app/server/mock ورحلة A/B/C تحتاج الربط المركزي.
- Barcode Impact: غير منطبق؛ لا إدخال/اختيار صنف أو مستند أصناف أو طباعة/ملصقات
  أو قارئ جديد، ولم يتراجع الدعم القائم.
- لا مكتبة جديدة؛ استخدام أدوات المشروع الحالية يحافظ على الترخيص والاعتماديات.
- بوابات DB والأداء الحقيقي لم تُغلق، ولا تصريح نشر ضمن هذا التسليم.
