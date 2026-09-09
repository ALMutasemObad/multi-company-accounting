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
- لقطة close discriminated: السنوي فقط يثبت key/accountId/mappingVersion للأرباح
  المبقاة ويعيد التحقق مع `CHECKLIST_CHANGED`؛ غير السنوي يحمل `kind=NON_ANNUAL`
  بلا مرجع ولا يتأثر بتغييره أو بطلانه.
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
- قبل فتح PUT، ومع غياب `MANUAL/DIFFERENT`، يجوز rollback كامل إلى التطبيق القديم
  row-unaware بشرط بقائه ADM-1-safe مع Account CAS/Usage Guard. فتح PUT مرة واحدة أو
  وجود `MANUAL` أو رصد `DIFFERENT` يرفع أرضية الرجوع بلا خفض إلى last-known-good
  mapping-aware يقرأ الصفوف ونسخها.
- لا يفتح PUT قبل تثبيت artifact digest وrelease/SHA وتوافق schema/Registry/13 keys
  وAccount guards، ونجاح drill على MariaDB/MySQL. إذا غاب الأثر أو لم يتوافق تفشل
  أوامر consumers المتأثرة مغلقًا؛ لا legacy fallback صامت.
- يحتفظ rollback بالصفوف والنسخ وAudit ويجمد mapping writes أثناء التبديل؛ لا يمزج
  المصدرين ولا ينفذ DDL down.

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
