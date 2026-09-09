# دليل مهمة معمارية تعيين الحسابات الافتراضية

## النتيجة

أنتجت المهمة قرارًا معماريًا وخطة شرائح لمركز واحد يملكه Core Accounting، بعد جرد
المخطط والكود الحاليين. لا تحتوي المهمة على تغيير Schema أو API أو كود منتج أو
اعتماد، ولا تغير سلوك النظام.

الوثائق الحاكمة:

- [ADR-023](../../architecture/ADR-023-central-accounting-mappings.md).
- [خطة الشرائح](../../architecture/CENTRAL_ACCOUNTING_MAPPINGS_SLICE_AR.md).
- [خريطة السياقات](../../architecture/BOUNDED_CONTEXT_MAP_AR.md).

## ما ثبته الجرد

- تبقى حسابات العميل والمورد وملف بيع الصنف حقائق على الكيان، وتبقى حسابات بنود
  الفواتير والحركات لقطات تاريخية.
- يبقى TaxRate مالك حسابي الضريبة، وTreasury مالك حساب دفتر الصندوق/البنك، وتبقى
  counter accounts اختيارات مستند.
- تنتقل استدلالات Inventory وFX والإقفال إلى المركز عبر Port.
- البحث المباشر عن `3300` في Financial Close دين تقني له شريحة إزالة واختبار حارس.
- `Account` لا يحمل version حاليًا؛ التعطيل يفحص الأبناء النشطين فقط، والحذف يقرأ
  علاقات سياقات متعددة مباشرة ولا يغطي كل الاستعمال التاريخي.
- `CashFlowAccountMapping` يملكه Reporting وفق عقد التدفق النقدي؛ لا يجوز لـCore
  Accounting قراءته مباشرة عند حراسة دورة Account.
- common accounts في القوالب الثلاثة الجديدة ما زالت تحمل
  `sourceTemplateCode=SMALL_BUSINESS_GENERAL`؛ لذلك تعتمد خطة backfill مرشحين
  مرتبين ولا تساوي بين قالب الشركة ووسم كل حساب.

## قرارات السلامة

- مفاتيح Typed مغلقة وفئات حساب مؤهلة لكل مفتاح.
- `(companyId,key)` فريد وFK مركب إلى Account داخل الشركة.
- CAS/Idempotency/RBAC/CSRF/Audit في تغيير الإعداد.
- `reason` اختياري منقح ومحدود، ويدخل command/HTTP/fingerprint/Audit.
- `Account.version/expectedVersion` مع CAS، وحارس استعمال مركب عبر Ports مالكي
  Customer/Supplier/SellingProfile/Tax/Treasury واللقطات والتاريخ.
- أي استعمال حالي أو تاريخي يمنع تعطيل/حذف الحساب؛ استبدال mapping وحده لا يكفي،
  والعكس legacy يستخدم الحساب الأصلي المعطل في مسار ضيق فقط.
- `resolveForCommand` يقفل Account ثم mapping ويعيد القراءة حتى لإنشاء عميل أو مورد
  أو ملف بيع، ولا يعيد نتيجة بلا materialized row/version.
- تثبيت key/accountId/mappingVersion للأرباح المبقاة في close pack/hash وإعادة
  التحقق في approve/close مع `CHECKLIST_CHANGED`.
- بوابة 13/13 قبل `READ_ONLY_AUTHORITATIVE` وقبل نقل أي مستهلك؛ legacy lookup أداة
  preview/diagnostic فقط ولا يغذي readiness أو resolve أو close.
- `ReportingAccountUsageQueryPort` يحرس Cash Flow ownership، وفشله يمنع أمر دورة
  الحساب ويرجع المعاملة.
- منح RBAC صريحة وبادئة `CORE_ACCOUNTING` في API/Web وسياسة Settings محروسة لكل قسم؛
  لا permission implications مفترضة.
- لا cascade إلى كيان قائم؛ defaults للإنشاءات والعمليات المستقبلية فقط.
- لا Outbox في الشريحة الأولى لعدم وجود مستهلك؛ المنافذ الحاكمة متزامنة.
- ترتيب rollout هو schema/backfill والإكمال، ثم completeness، ثم dual-read تشخيصي،
  ثم تحويل المستهلكين إلى الصفوف فقط، ثم إزالة lookup القديم.
- rollback يعيد المستهلك كاملًا إلى التطبيق القديم ويحتفظ بالصفوف؛ لا يمزج مصدرين
  ولا يحذف mapping أو Audit.
- لا تفتح الكتابة اليدوية قبل اعتماد rollback artifact/drill؛ وأثناء الرجوع تجمد
  mapping writes وتعود الدفعة كاملة إلى التطبيق القديم بلا مزج.

## التحقق المنفذ

- نجح `Workspace.ps1 -Action Check -Refresh`: المرجع `9099322` ومهمتان نشطتان من
  ثلاث، و107 مهام مؤرشفة.
- نجح `git diff --cached --check` بلا أخطاء whitespace.
- نجح فحص الروابط المحلية في ملفات Markdown الأربعة، وتحققت موازنة code fences.
- حصر `git diff --cached --name-only` التغيير في المسارات الأربعة المعلنة.
- روجعت أسماء المفاتيح والمسارات والصلاحيات بين ADR وخطة الشرائح.

## ما لم يختبر

لم تشغل اختبارات التطبيق أو قاعدة البيانات لأنها مهمة توثيقية بلا اعتماد أو كود.
مصفوفة MariaDB/MySQL والتزامن والعقد والواجهة موثقة كبوابة إلزامية للشرائح
التنفيذية، وليست نتيجة لهذه المهمة.

لا push أو PR أو merge أو deploy ضمن هذه المهمة.
