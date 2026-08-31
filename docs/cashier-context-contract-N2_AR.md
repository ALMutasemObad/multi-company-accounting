# عقد N2 — سياق الكاشير المعزول

الأساس `39c1de8`، الفرع `feat/cashier-context-experience`، النسخة
`D:/CodexWorktrees/cashier-context-experience`. اعتمد المنسق في المهمة
`01a04cc6-7aae-70b2-adb9-e037386d06a2` الاتجاه وDTO بتاريخ 2026-08-31.
الاعتماد للشريحة المعزولة فقط؛ لا API منشور أو تعديل schema أو ربط POS في هذا التسليم.

## المالك والقرار

- Core Accounting يملك `CashierContextPeriodPort` وسياسة التاريخ وQuery Adapter.
- الواجهة تملك مسودة عرض وتذكرًا اختياريًا بذاكرة الجلسة فقط. لا Aggregate جديد
  ولا فرع/محطة/وردية أو جدول تفضيلات. لا localStorage/sessionStorage أو cache عالمي.
- لا مبالغ أو أسعار أو سعر صرف أو طرف أو باركود في المسودة المحفوظة أو القياسات.
  تستنسخ حدود المسودة والنتيجة الحقول المسموحة فقط حتى إذا مرر المالك كائنًا أكبر.
- تبقى صلاحيات واستحقاقات الجلسة والخادم هي الحقيقة؛ قراءة الواجهة ليست إذن بيع.

## حل الفترة المقترح للتركيب

`GET /api/v1/pos/context/period?documentDate=YYYY-MM-DD`

التفويض المقترح المعتمد: `pos.checkout` مع استحقاق POS القائم والجلسة المصادقة
ذات الشركة المحددة. لا companyId في الطلب، ولا صلاحية جديدة أو تخفيف للصلاحيات.
المنسق يملك OpenAPI وحراسي الطلب/الاستجابة وRouter وcomposition وHTTP no-store.
لا يحتوي هذا الفرع على استدعاء HTTP لمسار غير منشور.

شكل نجاح 200:

```ts
type CashierContextPeriodResult =
  | {
      documentDate: string;
      status: "RESOLVED";
      period: {
        id: string; name: string; startDate: string; endDate: string;
        status: "OPEN" | "REOPENED"; version: number;
      };
    }
  | { documentDate: string; status: "MISSING" | "CLOSED" | "AMBIGUOUS" };
```

`CashierContextPeriodError.reason = INVALID_DOCUMENT_DATE` يحتاج من Router عند
التركيب استجابة 400 ضمن `VALIDATION_ERROR`؛ لم يُنشأ Router في هذه الشريحة.
يبقى رفض الجلسة/الصلاحية/الاستحقاق ومعالجة تعذر DB مسؤولية الحماية المركزية.

`resolve(tx, actor, documentDate)` يقرأ من TransactionClient المستدعي فقط:

- يوم ISO حقيقي، سنة 0001..9999، بلا timestamp أو timezone أو تقليم صامت.
  يرفض rollover مثل 2026-02-29 و2026-04-31 قبل أي query.
- `companyId = actor.companyId`، و`startDate <= day <= endDate`، و`take: 2`،
  وترتيب ثابت حسب البداية ثم id. لا تحميل كل الفترات أو pagination داخل الذاكرة.
- لا فلتر للحالة قبل اكتشاف التداخل: وجود صفين يعني AMBIGUOUS ولو أحدهما CLOSED.
  صفر صفوف MISSING؛ صف واحد CLOSED يعاد CLOSED بلا تفاصيل مرجع؛ OPEN/REOPENED
  يعاد RESOLVED. تبقى BIGINT نصوصًا في النتيجة.
- قراءة advisory دون أقفال أو كتابة أو retry. لا تضمن نجاح Checkout. يجب أن يطابق
  أمر المالك تاريخ المستند والفترة ويقفلها عند الترحيل؛ لم يُعدل Posting أو fiscal-service.
  لا تنقل سياسة المطابقة أو اختيار الفترة إلى المتصفح.

## عقد التحقق من المراجع

`CashierContextReadPort.reference({scope, field, id, signal})` يعيد:

```ts
type Result =
  | { status: "available"; reference: {
      id: string; label: string; revision: string; requiresReference?: boolean;
    } }
  | { status: "unavailable" | "forbidden" | "ambiguous" };
```

المراجع: warehouseId وcashBankAccountId وpaymentMethodId وcurrencyId فقط.
المنفذ يثبت exact-id والنشاط والشركة وصلاحية المستخدم عبر مالك المرجع. يجب أن
تتغير revision مع البيانات المؤثرة؛ وللطريقة `requiresReference` boolean إلزامي.
لا يوصف مصدر متصفح بأنه مرجع شركة موثق. لا يختار المكون أول عنصر من قائمة.

| المرجع | الواقع | حدود الربط المطلوب من المنسق |
|---|---|---|
| المستودع | GET /warehouses/:warehouseId موجود | قراءة مالك معزولة بالشركة، active، warehouses.view وInventory |
| الصندوق | GET /cash-bank-accounts/:cashBankAccountId موجود | قراءة مالك active ومسموح للعملية، cash_bank_accounts.view وTreasury |
| طريقة الدفع | GET /payment-methods شامل؛ لا GET by-id؛ query لا يطبق pagination | يلزم منفذ exact-id/خيارات محدودة لدى Treasury؛ لا تنسخ GET الشامل |
| العملة | GET /currencies/options بصفحات محدودة، دون query exact-id | يلزم تحقق exact-id/تمكين لدى Tenant؛ غيابها من الصفحة لا يعني تعطيلها |

وافق المنسق على امتلاك منافذ/عقود المراجع في مرحلة الجمع، ومنع توسيعها هنا.
غياب منفذ التحقق يعاد unavailable، ولا يفتح الاعتماد أو يملأ قيمة بديلة.
الاختيارات نفسها slot `renderPicker` قابلة لتركيب picker المالك المحدود لاحقًا؛
لا يقرأ هذا المكون أي قائمة أو يجمع صفحات.

## دورة حياة الواجهة

1. ينشئ المالك controller واحدًا لعمر سياق POS المصادق، ويحقن reader. تمرر
   `setScope` هوية المستخدم والشركة وauthorizationRevision والصلاحيات الفعلية
   والموديولات. عند أي تغيير تُلغى القراءات وتُمحى المسودة والتذكر والlabels والفترة
   والمراجعة والقياسات فورًا؛ الرجوع للشركة القديمة لا يستعيدها. `dispose` يمحوها أيضًا.
   لا يعاد بناء controller في كل render. أي إبطال جلسة/تفويض خادمي يستدعي إبطال scope.
2. `startSale({documentDate,requiresWarehouse,draft?,companySuggestions?})` إجراء
   صريح لبيعة جديدة. التاريخ من مالك البيع/مسودته؛ لا تقرر اللوحة اليوم أو المنطقة الزمنية.
   `requiresWarehouse` يبقى true في POS الحالي (عقد أصناف مخزون). دعم false سياسة
   معزولة مختبرة ولا يعني إضافة بيع خدمات لعقد POS الحالي.
3. الأولوية: مسودة صريحة، ثم تذكر صريح لهذه الجلسة، ثم إعداد شركة موثق، ثم اختيار
   المستخدم. لا فروع/محطات وهمية. المسح الصريح للحقل null يتغلب على جميع الافتراضات؛
   المرجع المعطل أو الملتبس لا يسقط إلى مصدر أدنى بصمت.
4. `select` يحفظ تعديل المستخدم الحالي؛ `saveDraft()` وحده يثبت مسودة قابلة للاسترجاع
   في ذاكرة controller. تعديلات لاحقة لا تكتب فوق النسخة المحفوظة حتى حفظ جديد.
   يعرض الزر أن الحفظ محلي لعمر الجلسة فقط، وليس حفظًا خادميًا أو استرجاعًا بعد reload.
5. `review(true)` موافقة صريحة على تذكر المراجع الأربع. لا يتذكر التاريخ أو الفترة
   أو سعر الصرف. `review(false)` يعتمد هذه البيعة دون إنشاء تفضيل جديد.
6. كل startSale يعيد قراءة المراجع والفترة. إذا كان التذكر صريحًا، وبقيت جميع
   المعرفات/الlabels/النسخ/حالة الفترة/التاريخ كما روجعت، يعاد استخدام المراجعة دون
   نافذة أو نقرة إضافية. أي تغير أو إلغاء مراجعة بسبب تعديل يتطلب مراجعة جديدة.
7. مهلة الواجهة الافتراضية 300000ms قابلة للحقن، وليست SLO أو ضمان DB. المراجعة
   المعاد استخدامها لا تمدد المهلة الأصلية. لا يقبل الوقت غير الصالح أو الراجع.
   انتهاء تحقق المرجع/الفترة يمنع review حتى إعادة القراءة؛ الضغط المتكرر لا يمدده.
8. `getReviewed()` عند حد submit يعيد null إذا لم يبق السياق جاهزًا. لا يكفي boolean
   قديم أو callback سابق. تحمي Panel العرض أيضًا بمقارنة `currentScopeKey` المأخوذ
   مباشرة من التفويض، فتخفي المحتوى القديم قبل مزامنة controller.

## ربط POS الذي يملكه المنسق

- يعرض `CashierContextPanel` القيم الأربع ومصادرها، تاريخًا قابلًا للتعديل، والفترة
  كنص صادر من الخادم. القاموس مستقل للغات الأربع؛ CSS محصور بالمكون (20px/16px).
- يحقن المالك `renderPicker` وvalidationPort بعد تجهيز العقود. لا UI لتعديل الفترة
  يدويًا ولا default لسعر الصرف. بقية حقول POS (الطرف، الوصف، سعر الصرف، مرجع الدفع،
  الملاحظات) تظل لدى مالكها ولا تختفي بسبب هذه الشريحة.
- `onReviewed` يغير مسودة المالك فقط: `fiscalPeriodId` إلى `periodId` و
  `cashBankAccountId` إلى `cashAccountId`. لا ينشئ محاولة مالية. current POS يحمل
  PaymentMethod كاملًا؛ لا تصطنع كائنًا فارغ الحقول من id، بل اربط snapshot المالك
  الحقيقي أو عدّل بنية مسودة POS إلى metadata الدنيا الموثقة.
- عند تغير currencyId فعليًا يجب المرور بـchangeCurrency الموجود لإبطال الأسعار
  وطلبات selling-profile القديمة. إذا بقيت العملة نفسها لا تنادِ تغيير العملة الذي
  يمسح أسعار السلة. لا تضع exchangeRate=1 من اللوحة.
- مرر `scan-pending` عند وجود scanner FIFO أو profile pending، وcheckout-pending/
  checkout-unknown/checkout-completed أثناء المحاولة/النتيجة. كل هذه الحالات تمنع
  select/date/saveDraft/review/refresh/startSale؛ تغيير scope الآمن يبقى ممكنًا.
  لا يلغي المكون lock بنفسه ولا يحسم المحاولة أو يعيد إرسالها.
- يستدعي «بيع جديد» startSale فقط بعد سماح مالك المحاولة، ولا يعدل الجسم أو المفتاح
  المثبتين. استخدام المراجعة المحفوظة لا يتخطى server validation في Checkout.

## Barcode Impact

لم تُعدّل InventoryBarcodeScanner أو FIFO أو codec أو resolve أو addPosItem أو
البنود. لا parser/lookup جديد أو قراءة raw barcode في سياق الكاشير أو قياساته.
يمر المسح إلى السلة الموجودة ويظل الصنف النصي ذو الأصفار البادئة عند مالك الباركود.
يتطلب الربط تمرير pending الصحيح قبل السماح بتغيير السياق، وإبطال السياق/طلبات
المراجع عند تبديل الشركة. إضافة صنف مخزون تلزم المستودع؛ المسح لا يعتمد السياق.
اختبارات controller تثبت القفل والشرط؛ لا تثبت HID أو كاميرا أو جهاز فعلي أو تكامل
POS بعد الربط. اختبار المتصفح والتفاعل مع المسح مسؤولية مرحلة الجمع المنسقة.

## مراجعة المعمارية

- [x] قُرئ AGENTS والمراجع السبعة ووثيقة التنسيق وGROCERY_LAUNCH_INTEGRATION كاملة.
- [x] تغيير مالك Core Accounting الجديد read-only؛ لا قراءات/كتابات Prisma عابرة للمالك.
- [x] لا schema/migration أو حدث/Outbox أو قيد أو retry أو Network I/O داخل المعاملة.
- [x] DTO منفصل بلا Prisma records وبلا مبالغ/حساب مالي أو أسعار صرف مشتقة.
- [x] نطاق المستخدم/الشركة/الصلاحيات، الرفض الآمن والغموض والردود المتأخرة مختبرة.
- [x] لم تضاف dependency أو مكتبة جديدة؛ استُخدم React/Vite/Vitest الموجود للواجهة
  والسياسة المحلية الصغيرة بدل اعتماد موديول تفضيلات جديد لا يناسب ملكية المجال.
- [ ] OpenAPI/Router/تركيب POS والتحقق الفعلي للمرجع: للمنسق، غير منفذ هنا.
- [ ] DB integration وفحص المحركين fresh+upgrade: غير منفذ، لا يُحتسب unit بديلًا.
- [ ] متصفح بأربع لغات و390/768/1440 وأجهزة المسح: مؤجل بطلب تنسيق الموارد.
