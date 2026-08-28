---
title: "Professional Ethical Wall Vertical Slice"
status: "implemented and verified locally"
version: "1.0"
date: "2026-08-28"
related:
  - "ADR-011-professional-ethical-wall.md"
  - "PROFESSIONAL_SERVICES_HR_PROJECTS_ROADMAP_AR.md"
  - "CHANGE_REVIEW_CHECKLIST_AR.md"
---

# خطة الشريحة الرأسية F1 للجدار الأخلاقي

## نتيجة الإغلاق

يستطيع مدير مخول تحويل قضية إلى مقيدة ومنح مستخدم أو سحب وصوله. المستخدم غير المسموح
لا يرى القضية في القائمة، ويحصل على 404 عند تخمين معرفها، ولا يستطيع الوصول إلى خطتها
أو وقتها أو عقودها أو أسعارها أو تشغيلات فوترةها حتى لو امتلك صلاحية RBAC عامة.

## نموذج البيانات

- `ProfessionalProject.accessMode`: `COMPANY | RESTRICTED`، الافتراضي `COMPANY`.
- `ProfessionalProject.accessVersion`: نسخة مستقلة تبدأ من صفر.
- `ProfessionalProjectAccessGrant`:
  - `publicId/companyId/projectId/userId`.
  - `isActive/version`.
  - `grantReason/grantedById/grantedAt`.
  - `revocationReason/revokedById/revokedAt`.
  - `updatedById/createdAt/updatedAt`.
- تفرد دائم `(projectId,userId)` يسمح بإعادة تفعيل السجل نفسه ويحافظ على تاريخه الحالي
  في AuditLog، وعلاقات مركبة تمنع منح مستخدم من شركة أخرى.

## حالات الاستخدام والعقد

- `GET /professional-projects/{id}/access`.
- `PATCH /professional-projects/{id}/access` لتغيير `accessMode` مع `accessVersion` وسبب.
- `POST /professional-projects/{id}/access-grants` لمنح أو إعادة تفعيل مستخدم، مع
  Idempotency-Key.
- `POST /professional-projects/{id}/access-grants/{grantId}/revoke` للسحب المسبب مع
  نسخة المنحة وIdempotency-Key.

تضاف صلاحية `professional_access.manage` لدور المدير النظامي فقط. لا تحل محل صلاحية
الحالة الأصلية ولا تمنح bypass.

## التغطية ومنع التسرب

- المرشح المركزي يستخدم الشركة والمستخدم ووضع الوصول والعضوية أو المنحة النشطة.
- القوائم والتعدادات والمجاميع تستبعد القضية المقيدة بالكامل.
- الوصول المباشر يرجع 404 للحالة المفقودة والممنوعة بالشكل نفسه.
- عمليات الكتابة تقفل المشروع ثم تفحص الوصول قبل أي invariant أو قراءة عابرة للسياق.
- تفاصيل Timesheet تعرض الإدخالات المسموحة فقط وتعيد `restrictedEntryCount` عدديًا بلا
  أسماء أو أوصاف أو معرفات للقضايا المحجوبة؛ تبقى لقطة الاعتماد الداخلية كاملة.
- قوائم العملاء والمستخدمين المرجعية ليست حقائق قضية ولا تتغير.

## الواجهة والترجمات

- شارة واضحة لوضع الوصول في بطاقة القضية.
- لوحة إدارة مستقلة تظهر فقط عند نجاح مسار الوصول؛ 403 يخفيها دون تعطيل بقية الصفحة.
- تبديل `COMPANY/RESTRICTED` بتحذير وسبب ونسخة.
- منح مستخدم من خيارات الشركة وسحب المنحة المسبب.
- العربية والإنجليزية والهندية والأردية، وRTL/LTR والمقاسات 390/768/1440/1920.

## الاختبارات

- قاعدة فارغة وترقية من Migration 55.
- التوافق: كل المشاريع القديمة تبقى مرئية في وضع `COMPANY`.
- مستخدم بصلاحية view بلا عضوية أو منحة لا يرى `RESTRICTED` في القائمة ويحصل على 404
  عبر المشروع والخطة والوقت والعقود والأسعار والفوترة.
- العضو النشط والمنحة النشطة يريان القضية، والسحب/إلغاء العضوية يمنعان المعاملة التالية.
- المنحة من شركة أخرى مرفوضة، ولا تسرب في pagination أو totals أو search.
- سباق نسختين لتغيير الوضع أو سحب المنحة ينجح مرة واحدة ويعيد Conflict للثانية.
- Idempotency replay/mismatch للمنح والسحب.
- OpenAPI response validation وroute parity وpermission guards.
- TypeScript والبناء والواجهة والترجمات وChromium وE2E.

## العكس والتشغيل

- `rollback.sql` يرفض عند وجود منحة أو وضع مقيد أو `accessVersion<>0`.
- لا يحذف تاريخًا لتوافق Binary قديم.
- لا Dependency ولا Outbox ولا Ledger ولا Network I/O داخل المعاملة.
- لا Push أو نشر لهذه الشريحة قبل طلب مستقل وبعد اكتمال بوابات الإصدار.
