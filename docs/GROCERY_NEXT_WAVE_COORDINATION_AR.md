# تنسيق الدفعة التالية للبقالات — مستقلة عن PR #45

تاريخ البدء: 2026-08-31. الأساس المحلي: `39c1de8`؛ هذا مرشح إصدار، لا ادعاء بأنه منشور.
المنسق: المهمة `01a04cc6-7aae-70b2-adb9-e037386d06a2`.

## العزل والملكية

تبقى دفعة الإصدار في `D:/CodexWorktrees/grocery-launch-coordinator` محجوزة للمنسق.
هذه الدفعة لا تدخل PR #45 ولا تؤخره بقدرات جديدة. يمنع Push/PR/Merge/Deploy من المسارات.
لا تعدّل أي نسخة على C أو ملفات مهمة أخرى. اقرأ AGENTS والمراجع السبعة كاملة.

| المسار | النسخة والفرع | الملكية الأولية |
|---|---|---|
| N1 استرجاع نتيجة البيع | `D:/CodexWorktrees/pos-durable-recovery`، `feat/pos-durable-recovery` | ملفات `pos/recovery-*` و`pos-recovery-*` و`PosRecovery*` الجديدة، اختباراتها وADR/handoff مستقلان |
| N2 سياق الكاشير | `D:/CodexWorktrees/cashier-context-experience`، `feat/cashier-context-experience` | `cashier-context-*` و`CashierContext*` الجديدة، سياسة/Ports owner-side جديدة بعد مراجعة العقد، الاختبارات وقاموس مستقل |
| N3 إخراج إيصال البيع | `D:/CodexWorktrees/retail-receipt-output`، `feat/retail-receipt-output` | `printing/retail-receipt-*` و`RetailReceipt*` الجديدة، الاختبارات وقاموس مستقل وhandoff |

المنسق يملك App/PosPage/InventoryPage/navigation، app/server/composition الحالية، OpenAPI/generated،
Prisma/schema/migrations، package/lockfiles، قاموس الترجمات المجمع، إعدادات CI، ملفات الحالة والمعمارية المشتركة.
يرسل كل مسار أولًا مقترح DTO/Port/صلاحيات/معاملة/حقول schema إن احتاجها؛ لا يغير ملفًا مشتركًا حتى اعتماد ملكيته.
يمكنه تنفيذ السياسات والمكونات المعزولة واختباراتها أثناء مراجعة العقد، لكن لا يشحن API غير موثق.

## الحدود الهندسية

- N1: استرجاع نتيجة Checkout بعد ضياع الاستجابة وإعادة تحميل الصفحة، دون إنشاء بيع جديد أو كشف طلب مستخدم آخر. لا تخزين أجسام مالية أو credentials في localStorage. لا اعتبار عدم العثور دليل فشل أو إذنًا لإعادة البيع. افحص Idempotency retention وعلاقة PosSale، واقترح correlation آمنًا وowner-scoped مع عقد صريح قبل أي schema. لا تكرر Ledger/فاتورة/قبض أو تضع شبكة داخل المعاملة.
- N2: تقليل تكرار الحقول مع سياق واضح قابل للمراجعة. طبق سياسة ERP_CONTEXTUAL_DEFAULTS_UX؛ حل الفترة يملكه Core Accounting خادميًا وفق التاريخ. لا اخترع فرعًا/محطة/صلاحية، ولا تحفظ آخر اختيار كحقيقة مالية. احتفظ بأولوية مسودة المستخدم وأعد التحقق من المستخدم/الشركة/الصلاحيات والمراجع. ابدأ بشريحة صغيرة قابلة للتركيب لا موديول ورديات شامل.
- N3: إيصال واضح مهيأ للطباعة الحرارية مع عرض صريح 58/80mm عند دعم المالك، باستخدام snapshot/archive الحاليين. لا إعادة حساب للأموال أو توليد لقطة حقيقة موازية أو تغيير الأرشيف التاريخي. Barcode Impact إلزامي؛ إعادة استخدام مالك الباركود والرندر، لا parser جديد أو QR وهمي. لا ادعاء نجاح أجهزة حقيقية من PDF/محاكاة. لا طباعة صامتة أو تعديل قوالب مستندات أخرى.
- للجميع: Modular Monolith، Ports/Adapters عند المالك، ACID، Decimal كنص، RBAC + entitlement + company isolation، لا pagination في الذاكرة أو GET شامل أو retry تلقائي للكتابة.

## الموارد والأدلة

`node_modules` junction مشتركة للقراءة فقط. لا npm install/ci ولا Prisma generate ولا تنزيل متصفح أو تعديل عميل مشترك.
اطلب عميل Prisma معزولًا عند الحاجة بعد تثبيت العقد؛ لا تستخدم عميلًا غير مطابق كدليل.
جميع cache/build/TEMP/صور الاختبار في النسخة على D. TypeScript7: GOMAXPROCS=2 وGOMEMLIMIT=1536MiB.
اختبارات unit مركزة بعامل واحد. مجموعة متصفح واحدة محليًا في الوقت نفسه بإشارة المنسق؛ لا full suite متزامنة.
المنافذ المحجوزة N1:3150/4200، N2:3151/4201، N3:3152/4202؛ تحقق من خلوها قبل التشغيل ولا توقف عملية مجهولة.
Vite allow-list للعمل الحالي وrealpath خطوط @fontsource فقط. لا توسع السماح إلى شجرة كود مهمة أخرى.

التسليم: commits صغيرة محلية، شجرة tracked نظيفة، قائمة ملفات وربط دقيق، نتيجة كل أمر مع skips والفشل والحدود،
TypeScript/unit/عقد/عزل واختبارات متصفح بأربع لغات و390/768/1440 عند الصلة. بوابتا MariaDB10.11/MySQL8.4
fresh+upgrade وDB E2E تظلان شرط دمج مستقل. لا تعتبر وقت التنفيذ أو غياب محرك محلي نجاحًا.
