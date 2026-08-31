# تسليم المسار F — ميزانية قراءة استهلاك الاشتراك

الحالة: مكتمل ومختبر محليًا في `project-track-usage-query-budget` على الفرع
`perf/subscription-usage-query-budget`، من الأساس
`a3210b632c18c7a6b02328bbf08b037e73bd415c`. لا Push أو PR أو Merge أو Deploy.
لا تدل النتائج المحلية على اجتياز بوابتي قواعد البيانات المدعومتين أو جاهزية نشر.

## الالتزامات وطريقة الجمع

1. `6b13d553b15f7ce2de7670ee482c1de70e53ba29` — فصل قراءة الحصص، مشاركة تعريف
   العدادات، حواجز ميزانية الطلب، وتحديث اختبار الاستهلاك السابق.
2. `37398782a251118f6675aa03e68ea4d739dc8758` — 28 اختبارًا جديدًا لميزانية
   القراءة والعزل وحدود الفترة والأعداد الكبيرة والمهلة والانقطاع الفعليين.
3. التزام هذه الوثيقة فقط؛ يذكر معرفه في رسالة التسليم.

تلتقط بالترتيب على أساس المنسق الموافق. لا تعديل مطلوب في app/server؛ المتغير
`platformAnalytics` الحالي محول خرساني يطبق المنفذ الجديد والقديم معًا.
المراجعة والاختبارات المجمعة وبوابتا DB وتفويض الإصدار تبقى عند المنسق.

## الملكية والعقد

قُرئت `AGENTS.md` ومراجعها السبعة كاملة بالترتيب، ثم وثائق الأربعة والتكامل
السابق وتسليم C. التغيير داخل حد القراءة في Platform Operations & Billing
وتركيب خدمة Platform Subscriptions & Entitlements؛ لا مالك بيانات جديد.

- `platform-operations-ports.ts`: إضافة `PlatformCompanyUsageInput` و
  `PlatformCompanyQuotaUsage` و`PlatformCompanyQuotaUsageQueryPort` مستقل.
- `prisma-platform-analytics-query-adapter.ts`: تنفيذ المنفذ الجديد وإعادة استخدام
  `companyQuotaCounts` الخاص نفسه داخل المنفذ القديم للفوترة؛ تعريف where واحد
  للعدادات الثلاثة في هذين المسارين، دون عداد موازٍ أو تفريع سياسة.
- `create-subscription-usage-service.ts`: يستهلك المنفذ الجديد فقط.
- `subscription-usage.test.ts` و`subscription-usage-query-budget.test.ts`: الأدلة.
- **استثناء ملكية مفوض من المنسق**: ثلاث إضافات فقط في
  `subscription-usage-plan-adapter.ts`؛ استيراد `assertRequestActive` وفحصه قبل
  lookup الاشتراك وبعده وقبل `findFirst`. لا تغيير للإسقاط أو ترتيب الخطة.

```ts
interface PlatformCompanyQuotaUsageQueryPort {
  companyQuotaUsage(input: {
    companyId: bigint;
    periodStart: Date;
    periodEndExclusive: Date;
  }): Promise<{
    users: number;
    employees: number;
    postedDocuments: number;
  } | null>;
}
```

يظل `PlatformAnalyticsQueryPort.companyUsage` يعيد العدادات الأربعة، بما فيها
`operations`. لم يضف عضو إلزامي إلى الواجهة القديمة، ولم تتطلب مصانع mocks
للخدمات الأخرى تعديلًا؛ اجتاز TypeScript جميع مصدر API واختباراته.
لم يتغير DTO أو OpenAPI أو Router أو app/server أو Prisma/schema أو Frontend.

## التعريفات والميزانية

بقيت التعريفات كما في المصدر السابق حرفيًا:

- المستخدمون: `companyId` مع `UserCompany.isActive=true` و`User.isActive=true`.
- الموظفون: `companyId` وحالة `ACTIVE` أو `ON_LEAVE`، دون شرط امتلاك حساب.
- المستندات: `companyId` و`postedAt >= periodStart && postedAt < periodEndExclusive`.
  لا فلتر حالة؛ المعكوس ذو `postedAt` محسوب، والمسودة بلا ترحيل غير محسوبة.
- الفوترة وحدها تبقي `AuditLog.createdAt` في النافذة نفسها لحساب `operations`.

يحافظ كلا منفذي القياس على lookup الشركة مع `select: { id: true }` قبل العد.
الشركة المفقودة تعيد null بلا عد، وفشل lookup أو القياس لا يتحول إلى صفر.
قراءة الخطة تبقي أحدث تغيير APPROVED فعال بترتيب `effectiveAt DESC, id DESC`
مقيدًا بالشركة والاشتراك، وإلا الإصدار الأساس، بالإسقاط المحدود نفسه.

| المسار | السابق | الحالي |
|---|---:|---:|
| تركيب usage مع اشتراك موجود | 7 | 6 |
| منفذ قياس الحصص وحده | 5 عبر المنفذ القديم | 4 |
| منفذ الفوترة `companyUsage` | 5 | 5 |
| usage دون اشتراك | — | 5 |

الأرقام **استدعاءات Prisma منطقية تعدها spies، لا عدد SQL statements مقاسًا**.
المقارنة 7→6 تشغل التركيب السابق عبر المنفذ القديم المحفوظ، وتقارنه بالتركيب
الجديد مع تطابق DTO كاملًا. قراءة الشركة + ثلاثة count + lookup الاشتراك +
أحدث تغيير = ستة استدعاءات عند وجود اشتراك. لا تزعم الوثيقة عدد SQL الداخلي
للإسقاطات المرتبطة داخل Prisma أو نسبة تحسن زمن الاستجابة.

أثبت الاختبار الأحمر قبل التنفيذ أن `Audit.count` يستدعى مرة واحدة غير لازمة:
20 ناجحًا واختبار الفجوة فاشل كما هو متوقع. بعد التنفيذ يثبت GET حقيقي عبر
`createApp` عدم الوصول حتى إلى delegate Audit؛ يعيد 200 وعقدًا مولدًا صحيحًا
و`no-store`، بعد التفويض قبل أول lookup.

لا cache أو جلب سجلات بـfindMany أو جدول عدادات أو تعديل دورة أو حصة. تبقى
`BEST_EFFORT` والفترة الإحصائية UTC و`UNKNOWN/NOT_CONFIGURED` دون تغيير؛ لا
تحويل سنوية/ربع سنوية إلى مضاعف حصة، ولا فرض رسوم أو حظر جديد.

## المهل والانقطاع: ما ثبت وما لم يثبت

يستخدم المحول `assertRequestActive` القائم قبل كل استدعاء قراءة وبعد اكتماله؛
لا تنشأ ميزانية أخرى ولا retry أو Promise timeout. يحمي ذلك lookup الشركة،
dispatch العدادات الثلاثة، وعدّ Audit في مسار الفوترة. حارسا قراءة الخطة يمنعان
بدء lookup أو `findFirst` بعد انتهاء الطلب. الاستعلامات المتوازية تبقى متوازية.

الاختبارات تغطي deadline بالساعة وبـAbortSignal وClientDisconnectedError قبل
القراءات وأثناء lookup، وبين dispatch العدادات، وأثناء counts معلقة. وتشمل
طلب HTTP حقيقيًا ينتهي بـ504 وطلبًا آخر يغلق اتصال TCP؛ عند استكمال lookup
الشركة والاشتراك المتأخرين لا يبدأ أي count أو استعلام تغيير خطة بعدهما.

الاستعلام الذي صدر بالفعل قد يستمر، بما فيه انتظار pool أو تنفيذ DB. لا يحمل
Prisma هنا آلية إلغاء مثبتة لهذه القراءة، ولا يلغي رفض Promise الاستعلام. أثبتت
fixtures بقاء promises معلقة حتى تحريرها صراحة؛ الاختبارات ليست تجربة إلغاء
query في محرك DB. منع إرسال نجاح HTTP متأخر يبقى أيضًا مسؤولية middleware
القائم. خارج RequestExecutionContext لا توجد ميزانية طلب لاستعمالها.

## نتائج التحقق

النسخة المصدرية المختبرة `6b13d55`، مع اختبارات `3739878`؛ لا تعديل للشيفرة
بعد الجولة النهائية، ثم توثيق هذه النتائج فقط. استُخدم Node `24.19.0`.

| البوابة | النتيجة |
|---|---|
| API المركز النهائي: 11 ملفًا | 161 ناجحًا، صفر فشل/تجاوز |
| اختبارات ميزانية القراءة الجديدة ضمنها | 28 ناجحًا، منها حالتا HTTP فعليتان |
| TypeScript API المصدر `--noEmit` | ناجح |
| TypeScript API المصدر والاختبارات `--noEmit` | ناجح بعد آخر إضافة اختبارات |
| `contracts:check` | ناجح؛ 167 جسم طلب و2101 جسم استجابة |
| حراس Infra المركزون: OpenAPI والاسم المتقاعد | 6 ناجحة، صفر فشل |
| `git diff --check` | ناجح |
| API الكامل، Web، متصفح واجهة، بناء إنتاجي، Redocly | لم تعد في هذا المسار |
| MariaDB 10.11 وMySQL 8.4 / DB E2E / benchmark DB | لم تشغل؛ ليست متاحة محليًا |

التقرير المحلي المستقل: `test-results/track-f/api-focused.json`، ولا يضم إلى
Git. استبدل التقرير جولة 159 الأولى بعد إضافة حالتي HTTP بالجولة النهائية161.
اختبارات المليارات تستخدم count وهميًا يصل إلى `Number.MAX_SAFE_INTEGER`،
مع نتيجة محدودة الحجم وأعداد غير آمنة تصبح UNKNOWN؛ ليست بيانات فعلية كبيرة.

## إعادة الفحص

استخدم PATH Node/npm المعتمد في وثيقة الأربعة، ومن جذر نسخة العمل:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.test.json --noEmit
node scripts/generate-openapi-guards.mjs --check
node --test scripts/tests/openapi-guards.test.mjs scripts/tests/brand-removal.test.mjs
node node_modules/vitest/vitest.mjs run --root apps/api tests/subscription-usage.test.ts tests/subscription-usage-query-budget.test.ts tests/subscription-usage-app.test.ts tests/openapi-subscription-usage-contract.test.ts tests/openapi-route-parity.test.ts tests/platform-operations-service.test.ts tests/platform-operations-router.test.ts tests/platform-billing-service.test.ts tests/request-context.test.ts tests/transaction-executor.test.ts tests/architecture-guardrails.test.ts --maxWorkers=1 --reporter=json --outputFile=../../test-results/track-f/api-focused.json
```

استُخدم worker واحد وcache محلي `apps/api/node_modules`؛ junction الاعتماديات
للقراءة فقط. لا install/ci/prune/update أو prisma generate أو تنزيل محركات أو
حذف ملفات مستخدم أو إيقاف عمليات الآخرين. اختبارات HTTP تستعمل منافذ مؤقتة
ومخادمها الخاصة التي تغلقها؛ إعداد fixture يخص F على3136/4186. لا خادم دائم.

## مراجعة معمارية وحدود التسليم

- Ports والملكية وعزل الشركة باقية؛ لا كتابة جديدة، ولا تعديل Ledger أو خدمة
  مالية أو Decimal أو Audit append أو Outbox أو معاملة أو أقفال أو idempotency.
- لا اعتماد مكتبي جديد أو تغيير schema؛ لذلك migrations وباركود وكاتب بيانات
  جديد غير منطبقة. **Barcode Impact: غير منطبق**؛ لا صنف أو مستند بنود أو طباعة.
- لا تعني أعداد spies أداءً ثابتًا؛ count قد تتغير كلفته حسب الحجم والفهارس
  وخطة التنفيذ. لا SLO ولا نسبة سرعة ولا إلغاء DB مثبت.
- ينبغي تشغيل بوابتي المحركين على شيفرة التكامل النهائية وقياس SQL/latency
  ببيئة ممثلة قبل أي ادعاء أداء أو إصدار. نجاح هذه القراءة لا يغلق بطء TCP/TLS.
